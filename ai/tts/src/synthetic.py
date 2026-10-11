"""Deterministic synthetic audio generator for fast testing and CI (TTS_MODE=synthetic)."""

import io
import math
import struct
import numpy as np


def generate_synthetic_wav(
    text: str,
    sample_rate: int = 24000,
) -> tuple[bytes, int]:
    """
    Generates a deterministic 24kHz 16-bit mono PCM WAV audio buffer.
    Used for unit testing, WAV header verification, and latency pipeline benchmarking
    without requiring heavy neural weights or GPU resources.
    
    Returns:
        (wav_bytes, duration_ms)
    """
    # Duration proportional to text length: ~70ms per character, bounded between 0.8s and 4.0s
    char_count = max(1, len(text))
    duration_sec = max(0.8, min(4.0, char_count * 0.07))
    total_samples = int(duration_sec * sample_rate)
    duration_ms = int(duration_sec * 1000)

    # Base frequency based on text hash for deterministic variety
    seed = sum(ord(c) for c in text) % 5
    base_freqs = [392.0, 440.0, 523.25, 587.33, 659.25]  # G4, A4, C5, D5, E5
    f0 = base_freqs[seed]

    t = np.linspace(0, duration_sec, total_samples, endpoint=False, dtype=np.float32)

    # Smooth attack and release envelope (ADSR)
    attack_samples = int(0.05 * sample_rate)
    release_samples = int(0.10 * sample_rate)
    envelope = np.ones(total_samples, dtype=np.float32)

    if attack_samples > 0:
        envelope[:attack_samples] = np.linspace(0, 1, attack_samples)
    if release_samples > 0:
        envelope[-release_samples:] = np.linspace(1, 0, release_samples)

    # Harmonic acoustic synthesis (fundamental + 2nd + 3rd harmonic)
    wave = (
        0.6 * np.sin(2 * np.pi * f0 * t)
        + 0.25 * np.sin(2 * np.pi * 2 * f0 * t)
        + 0.15 * np.sin(2 * np.pi * 3 * f0 * t)
    ) * envelope

    # Scale to 16-bit integer bounds (-32768 to 32767)
    amplitude = 16000
    int16_samples = np.clip(wave * amplitude, -32768, 32767).astype(np.int16)

    # Construct standard 44-byte RIFF WAV header + PCM data
    wav_io = io.BytesIO()
    data_bytes = int16_samples.tobytes()
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    data_size = len(data_bytes)
    riff_chunk_size = 36 + data_size

    # RIFF header
    wav_io.write(b"RIFF")
    wav_io.write(struct.pack("<I", riff_chunk_size))
    wav_io.write(b"WAVE")

    # fmt subchunk
    wav_io.write(b"fmt ")
    wav_io.write(struct.pack("<I", 16))  # Subchunk1Size for PCM
    wav_io.write(struct.pack("<H", 1))   # AudioFormat 1 = PCM
    wav_io.write(struct.pack("<H", num_channels))
    wav_io.write(struct.pack("<I", sample_rate))
    wav_io.write(struct.pack("<I", byte_rate))
    wav_io.write(struct.pack("<H", block_align))
    wav_io.write(struct.pack("<H", bits_per_sample))

    # data subchunk
    wav_io.write(b"data")
    wav_io.write(struct.pack("<I", data_size))
    wav_io.write(data_bytes)

    return wav_io.getvalue(), duration_ms
