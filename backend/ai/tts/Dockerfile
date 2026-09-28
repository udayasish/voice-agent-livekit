FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV TTS_HOST=0.0.0.0
ENV TTS_PORT=8001
ENV MODEL_PATH=/models/indicf5

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
