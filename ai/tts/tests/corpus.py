import json
import os
import sys
import time
from pathlib import Path
import requests

# Ensure console supports UTF-8 Assamese characters on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Ensure ai/tts is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

OUTPUTS_DIR = BASE_DIR / "tests" / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

CORPUS_PATH = Path("backend/test/fixtures/assamese-tts-corpus.json")
if not CORPUS_PATH.exists():
    CORPUS_PATH = BASE_DIR.parent.parent / "backend" / "test" / "fixtures" / "assamese-tts-corpus.json"


def run_benchmark(service_url: str = "http://localhost:8001") -> dict:
    print("=" * 70)
    print("AI4Bharat IndicF5 TTS — Assamese Corpus Evaluation & Benchmark")
    print(f"Target Service: {service_url}")
    print("=" * 70)

    # 1. Check health
    try:
        h_resp = requests.get(f"{service_url}/health", timeout=5)
        h_resp.raise_for_status()
        print("Health Check: OK", h_resp.json())
    except Exception as e:
        print(f"ERROR: Service health check failed: {e}")
        sys.exit(1)

    # 2. Check readiness
    r_resp = requests.get(f"{service_url}/ready", timeout=5)
    ready_data = r_resp.json()
    print("Readiness Check:", ready_data)

    if not CORPUS_PATH.exists():
        print(f"ERROR: Corpus not found at {CORPUS_PATH}")
        sys.exit(1)

    with open(CORPUS_PATH, "r", encoding="utf-8") as f:
        corpus = json.load(f)

    results = []
    print(f"\nEvaluating {len(corpus)} Assamese test cases...\n")

    for idx, item in enumerate(corpus, 1):
        item_id = item["id"]
        category = item["category"]
        text = item["text"]
        char_len = len(text)

        print(f"[{idx}/{len(corpus)}] {category} ({item_id})")
        print(f"  Text ({char_len} chars): '{text}'")

        start_time = time.perf_counter()
        resp = requests.post(
            f"{service_url}/synthesize",
            json={"text": text, "language": "as", "speed": 1.0},
            timeout=30,
        )
        total_http_time_ms = int((time.perf_counter() - start_time) * 1000)

        if resp.status_code != 200:
            print(f"  FAILED: HTTP {resp.status_code} - {resp.text}")
            results.append({
                "id": item_id,
                "category": category,
                "text": text,
                "status": "FAILED",
                "error": resp.text,
            })
            continue

        wav_bytes = resp.content
        duration_ms = int(resp.headers.get("x-audio-duration-ms", 0))
        inference_ms = int(resp.headers.get("x-inference-time-ms", total_http_time_ms))
        sample_rate = int(resp.headers.get("x-audio-sample-rate", 24000))
        mode = resp.headers.get("x-tts-mode", "unknown")
        device = resp.headers.get("x-tts-device", "unknown")

        duration_sec = duration_ms / 1000.0
        rtf = round(inference_ms / duration_ms, 3) if duration_ms > 0 else 0.0

        # Save generated audio file
        out_file = OUTPUTS_DIR / f"{item_id}.wav"
        out_file.write_bytes(wav_bytes)

        print(f"  Result: SUCCESS | File: {out_file.name} ({len(wav_bytes)} bytes)")
        print(f"  Duration: {duration_sec:.2f}s | Infer: {inference_ms}ms | RTF: {rtf} | Mode: {mode} ({device})\n")

        results.append({
            "id": item_id,
            "category": category,
            "text": text,
            "char_count": char_len,
            "status": "SUCCESS",
            "audio_file": str(out_file),
            "file_size_bytes": len(wav_bytes),
            "duration_ms": duration_ms,
            "duration_sec": duration_sec,
            "inference_time_ms": inference_ms,
            "http_roundtrip_ms": total_http_time_ms,
            "rtf": rtf,
            "sample_rate": sample_rate,
            "mode": mode,
            "device": device,
        })

    summary = {
        "service_url": service_url,
        "ready_data": ready_data,
        "total_cases": len(corpus),
        "successful_cases": sum(1 for r in results if r.get("status") == "SUCCESS"),
        "results": results,
    }

    summary_file = OUTPUTS_DIR / "benchmark_summary.json"
    summary_file.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved benchmark summary to: {summary_file}")

    return summary


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001"
    run_benchmark(url)
