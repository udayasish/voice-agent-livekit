"""Standalone test verifying IndicF5 model installation and first synthesis."""

import os
import sys
import time
from pathlib import Path
import numpy as np
import soundfile as sf
import torch

from src.config import settings
from src.engine import resolve_device


def run_standalone_test() -> None:
    print("=" * 60)
    print("AI4Bharat IndicF5 Standalone Model Verification")
    print("=" * 60)

    device = resolve_device(settings.DEVICE)
    print(f"Device: {device}")
    print(f"CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU Device: {torch.cuda.get_device_name(0)}")

    ref_audio_path = Path("prompts/as_clinic_ref.wav")
    ref_text_path = Path("prompts/as_clinic_ref.txt")

    if not ref_audio_path.exists():
        print(f"ERROR: Reference audio not found at {ref_audio_path}")
        sys.exit(1)
    if not ref_text_path.exists():
        print(f"ERROR: Reference text not found at {ref_text_path}")
        sys.exit(1)

    ref_text = ref_text_path.read_text(encoding="utf-8").strip()
    print(f"Reference Audio: {ref_audio_path} ({os.path.getsize(ref_audio_path)} bytes)")
    print(f"Reference Transcript: '{ref_text}'")

    test_text = "নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেলথ ক্লিনিকত আপোনাক স্বাগতম।"
    print(f"Target Synthesis Text: '{test_text}'")

    print(f"\n[1/3] Loading model weights from '{settings.MODEL_ID}'...")
    start_load = time.perf_counter()
    try:
        from transformers import AutoModel

        token = settings.HF_TOKEN if settings.HF_TOKEN else None
        model = AutoModel.from_pretrained(
            settings.MODEL_ID,
            trust_remote_code=True,
            token=token,
        )
        if hasattr(model, "to"):
            model = model.to(device)
        if hasattr(model, "eval"):
            model.eval()

        load_time = time.perf_counter() - start_load
        print(f"Model loaded successfully in {load_time:.2f}s on {device}!")
    except Exception as e:
        print(f"Failed to load model: {e}")
        sys.exit(1)

    print(f"\n[2/3] Executing speech synthesis inference...")
    start_infer = time.perf_counter()
    with torch.no_grad():
        audio = model(
            test_text,
            ref_audio_path=str(ref_audio_path),
            ref_text=ref_text,
        )
    infer_time = time.perf_counter() - start_infer
    print(f"Inference completed in {infer_time:.2f}s!")

    if isinstance(audio, torch.Tensor):
        audio_np = audio.detach().cpu().numpy()
    elif isinstance(audio, np.ndarray):
        audio_np = audio
    else:
        audio_np = np.array(audio)

    if audio_np.ndim > 1:
        audio_np = audio_np.squeeze()

    if audio_np.dtype != np.float32 and audio_np.dtype != np.float64:
        audio_np = audio_np.astype(np.float32) / 32768.0
    else:
        max_val = np.max(np.abs(audio_np))
        if max_val > 1.0:
            audio_np = audio_np / max_val

    output_wav = "standalone_output.wav"
    sf.write(output_wav, audio_np, samplerate=24000)
    audio_duration = len(audio_np) / 24000.0
    rtf = infer_time / audio_duration if audio_duration > 0 else 0.0

    print(f"\n[3/3] Output Verification:")
    print(f"Saved: {output_wav}")
    print(f"File Size: {os.path.getsize(output_wav)} bytes")
    print(f"Audio Duration: {audio_duration:.2f} seconds")
    print(f"Sample Rate: 24000 Hz")
    print(f"Real-Time Factor (RTF): {rtf:.2f}")
    print("=" * 60)
    print("Standalone verification succeeded!")


if __name__ == "__main__":
    run_standalone_test()
