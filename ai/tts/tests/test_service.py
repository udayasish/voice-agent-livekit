import os
import struct
import sys
from pathlib import Path
import unittest

# Ensure ai/tts is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from src.config import settings
from src.engine import TTSEngine, resolve_device
from src.server import app, engine


class TestTTSService(unittest.TestCase):
    """Suite A: Automated unit and regression tests."""

    @classmethod
    def setUpClass(cls):
        # Force synthetic mode for deterministic unit test suite
        settings.TTS_MODE = "synthetic"
        engine.mode = "synthetic"
        engine.load()
        cls.client = TestClient(app)

    def test_health_endpoint(self):
        """GET /health must return 200 OK and valid service metadata."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "indicf5-tts")
        self.assertEqual(data["version"], "1.0.0")

    def test_ready_endpoint(self):
        """GET /ready must return 200 OK when engine is loaded."""
        response = self.client.get("/ready")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ready")
        self.assertEqual(data["mode"], "synthetic")
        self.assertEqual(data["sample_rate"], 24000)

    def test_validation_empty_text(self):
        """POST /synthesize with empty or whitespace text must be rejected."""
        response = self.client.post("/synthesize", json={"text": "   ", "language": "as"})
        self.assertEqual(response.status_code, 422)

    def test_validation_oversized_text(self):
        """POST /synthesize with text exceeding 1000 characters must be rejected."""
        long_text = "নমস্কাৰ " * 200  # > 1400 chars
        response = self.client.post("/synthesize", json={"text": long_text, "language": "as"})
        self.assertEqual(response.status_code, 422)

    def test_validation_unsupported_speed(self):
        """POST /synthesize with speed != 1.0 must be rejected."""
        response = self.client.post(
            "/synthesize",
            json={"text": "নমস্কাৰ", "speed": 1.25},
        )
        self.assertEqual(response.status_code, 422)
        errors = response.json().get("detail", [])
        self.assertTrue(any("speed" in str(err) for err in errors))

    def test_synthesize_synthetic_wav_format(self):
        """POST /synthesize in synthetic mode must return valid 24kHz mono 16-bit WAV."""
        sample_text = "নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেলথ ক্লিনিকত আপোনাক স্বাগতম।"
        response = self.client.post(
            "/synthesize",
            json={"text": sample_text, "language": "as", "speed": 1.0},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertEqual(response.headers["x-audio-sample-rate"], "24000")
        self.assertEqual(response.headers["x-audio-channels"], "1")
        self.assertTrue(int(response.headers["x-audio-duration-ms"]) > 500)

        wav_bytes = response.content
        self.assertTrue(len(wav_bytes) > 44)
        self.assertEqual(wav_bytes[:4], b"RIFF")
        self.assertEqual(wav_bytes[8:12], b"WAVE")

        # Parse WAV header fields
        audio_format, num_channels, sample_rate, byte_rate, block_align, bits_per_sample = (
            struct.unpack("<HHIIHH", wav_bytes[20:36])
        )
        self.assertEqual(audio_format, 1)  # PCM
        self.assertEqual(num_channels, 1)  # Mono
        self.assertEqual(sample_rate, 24000)
        self.assertEqual(bits_per_sample, 16)
        self.assertEqual(block_align, 2)
        self.assertEqual(byte_rate, 48000)

    def test_device_resolution_logic(self):
        """Verifies resolve_device contract for 'auto', 'cpu', and 'cuda'."""
        self.assertEqual(resolve_device("cpu"), "cpu")
        auto_dev = resolve_device("auto")
        self.assertIn(auto_dev, ["cuda", "cpu"])

        # Invalid device should raise ValueError
        with self.assertRaises(ValueError):
            resolve_device("invalid_device")

    def test_explicit_indicf5_failure_when_unloaded(self):
        """When TTS_MODE=indicf5 and model is not ready, synthesize must fail with 503 (no silent fallback)."""
        unloaded_engine = TTSEngine()
        unloaded_engine.mode = "indicf5"
        unloaded_engine.is_loaded = False
        unloaded_engine.load_error = "Weights not loaded"

        with self.assertRaises(RuntimeError) as ctx:
            unloaded_engine.synthesize("নমস্কাৰ")
        self.assertIn("IndicF5 model is not ready", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
