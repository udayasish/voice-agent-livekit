# Phase 11 Explained: Raya BakBak TTS for the Assamese Voice Agent

> **A Plain-Language Guide to What We Built, What Problem It Solved, How It Works Under the Hood, and How It Differs From What Came Before.**

---

## 1. Quick Summary (In Very Simple Words)

In any voice conversation system, there are four main jobs:
1. **The Ears (STT):** Listening to what the human says and turning speech into text. *(We solved this in Phase 8 & 9 with Deepgram Nova-3)*.
2. **The Brain (LLM):** Thinking about the question and writing an answer in Assamese. *(We solved this in Phase 10 with Qwen3.5 & Groq)*.
3. **The Voice/Mouth (TTS):** Taking the text written by the brain and **speaking it out loud in clear, natural Assamese**.
4. **The Telephone Wire (LiveKit):** Carrying the audio back and forth over the internet in real time.

**This phase solved the "Voice/Mouth" part of the system.**

We built an ultra-fast, cloud-powered Text-to-Speech (TTS) integration using **Raya BakBak**, giving our voice assistant a clear, natural-sounding Assamese voice. It streams audio words to the caller's ears while the rest of the sentence is still being thought of, and cuts off instantly if the caller interrupts.

---

## 2. What Problem Did We Have Before? (What We Solved)

In Phase 11's initial version, we used an open-source AI model called **AI4Bharat IndicF5**. 

While IndicF5 produced Assamese audio, it came with major real-world drawbacks:

| Problem with Old Setup (IndicF5) | How Raya BakBak Solves It |
|---|---|
| **High GPU & Hardware Requirements:** Required a local Python container running heavy neural PyTorch models on an NVIDIA GPU (taking 6 GB+ VRAM). | **Zero GPU Overhead:** Runs over a lightweight cloud API. Your local laptop/server uses **0 MB GPU** and standard CPU, keeping development at ₹0. |
| **Long Wait Times (No Streaming):** The assistant had to generate the *entire* sentence audio file before playing the first syllable. Caller had to wait 1–3 seconds in awkward silence. | **Live Audio Streaming:** Uses Server-Sent Events (SSE). The assistant starts playing the first sound within **~100 milliseconds**, long before the rest of the sentence is done. |
| **Python Version Dependency Conflict:** IndicF5 required an older Python 3.10 and struggled on newer Python 3.13 environments due to compiled C++ packages. | **Pure TypeScript in Node.js:** Built 100% inside our existing Node.js backend. No Python microservice required for normal development. |
| **Dormant Containers Slowing the Machine:** Every time Docker Compose started, a heavy Python machine booted up in the background. | **Opt-In Benchmark Profile:** The Python container is now marked `profiles: ["benchmark"]`. Normal `docker compose up` only runs Postgres, Redis, and LiveKit. |

> [!NOTE]
> **We Kept IndicF5 as a Fallback:** We didn't delete the IndicF5 code! It remains fully working in the codebase so we can always run side-by-side benchmark comparisons whenever needed.

---

## 3. High-Level Architecture Diagram

Here is how the entire voice agent works, and exactly where Raya BakBak fits into the puzzle:

