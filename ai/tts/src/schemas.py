"""Pydantic schemas for IndicF5 TTS Service API."""

from typing import Optional
from pydantic import BaseModel, Field, field_validator


class SynthesizeRequest(BaseModel):
    """Payload schema for /synthesize endpoint."""

    text: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Spoken text to synthesize into speech (Assamese/Indic).",
    )
    language: str = Field(
        default="as",
        description="ISO language code (default 'as' for Assamese).",
    )
    speed: float = Field(
        default=1.0,
        description="Speech playback rate. Only 1.0 is currently supported.",
    )
    ref_audio_path: Optional[str] = Field(
        default=None,
        description="Optional custom path to 24kHz reference WAV file for voice conditioning.",
    )
    ref_text: Optional[str] = Field(
        default=None,
        description="Optional verbatim transcript matching custom reference audio.",
    )

    @field_validator("speed")
    @classmethod
    def validate_speed(cls, v: float) -> float:
        if abs(v - 1.0) > 1e-3:
            raise ValueError(
                f"Invalid speed {v}. The IndicF5 model only supports native speed=1.0 without audio post-processing."
            )
        return v

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Text cannot be empty or only whitespace.")
        return stripped


class HealthResponse(BaseModel):
    """Response schema for /health endpoint."""

    status: str = "ok"
    service: str = "indicf5-tts"
    version: str = "1.0.0"


class ReadyResponse(BaseModel):
    """Response schema for /ready endpoint."""

    status: str = "ready"
    mode: str
    device: str
    model_id: str
    sample_rate: int = 24000


class ErrorDetail(BaseModel):
    """Structured error payload."""

    code: str
    message: str


class ErrorResponse(BaseModel):
    """Top-level error response envelope."""

    error: ErrorDetail
