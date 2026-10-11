"""Configuration settings for IndicF5 TTS Service."""

import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for TTS service."""

    # Operational mode: "indicf5" for real neural inference, "synthetic" for fast deterministic tests
    TTS_MODE: str = "indicf5"

    # HTTP server configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8001

    # Model & hardware execution
    MODEL_ID: str = "ai4bharat/IndicF5"
    DEVICE: str = "auto"  # "auto", "cuda", or "cpu"

    # Default Assamese reference prompt audio & verbatim transcript
    REF_AUDIO_PATH: str = "prompts/as_clinic_ref.wav"
    REF_TEXT_PATH: str = "prompts/as_clinic_ref.txt"

    # Audio synthesis parameters
    SAMPLE_RATE: int = 24000
    MAX_TEXT_LENGTH: int = 1000
    DEFAULT_LANGUAGE: str = "as"

    # Hugging Face token for accessing gated models
    HF_TOKEN: str = os.getenv("HUGGINGFACE_API_TOKEN", os.getenv("HF_TOKEN", ""))

    # Logging
    LOG_LEVEL: str = "INFO"

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=".env",
        extra="ignore",
    )

    def resolve_ref_paths(self, base_dir: Path) -> tuple[Path, Path]:
        """Resolve reference audio and transcript paths relative to project root or base_dir."""
        audio_p = Path(self.REF_AUDIO_PATH)
        if not audio_p.is_absolute():
            audio_p = base_dir / audio_p

        text_p = Path(self.REF_TEXT_PATH)
        if not text_p.is_absolute():
            text_p = base_dir / text_p

        return audio_p, text_p


settings = Settings()