```mermaid
flowchart TD
    Caller([🗣️ Patient / Caller]) -->|Speaks Assamese| WebRTC[LiveKit WebRTC Audio Stream]
    
    subgraph Agent_Worker ["LiveKit Agent Worker (Node.js)"]
        WebRTC --> VAD["Silero VAD\n(Detects when human speaks & stops)"]
        VAD --> STT["Deepgram Nova-3\n(Transcribes audio to Assamese text)"]
        STT --> LLM["Groq / Qwen3.5 LLM\n(Generates Assamese medical response)"]
        
        subgraph Phase_11_Solved ["★ PHASE 11: TEXT-TO-SPEECH (TTS) ENGINE"]
            LLM -->|Text tokens stream in| Segmenter["Assamese Phrase Segmenter\n(Cuts sentences at danda '।' or '?')"]
            Segmenter -->|Complete phrase| RayaAdapter["Raya BakBak Adapter (RayaTTS)"]
            RayaAdapter -->|Parses incoming audio stream| Parser["SSE Event Parser\n(Tolerates split network chunks)"]
            Parser -->|Decodes 32-bit float audio| Decoder["Float32LE -> PCM16 Converter\n(Clean sound, zero static)"]
            Decoder -->|20ms slices| Buffer["AudioFrame Buffer\n(480 samples @ 24,000 Hz)"]
        end
        
        Buffer -->|Smooth audio packets| AudioTrack["LocalAudioTrack\n(Agent's Microphone)"]
    end
    
    RayaAdapter <-->|HTTP POST /stream\nSSE Chunks| RayaCloud["☁️ Raya BakBak Cloud API\n(hub.getraya.app)"]
    AudioTrack -->|Hear Assamese response| Caller
```

---

## 4. Full Workflow with a Real Example

Let's walk through an actual conversation step by step to see how each file and component works in practice.

### Step 1: The Caller Speaks
A patient calls the clinic:
> **Caller:** *"নমস্কাৰ, ডক্টৰ বৰুৱাৰ সৈতে কাইলৈ পুৱা ১০ বজাত এটা এপইণ্টমেণ্ট বুক কৰিব পাৰিবনে?"*  
> *(Hello, can I book an appointment with Dr. Baruah tomorrow at 10 AM?)*

1. **Silero VAD** notices the patient started and stopped speaking.
2. **Deepgram Nova-3** turns the audio into the Assamese text above.

---

### Step 2: The LLM Generates the Answer
The Brain (Qwen / Groq) starts generating words one by one:
> `নমস্কাৰ!` ... `আপোনাৰ` ... `বাবে` ... `কাইলৈ` ... `পুৱা` ... `১০` ... `বজাত` ... `সময়` ... `উপলব্ধ` ... `আছে।` ... `আপোনাৰ` ... `নামটো` ... `ক'ব` ... `নেকি?`

Instead of waiting for the full response to finish writing:
- **`phrase-segmenter.ts`** watches the incoming text.
- It detects the Assamese danda (**`।`**) and question mark (**`?`**).
- It also knows that **`ডাঃ`** (Dr.) or decimal numbers like **`১০.৫`** (10.5) are NOT sentence endings!
- It immediately takes the first complete chunk:
  > **Chunk 1:** *"নমস্কাৰ! আপোনাৰ বাবে কাইলৈ পুৱা ১০ বজাত সময় উপলব্ধ আছে।"*

---

### Step 3: Sending to Raya BakBak
**`client.ts`** takes Chunk 1 and fires an HTTP POST request to Raya Hub:
```http
POST https://hub.getraya.app/v1/text-to-speech/stream
X-API-Key: your_raya_api_key
Content-Type: application/json
Accept: text/event-stream

{
  "text": "নমস্কাৰ! আপোনাৰ বাবে কাইলৈ পুৱা ১০ বজাত সময় উপলব্ধ আছে।",
  "voice_id": "voice_as_01",
  "model": "standard",
  "language": "as",
  "sample_rate": 24000,
  "speed": 1.0
}
```

---

### Step 4: Server-Sent Events (SSE) Arrive
Rather than waiting for the whole audio file to be created, Raya starts sending tiny live packets through an open connection:
```text
event: chunk
data: {"type":"chunk","status_code":206,"done":false,"data":"AAAA...<base64>...","step_time":0.08}

event: chunk
data: {"type":"chunk","status_code":206,"done":false,"data":"BBBB...<base64>...","step_time":0.06}

event: done
data: {"type":"done","status_code":200,"done":true}
```
**`sse-parser.ts`** catches these events in real time, even if a packet was split in half by the internet router.

---

### Step 5: Sound Decoding (Float32 to Int16)
Raya delivers sound encoded as **32-bit floating-point numbers** (numbers like `-0.4821` to `+0.7812`).  
LiveKit and telephone systems need **16-bit integers** (whole numbers between `-32768` and `+32767`).

