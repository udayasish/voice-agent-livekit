"""Generates or validates the reference audio WAV file for IndicF5."""

import os
import struct
import numpy as np


def ensure_reference_audio(output_path: str = "prompts/as_clinic_ref.wav", sample_rate: int = 24000) -> None:
    """Ensures a clean 24kHz mono 16-bit PCM reference WAV exists for voice conditioning."""
    if os.path.exists(output_path) and os.path.getsize(output_path) > 44:
        return

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Generate a clean 3.2-second reference voice waveform at 24kHz
    duration_sec = 3.2
    total_samples = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, total_samples, endpoint=False, dtype=np.float32)

    # Syllabic acoustic modulation simulating speech formant transitions
    # Fundamental frequency pitch contour around 210 Hz (pleasant female voice)
    f0 = 210.0 + 15.0 * np.sin(2 * np.pi * 1.2 * t) + 10.0 * np.cos(2 * np.pi * 2.8 * t)
    phase = 2 * np.pi * np.cumsum(f0) / sample_rate

    # Natural formant resonances (F1: ~650 Hz, F2: ~1800 Hz, F3: ~2800 Hz)
    f1 = 650.0
    f2 = 1800.0
    f3 = 2800.0

    syllable_envelope = 0.5 * (1.0 + np.sin(2 * np.pi * 4.2 * t))
    syllable_envelope = np.power(syllable_envelope, 1.8)

    # Attack & decay
    fade_in = np.minimum(1.0, t / 0.15)
    fade_out = np.minimum(1.0, (duration_sec - t) / 0.25)
    global_envelope = fade_in * fade_out * syllable_envelope

    wave = (
        0.55 * np.sin(phase)
        + 0.28 * np.sin(2 * np.pi * f1 * t)
        + 0.12 * np.sin(2 * np.pi * f2 * t)
        + 0.05 * np.sin(2 * np.pi * f3 * t)
    ) * global_envelope

    # Scale to 16-bit PCM
    amplitude = 15000
    int16_samples = np.clip(wave * amplitude, -32768, 32767).astype(np.int16)

    # Write WAV file
    data_bytes = int16_samples.tobytes()
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    data_size = len(data_bytes)
    riff_chunk_size = 36 + data_size

    with open(output_path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", riff_chunk_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<H", 1))  # PCM
        f.write(struct.pack("<H", num_channels))
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", byte_rate))
        f.write(struct.pack("<H", block_align))
        f.write(struct.pack("<H", bits_per_sample))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(data_bytes)

    print(f"Reference audio generated successfully at: {output_path} ({duration_sec}s @ {sample_rate}Hz)")


if __name__ == "__main__":
    ensure_reference_audio("ai/tts/prompts/as_clinic_ref.wav")
