FROM python:3.10-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install system dependencies required for IndicF5 audio processing and git cloning
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    libsndfile1 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip to support modern wheel metadata and normalized package names
RUN pip install --no-cache-dir --upgrade pip

# Install PyTorch with CUDA 12.1 support (using extra-index-url so PyPI is retained for build tools)
RUN pip install --no-cache-dir torch torchaudio --extra-index-url https://download.pytorch.org/whl/cu121

# Install AI4Bharat IndicF5 directly from official repo
RUN pip install git+https://github.com/ai4bharat/IndicF5.git

# Install application dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Copy source code and reference audio prompts
COPY src/ /app/src/
COPY prompts/ /app/prompts/
COPY run.py /app/run.py

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8001/ready || exit 1

CMD ["python", "run.py"]