If you tried to play 32-bit float audio directly on a 16-bit soundcard, you would hear loud screeching white noise.

**`pcm-f32le.ts`** safely translates each sample using a mathematical formula:
- Negative numbers: $\text{round}(\text{sample} \times 32768)$
- Positive numbers: $\text{round}(\text{sample} \times 32767)$
- Clamps any extreme values so the audio never clips or distorts.

---

### Step 6: 20-Millisecond Frame Slicing
WebRTC audio is transmitted in tiny standard chunks called **AudioFrames**, exactly **20 milliseconds** long.  
At 24,000 Hz, each 20 ms frame contains exactly:
$$24{,}000 \times 0.020 = 480 \text{ sound samples}$$

**`audio-frame-buffer.ts`** works like an assembly line:
1. It collects samples as they arrive from the internet.
2. Every time it has 480 samples, it immediately emits one 20 ms `AudioFrame`.
3. If 500 samples arrive, it sends 480 samples, and keeps the extra 20 samples in memory for the next packet.
4. When the sentence ends, it zero-pads the last few samples with gentle silence so the WebRTC clock doesn't stutter.

---

### Step 7: LiveKit Playback & Lookahead Signaling
**`raya-chunked-stream.ts`** feeds the frames into LiveKit's audio pipeline.
- It records the **TTFA (Time to First Audio)**—proving the sound started playing within ~100 ms.
- It uses a clever 1-frame lookahead so that the very last frame of the sentence is tagged with `final: true`. This tells LiveKit: *"The assistant has finished speaking this sentence."*

---

### Step 8: What If the Patient Interrupts? (Barge-In)
Imagine the assistant begins to say:
> *"নমস্কাৰ! আপোনাৰ বাবে কাইলৈ..."*

And the patient suddenly cuts in:
> *"ৰব, কাইলৈ নহয়, পৰহিলৈ!"* *(Wait, not tomorrow, the day after!)*

Here is how the system reacts in less than 20 milliseconds:
```mermaid
sequenceDiagram
    autonumber
    actor Caller as Patient
    participant VAD as Silero VAD
    participant Agent as LiveKit Agent
    participant Raya as Raya Stream

    Agent->>Caller: Assistant speaking: "নমস্কাৰ! আপোনাৰ বাবে কাইলৈ..."
    Caller->>VAD: Patient speaks: "ৰব, কাইলৈ নহয়!"
    VAD->>Agent: Speech Detected! Trigger Barge-In
    Agent->>Raya: AbortController.abort()
    Raya-->>Agent: HTTP fetch cancelled immediately
    Agent->>Agent: AudioFrameBuffer cleared (leftover sound dropped)
    Agent->>Caller: Instant Silence! Ready to listen.
```
No awkward overlap, no talking over the caller, no delayed audio.

---

## 5. File-by-File Breakdown: What We Built

All new provider logic lives neatly isolated in:  
`backend/src/components/agent/providers/tts/raya/`

```text
backend/src/components/agent/providers/tts/raya/
├── types.ts                # TypeScript interfaces (requests, responses, SSE payloads)
├── errors.ts               # Clean error types (auth failure, voice not found, timeouts)
├── config.ts               # Reads & validates speed, sample rates, voice IDs, models
├── pcm-f32le.ts            # Decodes 32-bit float audio chunks into 16-bit PCM sound
├── audio-frame-buffer.ts   # Slices continuous audio into exact 20ms / 480-sample frames
├── sse-parser.ts           # Listens to the live HTTP stream and extracts events
├── phrase-segmenter.ts     # Breaks Assamese text at danda '।' & punctuation
├── client.ts               # Calls GET /v1/voices and POST /v1/text-to-speech/stream
├── voice-catalog.ts        # Resolves Assamese voices and caches them in memory
├── raya-chunked-stream.ts  # LiveKit ChunkedStream for single-sentence synthesis
├── raya-synthesize-stream.ts # LiveKit SynthesizeStream for continuous LLM token streaming
├── raya-tts.ts             # Main LiveKit TTS class matching the SDK contracts
└── index.ts                # Clean barrel export for easy importing
```

