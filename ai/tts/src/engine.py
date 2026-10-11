"""Inference engine managing IndicF5 lifecycle, device selection, and synthesis."""

import io
import logging
import struct
import time
from pathlib import Path
from typing import Optional, Tuple
import numpy as np
import torch

from .config import settings
from .synthetic import generate_synthetic_wav

logger = logging.getLogger("indicf5.engine")


def resolve_device(configured: str) -> str:
    """
    Resolves execution device according to contract:
    - 'auto': chooses 'cuda' if torch.cuda.is_available() else 'cpu'
    - 'cuda': requires CUDA; raises RuntimeError if unavailable
    - 'cpu': forces CPU execution
    """
    dev = configured.lower().strip()
    if dev == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("DEVICE is configured as 'cuda', but CUDA-enabled PyTorch is not available.")
        return "cuda"
    elif dev == "cpu":
        return "cpu"
    elif dev == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    else:
        raise ValueError(f"Invalid DEVICE configuration: '{configured}'. Expected 'auto', 'cuda', or 'cpu'.")


class TTSEngine:
    """Manages model loading, reference audio conditioning, and audio synthesis."""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = base_dir or Path(__file__).resolve().parent.parent
        self.vocoder = None
        self.mode = settings.TTS_MODE.lower().strip()
        self.model = None
        self.device = "cpu"
        self.is_loaded = False
        self.load_error: Optional[str] = None
        self.load_time_ms: int = 0

        # Reference audio & transcript
        self.ref_audio_path, self.ref_text_path = settings.resolve_ref_paths(self.base_dir)
        self.default_ref_text: str = ""

    def load(self) -> None:
        """One-time startup loading routine."""
        start = time.perf_counter()

        # Resolve execution device
        try:
            self.device = resolve_device(settings.DEVICE)
            logger.info("Resolved device for TTS engine: %s (configured: %s)", self.device, settings.DEVICE)
        except Exception as e:
            self.load_error = f"Device resolution failure: {e}"
            logger.error(self.load_error)
            raise

        # Read default reference transcript if present
        if self.ref_text_path.exists():
            try:
                self.default_ref_text = self.ref_text_path.read_text(encoding="utf-8").strip()
                logger.info("Loaded default reference transcript (%d chars)", len(self.default_ref_text))
            except Exception as e:
                logger.warning("Could not read default reference transcript: %s", e)

        if self.mode == "synthetic":
            logger.info("TTS Engine initialized in deterministic SYNTHETIC mode (no neural weights loaded).")
            self.is_loaded = True
            self.load_time_ms = int((time.perf_counter() - start) * 1000)
            return

        if self.mode == "indicf5":
            logger.info("Loading AI4Bharat IndicF5 model '%s' on %s...", settings.MODEL_ID, self.device)
            try:
                from f5_tts.model import DiT
                from f5_tts.infer.utils_infer import load_model, load_vocoder
                from huggingface_hub import hf_hub_download
                from safetensors.torch import load_file

                token = settings.HF_TOKEN if settings.HF_TOKEN else None

                # Locate or download weights & vocab from Hugging Face
                ckpt_path = hf_hub_download(settings.MODEL_ID, filename="model.safetensors", token=token)
                vocab_path = hf_hub_download(settings.MODEL_ID, filename="checkpoints/vocab.txt", token=token)

                logger.info("Initializing IndicF5 DiT architecture on %s...", self.device)
                self.model = load_model(
                    DiT,
                    dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4),
                    mel_spec_type="vocos",
                    vocab_file=vocab_path,
                    device=self.device,
                )

                logger.info("Loading checkpoint weights into DiT model...")
                state_dict = load_file(ckpt_path, device=self.device)
                state_dict = {
                    k.replace("ema_model._orig_mod.", "").replace("ema_model.", ""): v
                    for k, v in state_dict.items()
                    if k.startswith("ema_model.")
                }
                self.model.load_state_dict(state_dict)

                logger.info("Loading Vocos neural vocoder on %s...", self.device)
                self.vocoder = load_vocoder(vocoder_name="vocos", is_local=False, device=self.device)

                self.is_loaded = True
                self.load_time_ms = int((time.perf_counter() - start) * 1000)
                logger.info("IndicF5 model and vocoder loaded successfully in %d ms on %s", self.load_time_ms, self.device)
            except Exception as e:
                self.load_error = str(e)
                self.is_loaded = False
                logger.exception("Failed to load IndicF5 model '%s': %s", settings.MODEL_ID, e)
                # In indicf5 mode, we do NOT silently replace with synthetic. We record error.
        else:
            raise ValueError(f"Unknown TTS_MODE: {self.mode}. Expected 'indicf5' or 'synthetic'.")

    def synthesize(
        self,
        text: str,
        language: str = "as",
        ref_audio_path: Optional[str] = None,
        ref_text: Optional[str] = None,
    ) -> Tuple[bytes, int, int]:
        """
        Synthesizes spoken audio from text.
        
        Returns:
            (wav_bytes, duration_ms, inference_time_ms)
        """
        start = time.perf_counter()

        if self.mode == "synthetic":
            wav_bytes, duration_ms = generate_synthetic_wav(text, settings.SAMPLE_RATE)
            inference_ms = int((time.perf_counter() - start) * 1000)
            return wav_bytes, duration_ms, inference_ms

        if self.mode == "indicf5":
            if not self.is_loaded or self.model is None or self.vocoder is None:
                raise RuntimeError(
                    f"IndicF5 model is not ready. Mode: {self.mode}, Device: {self.device}. "
                    f"Error: {self.load_error or 'Model not loaded'}"
                )

            # Determine reference audio and transcript
            target_ref_audio = ref_audio_path or str(self.ref_audio_path)
            target_ref_text = ref_text or self.default_ref_text

            if not Path(target_ref_audio).exists():
                raise FileNotFoundError(f"Reference audio file not found: {target_ref_audio}")
            if not target_ref_text:
                raise ValueError("Reference transcript is required for IndicF5 conditioning.")

            logger.info("Running IndicF5 inference for '%s' (ref: %s)", text[:40], target_ref_audio)

            from f5_tts.infer.utils_infer import infer_process, preprocess_ref_audio_text

            ref_audio, ref_text = preprocess_ref_audio_text(target_ref_audio, target_ref_text)

            with torch.no_grad():
                audio_out, sample_rate, _ = infer_process(
                    ref_audio,
                    ref_text,
                    text,
                    self.model,
                    self.vocoder,
                    mel_spec_type="vocos",
                    speed=1.0,
                    device=self.device,
                )

            # Convert output to 16-bit PCM numpy array
            audio_np = np.asarray(audio_out)

            # Flatten multi-dim outputs to 1D mono
            if audio_np.ndim > 1:
                audio_np = audio_np.squeeze()

            # Normalize to signed 16-bit PCM integer range
            if audio_np.dtype == np.int16:
                int16_samples = audio_np
            else:
                max_val = np.max(np.abs(audio_np))
                if max_val > 1.0:
                    audio_np = audio_np / max_val
                int16_samples = np.clip(audio_np * 32767.0, -32768, 32767).astype(np.int16)

            # Build 24kHz mono RIFF WAV bytes
            wav_io = io.BytesIO()
            sample_rate = settings.SAMPLE_RATE
            num_channels = 1
            bits_per_sample = 16
            byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
            block_align = num_channels * (bits_per_sample // 8)
            data_bytes = int16_samples.tobytes()
            data_size = len(data_bytes)
            riff_chunk_size = 36 + data_size

            wav_io.write(b"RIFF")
            wav_io.write(struct.pack("<I", riff_chunk_size))
            wav_io.write(b"WAVE")
            wav_io.write(b"fmt ")
            wav_io.write(struct.pack("<I", 16))
            wav_io.write(struct.pack("<H", 1))  # PCM
            wav_io.write(struct.pack("<H", num_channels))
            wav_io.write(struct.pack("<I", sample_rate))
            wav_io.write(struct.pack("<I", byte_rate))
            wav_io.write(struct.pack("<H", block_align))
            wav_io.write(struct.pack("<H", bits_per_sample))
            wav_io.write(b"data")
            wav_io.write(struct.pack("<I", data_size))
            wav_io.write(data_bytes)

            duration_ms = int((len(int16_samples) / sample_rate) * 1000)
            inference_ms = int((time.perf_counter() - start) * 1000)

            return wav_io.getvalue(), duration_ms, inference_ms

        raise ValueError(f"Unsupported TTS_MODE: {self.mode}")
