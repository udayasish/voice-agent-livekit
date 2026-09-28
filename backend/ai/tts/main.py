from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import logging
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tts")

app = FastAPI(
    title="IndicF5 TTS Service",
    description="Assamese TTS using AI4Bharat IndicF5",
    version="0.0.0",
)

class SynthesizeRequest(BaseModel):
    text: str
    language: str = "as-IN"
    voice_id: str | None = None
    rate: float = 1.0

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "indicf5-tts",
        "model": os.environ.get("MODEL_PATH", "not-loaded"),
        "phase": "0-skeleton",
    }

@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    raise HTTPException(
        status_code=501,
        detail="TTS synthesis stub. Real IndicF5 inference implemented in Phase 11.",
    )