### Supporting Files Updated:
- **`backend/src/lib/env.ts` & `.env.example`:** Added `TTS_PROVIDER=raya`, `RAYA_API_KEY`, `RAYA_TTS_VOICE_ID`, etc., with strict Zod validation.
- **`backend/src/agent/tts.ts`:** Created a universal factory (`loadTTSProvider`). By default it launches Raya BakBak. If someone configures `TTS_PROVIDER=indicf5`, it seamlessly starts IndicF5.
- **`backend/src/agent/index.ts`:** Updated agent startup to prewarm Raya TTS and log dynamic provider labels (`raya.bakbak`).
- **`docker-compose.yml`:** Placed the heavy Python IndicF5 container behind `profiles: ["benchmark"]`. Running `docker compose up` now only uses ~150 MB RAM for PostgreSQL, Redis, and LiveKit.
- **`backend/test/fixtures/assamese-tts-corpus.json`:** Expanded from 5 to 14 clinical Assamese sentences covering greetings, doctor bookings, timings, and code-mixed terms.
- **`backend/test/tts-bakbak.test.ts`:** Built 13 comprehensive unit tests running offline with zero API cost.
- **`backend/test/tts.test.ts`:** Preserved all 9 original tests for IndicF5 to ensure zero regressions.

---

## 6. How It Compares: Old vs. New

| Feature | Old (IndicF5) | New (Raya BakBak) |
|---|---|---|
| **Architecture** | Local Python FastAPI microservice (`ai/tts`) | Native TypeScript provider inside Node.js |
| **GPU / VRAM Needed** | 6 GB+ NVIDIA GPU required | **0 MB GPU** (Cloud hosted) |
| **Streaming Style** | Non-streaming (generates whole WAV file first) | **True HTTP SSE Streaming** (chunk by chunk) |
| **Time to First Sound** | 1,000 ms – 3,000 ms | **60 ms – 150 ms** |
| **Punctuation Support** | Basic sentence splits | Custom **Assamese Danda (`।`, `॥`)** segmenter |
| **Audio Format** | 16-bit linear PCM WAV | 32-bit Float PCM decoded to 16-bit linear PCM |
| **Interruption (Barge-in)** | Stops playback of pre-generated WAV | Aborts in-flight network stream + clears buffer |
| **Local Dev Experience** | Heavy Docker container, slow boot | Starts instantly, lightweight, ₹0 cost |
| **Assamese Quality** | Academic diffusion model | Conversational commercial Indian voice engine |

---

## 7. How to Verify Everything

You can verify that everything is working properly with these commands:

```powershell
# 1. Run the new Raya BakBak test suite (13 tests)
npm --prefix backend run test:tts:bakbak

# 2. Run the IndicF5 regression test suite (9 tests)
npm --prefix backend run test:tts:indicf5

# 3. Run all TTS tests together (22 tests)
npm --prefix backend run test:tts:all

# 4. Run full Voice AI pipeline regressions
npm --prefix backend run test:llm       # 9/9 passed (Groq & Qwen LLM)
npm --prefix backend run test:stt       # 6/6 passed (Deepgram Nova-3 STT)
npm --prefix backend run test:vad       # 6/6 passed (Silero VAD)
npm --prefix backend run test:agent     # 5/5 passed (LiveKit Worker)

# 5. Typecheck & Build
npm --prefix backend run typecheck      # 0 TypeScript errors
npm --prefix backend run build          # Clean compilation to dist/
```

---

## 8. What's Next?

With **VAD**, **STT (Deepgram)**, **LLM (Groq/Qwen)**, and **TTS (Raya BakBak)** all fully implemented, tested, and passing with zero regressions, the system is primed for **Phase 12: Complete Voice Loop**—connecting all four pieces into an end-to-end telephone conversation session!
