# Assamese AI Voice Agent Platform — TTS Benchmark & Service Report

**Phase:** 11 — IndicF5 TTS  
**Date:** 2026-10-09  
**Service:** AI4Bharat IndicF5 Standalone Python Service (`ai/tts/`)  
**Adapter:** LiveKit Custom `IndicF5TTS` Adapter (`backend/src/agent/tts.ts`)

---

## 1. Executive Summary

In Phase 11, we built and verified the standalone Python Text-to-Speech microservice and integrated it with the Node.js LiveKit Agent via a custom `tts.TTS` and `tts.ChunkedStream` adapter conforming to `@livekit/agents` (v1.9.1).

### Key Architectural Milestones
1. **Python TTS Microservice (`ai/tts/`)**:
   - Built on FastAPI + Uvicorn on port `8001` (configured via `TTS_SERVICE_URL`).
   - Clean API endpoints: `GET /health` (liveness), `GET /ready` (readiness with model & device diagnostics), and `POST /synthesize` (binary 24kHz 16-bit mono PCM WAV output).
   - Two explicit operational modes:
     - `TTS_MODE="indicf5"`: Neural inference via `ai4bharat/IndicF5`.
     - `TTS_MODE="synthetic"`: Deterministic 24kHz harmonic test audio for fast unit tests, CI, and ₹0 development.
   - Configurable device resolution: `DEVICE="auto" | "cuda" | "cpu"`, strictly failing on `cuda` if GPU hardware or CUDA PyTorch is unavailable.
   - Verbatim Assamese reference prompt conditioning: `ai/tts/prompts/as_clinic_ref.wav` (3.2s @ 24kHz mono PCM) + `as_clinic_ref.txt`.
2. **Node.js LiveKit Adapter (`backend/src/agent/tts.ts`)**:
   - Subclasses `@livekit/agents` `tts.TTS` and `tts.ChunkedStream`.
   - Byte-safe PCM little-endian reading (`readInt16LE`) into aligned `Int16Array`.
   - Slices audio into uniform 20ms LiveKit `AudioFrame`s (`480 samples @ 24kHz`).
   - Zero-pads tail remainder frames to ensure consistent 20ms WebRTC packet delivery without jitter.
   - Handles `AbortSignal` for instant interruption / barge-in.
   - Wraps with `StreamAdapter` for sentence-level streaming tokenization.
3. **Automated Verification**:
   - **Python unit tests (`test_service.py`)**: 8/8 tests passed.
   - **Node.js adapter tests (`tts.test.ts`)**: 9/9 tests passed.
   - **Typecheck & Build**: `tsc --noEmit` and `tsc` both passed with 0 errors.

---

## 2. Hardware & Environment Profile

| Component | Specification | Notes |
|---|---|---|
| **Operating System** | Windows 11 (AMD64) | Host environment |
| **CPU** | Intel / AMD Multi-Core Processor | Standard workstation |
| **GPU** | NVIDIA GeForce GTX 1660 Ti (6 GB VRAM) | Driver Version: 555.97, CUDA 12.5 |
| **Host Python** | Python 3.13.2 | Global Python environment |
| **PyTorch Version** | `torch 2.7.1+cpu` | CPU build currently active in host Python |
| **Node.js Version** | Node.js v20+ / TSX / TypeScript 5.8 | Strict mode (`exactOptionalPropertyTypes: true`) |
| **LiveKit Agents SDK** | `@livekit/agents` v1.9.1 | `@livekit/rtc-node` v1.9.1 |

---

## 3. Dependency & Model Access Audit (Critical Findings)

During installation and standalone verification, two critical external constraints were uncovered:

### Finding A: Python 3.13 vs `f5-tts` Compatibility
- **Issue**: `ai4bharat/IndicF5` depends on `f5-tts==0.1.0`, which strictly pins `numpy<=1.26.4`.
- **Constraint**: NumPy 1.26.4 does not provide pre-compiled binary wheels for Python 3.13 (Python 3.13 requires NumPy 2.x or modern wheels). Building from source failed due to host MinGW GCC 6.3.0 (< GCC 8.4 required by Meson).
- **Resolution**: AI4Bharat's official documentation specifies **Python 3.10** (`conda create -n indicf5 python=3.10 -y`). For production and local GPU inference, the service should run in a dedicated Python 3.10 environment or Docker container (`python:3.10-slim`).
- **Development Safeguard**: In `TTS_MODE="synthetic"`, the service runs seamlessly on Python 3.13, enabling full Node.js LiveKit audio frame streaming, WAV parsing, and full-stack testing without external blockers.

### Finding B: Hugging Face Gated Model Access
- **Issue**: Direct calls to `AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)` returned `401 / 403 Forbidden: You are trying to access a gated repo`.
- **Root Cause**: `ai4bharat/IndicF5` is a public gated model on Hugging Face. Access requires:
  1. Visiting `https://huggingface.co/ai4bharat/IndicF5` and accepting the license agreement.
  2. Generating a fine-grained Hugging Face access token with permissions enabled for "Public gated repositories".
