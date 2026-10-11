"""Entrypoint for starting IndicF5 TTS Service."""

import uvicorn
from src.config import settings


def main() -> None:
    print(f"Starting AI4Bharat IndicF5 TTS Service on http://{settings.HOST}:{settings.PORT}")
    print(f"Mode: {settings.TTS_MODE} | Device: {settings.DEVICE} | Model: {settings.MODEL_ID}")
    uvicorn.run(
        "src.server:app",
        host=settings.HOST,
        port=settings.PORT,
        log_level=settings.LOG_LEVEL.lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()
