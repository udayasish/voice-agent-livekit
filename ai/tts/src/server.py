"""FastAPI HTTP service for AI4Bharat IndicF5 Text-to-Speech."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, HTTPException, Response, status
from fastapi.responses import JSONResponse

from .config import settings
from .engine import TTSEngine
from .schemas import (
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    ReadyResponse,
    SynthesizeRequest,
)

# Setup logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
)
logger = logging.getLogger("indicf5.server")

# Instantiate single global engine
engine = TTSEngine()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown lifecycle."""
    logger.info("Initializing IndicF5 TTS Service (mode=%s, device=%s)...", settings.TTS_MODE, settings.DEVICE)
    try:
        engine.load()
    except Exception as e:
        logger.error("Startup error in TTS engine load: %s", e)
        # Service continues running so health/ready can report the failure
    yield
    logger.info("Shutting down IndicF5 TTS Service...")


app = FastAPI(
    title="AI4Bharat IndicF5 TTS Service",
    description="Dedicated Text-to-Speech microservice for Assamese and Indic languages.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health() -> HealthResponse:
    """Basic liveness check."""
    return HealthResponse()


@app.get("/ready", response_model=ReadyResponse, tags=["Health"])
async def ready() -> Response:
    """Readiness probe checking model loading and device availability."""
    if not engine.is_loaded:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "not_ready",
                "mode": engine.mode,
                "device": engine.device,
                "error": engine.load_error or "Model is loading or failed to load",
            },
        )

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "status": "ready",
            "mode": engine.mode,
            "device": engine.device,
            "model_id": settings.MODEL_ID,
            "sample_rate": settings.SAMPLE_RATE,
            "load_time_ms": engine.load_time_ms,
        },
    )


@app.post(
    "/synthesize",
    responses={
        200: {
            "content": {"audio/wav": {}},
            "description": "Binary WAV audio stream (24kHz 16-bit mono PCM).",
        },
        400: {"model": ErrorResponse, "description": "Invalid input text or speed parameter."},
        503: {"model": ErrorResponse, "description": "TTS engine not ready or model failure."},
    },
    tags=["Synthesis"],
)
async def synthesize(request: SynthesizeRequest) -> Response:
    """Synthesizes text into 24kHz mono 16-bit PCM WAV audio."""
    if not engine.is_loaded:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="MODEL_NOT_READY",
                    message=f"TTS engine is not ready: {engine.load_error or 'Weights not loaded'}",
                )
            ).model_dump(),
        )

    try:
        wav_bytes, duration_ms, inference_ms = engine.synthesize(
            text=request.text,
            language=request.language,
            ref_audio_path=request.ref_audio_path,
            ref_text=request.ref_text,
        )

        headers = {
            "Content-Type": "audio/wav",
            "X-Audio-Sample-Rate": str(settings.SAMPLE_RATE),
            "X-Audio-Channels": "1",
            "X-Audio-Duration-Ms": str(duration_ms),
            "X-Inference-Time-Ms": str(inference_ms),
            "X-TTS-Mode": engine.mode,
            "X-TTS-Device": engine.device,
        }

        return Response(content=wav_bytes, media_type="audio/wav", headers=headers)

    except FileNotFoundError as fnf:
        logger.error("Reference file not found during synthesis: %s", fnf)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorResponse(
                error=ErrorDetail(code="REFERENCE_FILE_NOT_FOUND", message=str(fnf))
            ).model_dump(),
        )
    except ValueError as val_err:
        logger.warning("Validation error in synthesis: %s", val_err)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorResponse(
                error=ErrorDetail(code="INVALID_ARGUMENTS", message=str(val_err))
            ).model_dump(),
        )
    except RuntimeError as r_err:
        logger.error("Runtime error in synthesis: %s", r_err)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=ErrorResponse(
                error=ErrorDetail(code="SYNTHESIS_FAILED", message=str(r_err))
            ).model_dump(),
        )
    except Exception as exc:
        logger.exception("Unexpected error in synthesis: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                error=ErrorDetail(code="INTERNAL_ERROR", message=f"Unexpected error: {exc}")
            ).model_dump(),
        )