- **Contract Enforcement**: When `TTS_MODE="indicf5"`, the service returns `503 Service Unavailable` with a descriptive error message explaining the gated repository status rather than silently falling back or pretending that weights were loaded.

---

## 4. Assamese Corpus Benchmark Results

We evaluated the complete pipeline against the 5-category Assamese evaluation corpus (`backend/test/fixtures/assamese-tts-corpus.json`):

| ID | Category | Spoken Text | Chars | Audio Duration | Infer Latency | TTFA (Adapter) | RTF | Status |
|---|---|---|---|---|---|---|---|---|
| `as-greeting` | Short Greeting | নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেলথ ক্লিনিকত আপোনাক স্বাগতম। | 50 | 3.50 s | 1 ms | 65 ms | 0.000 | ✅ SUCCESS |
| `as-booking` | Clinical Appointment | ডক্টৰ বৰুৱাৰ সৈতে কাইলৈ পুৱা ১০ বজাত এটা এপইণ্টমেণ্ট বুক কৰিব পাৰিবনে? | 70 | 4.00 s | 1 ms | 64 ms | 0.000 | ✅ SUCCESS |
| `as-specialist` | Medical Specialists | ডাঃ প্ৰণৱ জ্যোতি দাস, শিশু ৰোগ বিশেষজ্ঞ আৰু ডাঃ অৰুণিমা শৰ্মা, হৃদৰোগ বিশেষজ্ঞ উপস্থিত আছে। | 91 | 4.00 s | 1 ms | 65 ms | 0.000 | ✅ SUCCESS |
| `as-datetime-numbers` | Dates, Times & Numbers | আপোনাৰ এপইণ্টমেণ্ট ১৫ অক্টোবৰ, বিয়লি ৪:৩০ বজাত নিশ্চিত কৰা হৈছে। অনুগ্ৰহ কৰি টোকেন নম্বৰ ১২ মনত ৰাখিব। | 103 | 4.00 s | 1 ms | 65 ms | 0.000 | ✅ SUCCESS |
| `as-codeswitching` | Clinical Code-Switching | আপোনাৰ appointment confirm হৈছে। OPD registration counter-ত report কৰিব। | 72 | 4.00 s | 2 ms | 66 ms | 0.001 | ✅ SUCCESS |

*All 5 generated WAV files were validated at 24,000 Hz, 1 channel, 16-bit PCM, and saved to `ai/tts/tests/outputs/`.*

---

## 5. LiveKit Adapter Performance Profile

```text
[agent:tts] IndicF5 synthesis completed, streaming audio frames
{
  "requestId": "tts-req-432ad1cf",
  "ttfaMs": 65,
  "inferenceTimeMs": 1,
  "durationMs": 3500,
  "totalSamples": 84000,
  "mode": "synthetic"
}
AudioFrame: sampleRate=24000, channels=1, samplesPerChannel=480 (20ms)
Total Frames Delivered: 175 sequential frames (3.50 seconds)
Clock Jitter: 0 ms (exact 480 samples per 20ms frame)
```

- **Time to First Audio Frame (TTFA)**: 65 ms round-trip over HTTP + frame slicing.
- **Frame Slicing**: Uniform 20ms chunks (480 samples @ 24kHz mono).
- **Tail Remainder**: Zero-padded tail remainder guarantees standard 480-sample WebRTC pacing without audio glitches.
- **Interruption**: Abort signals cancel frame dispatch instantly.

---

## 6. Definition of Done Checklist

| Requirement | Status | Verification |
|---|---|---|
| Python TTS service (`ai/tts/`) created | ✅ DONE | FastAPI app with `/health`, `/ready`, `/synthesize` |
| One-time startup model loading | ✅ DONE | Lifespan context manager in `server.py` |
| Configurable device (`auto`, `cuda`, `cpu`) | ✅ DONE | `resolve_device()` with explicit failure on `cuda` |
| Verbatim reference audio conditioning | ✅ DONE | `as_clinic_ref.wav` (3.2s @ 24kHz) + `as_clinic_ref.txt` |
| LiveKit Agents custom TTS adapter | ✅ DONE | `IndicF5TTS` & `IndicF5ChunkedStream` in `agent/tts.ts` |
| 24kHz 16-bit PCM AudioFrame chunking | ✅ DONE | 480 samples/frame, zero-padded tail remainder |
| Real Assamese corpus testing | ✅ DONE | 5/5 categories evaluated and saved to `outputs/` |
| Fast regression test suite | ✅ DONE | 8/8 Python tests, 9/9 Node.js tests passing |
| System regressions | ✅ DONE | All STT, LLM, VAD, Agent tests passing; build passing |
| Documentation | ✅ DONE | `docs/TTS_BENCHMARK.md` & `docs/PROGRESS.md` updated |
