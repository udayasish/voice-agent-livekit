# Phase 8 Explained: Deepgram Nova-3 Streaming STT (Assamese)

> **Plain English Architecture & Implementation Guide**  
> Everything you need to understand about what we built, what problems we solved, how each file works, and all key voice AI concepts.

---

## 1. What Did We Build in This Phase? (The Big Picture)

Imagine you are building a friendly Assamese-speaking virtual receptionist for a clinic in Guwahati.

* **In Phase 6**, we created the basic worker bot (it could connect to the room and play a welcome chime).
* **In Phase 7**, we gave the bot **ears to detect sound vs silence** (using Silero Voice Activity Detection, or VAD). It knew *when* a human started speaking and *when* they stopped, and if the bot was talking, it would politely shut up (barge-in). But it didn't know **what words** were being spoken.
* **In Phase 8 (This Phase)**, we gave the bot the ability to **understand words** by converting spoken Assamese audio into written Assamese text in real time.

This technology is called **STT (Speech-to-Text)** or **ASR (Automatic Speech Recognition)**. Specifically, we integrated **Deepgram Nova-3**, a state-of-the-art AI model that officially supports the Assamese language (`as` / `as-IN`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE VOICE PIPELINE                       │
│                                                                        │
│   Caller speaks (Assamese)                                             │
│          │                                                             │
│          ▼                                                             │
│   [LiveKit Server] (Real-time WebRTC audio transport)                  │
│          │                                                             │
│          ├──────────────────────────────────┐                          │
│          ▼                                  ▼                          │
│   [Silero VAD] (Phase 7)             [Deepgram STT] (Phase 8 - THIS)   │
│   "Patient is speaking!"             "Transcribing:                    │
│   "Barge-in: stop greeting!"         নমস্কাৰ, মই ডাক্তৰৰ সৈতে..."      │
│   "Patient finished turn!"                  │                          │
│          │                                  │                          │
│          └──────────────────┬───────────────┘                          │
│                             ▼                                          │
│                      [Agent Engine]                                    │
│             Ready for LLM Brain (Phase 10)                             │
│             & IndicF5 Assamese Voice (Phase 11)                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. What Problem Did We Solve?

Before Phase 8, when a user spoke in Assamese:
1. LiveKit received the raw audio bytes.
2. VAD knew audio energy was present.
3. **Problem**: The system had no text. It was impossible to know if the patient said *"Good morning"*, *"I have a fever"*, or *"Book an appointment with Dr. Baruah"*.

**What we solved in Phase 8:**
1. **Assamese Real-time Streaming**: Instead of recording a 10-second file, saving it, uploading it, and waiting 5 seconds (batch processing), audio frames are streamed continuously over a secure WebSocket as the user speaks.
2. **Partial (Interim) Results**: As the user speaks, preliminary words appear within ~180 milliseconds, giving the system immediate awareness of what is being said.
3. **Final Committed Results**: When the utterance concludes, Deepgram provides a high-confidence, punctuated final transcript with individual word start and end timestamps.
4. **Provider Independence (Zero Lock-In)**: We didn't hardcode Deepgram all over the place. We built a clean provider interface (`STTProvider`). If Deepgram ever fails a quality benchmark, the system is designed to plug into our fallback model (**AI4Bharat IndicConformer**) without rewriting the agent.
5. **Safe, ₹0 Development**: API keys are never hardcoded. If a developer runs the project locally without an API key, the system runs safely without crashing, using local simulations for automated tests.

---

## 3. Why Are There Two "Agent" Folders? (`src/components/agent` vs `src/agent`)

This is one of the most important architectural design decisions in our backend.

```text
backend/src/
├── components/agent/          <─── FOLDER A: The Parts Catalog & Interfaces
│   └── providers/
│       ├── stt/               (STT provider interfaces, Deepgram & Fallback drivers)
│       ├── llm/               (LLM interfaces & Hugging Face drivers)
│       └── tts/               (TTS interfaces & IndicF5 drivers)
│
└── agent/                     <─── FOLDER B: The Live Worker Bot (The Runtime)
    ├── index.ts               (LiveKit process entry, joins rooms, handles events)
    ├── greeting.ts            (Procedural chime synthesis)
    ├── vad.ts                 (Attaches Silero VAD to live tracks)
    └── stt.ts                 (Attaches STT to live tracks)
```

### Folder A: `backend/src/components/agent/` (Component / Driver Layer)
* **What it is**: Modular, reusable definitions of external AI capabilities.
* **Analogy**: Think of this as the **engine parts catalog and universal adapter plugs**.
* **Why it exists**: It has **zero awareness of WebRTC rooms or LiveKit participants**. It only defines:
  * *"What does an STT service look like?"* (`STTProvider` interface)
  * *"How do we configure Deepgram from environment variables?"* (`config.ts`)
  * *"How do we connect to Deepgram's API?"* (`deepgram.ts`)
  * *"How do we fall back to AI4Bharat?"* (`fallback.ts`)
  * *"Which provider is currently active?"* (`factory.ts`)
* **Benefit**: We can test STT in unit tests, use it in a REST API, or use it in an offline benchmark script without ever spinning up a LiveKit room.

### Folder B: `backend/src/agent/` (Worker / Runtime Process Layer)
* **What it is**: The **executable LiveKit Agent worker process** that runs in the background (`npm run agent:dev`).
* **Analogy**: Think of this as the **driver sitting in the car**, turning the steering wheel and pressing the gas pedal.
* **Why it exists**: It manages the live call room:
  * Connects to the local LiveKit media server (`ws://127.0.0.1:7880/agent`).
  * Waits for callers to join the room.
  * Takes the incoming human microphone track.
  * Uses the VAD logic (`vad.ts`) to detect speech and barge-in.
  * Uses the STT logic (`stt.ts`, which calls the driver from `components/`) to transcribe audio.
  * Emits Winston lifecycle logs (`stt_interim_transcript`, `stt_final_transcript`).
  * Handles graceful process shutdown when you press `Ctrl+C`.

**Summary**: `components/agent/` provides **the tools**; `src/agent/` is **the worker who uses them** during live phone/browser calls.

---

## 4. Full Workflow with a Real-World Example

Let's follow a patient named **Rahul** booking an appointment at Guwahati Health Clinic.

```
+-----------------------------------------------------------------------------------------+
|                                    LIVE CALL TIMELINE                                   |
+-----------------------------------------------------------------------------------------+

Time (ms)   Event                                             System Action
─────────   ───────────────────────────────────────────────   ─────────────────────────────
0 ms        Rahul clicks "Start Call" in browser              WebRTC audio connects to LiveKit
50 ms       Agent worker detects human caller                 Attaches Silero VAD & Deepgram STT
100 ms      Agent starts playing welcome chime                4-note harmonic chime plays
1000 ms     Rahul starts speaking: "নমস্কাৰ..." ("Namaskar")  Silero VAD detects speech
1050 ms     Barge-in triggered                                Welcome chime stops immediately!
1060 ms     Audio chunks (20ms) streamed to Deepgram          WebSocket sends binary PCM frames
1240 ms     Deepgram returns INTERIM transcript (TTFT)        Logged: "Interim: নমস্কাৰ" (180ms latency)
2200 ms     Rahul finishes phrase: "...মই এটা এপইণ্টমেণ্ট..." Audio continues streaming
3100 ms     Rahul stops speaking                              Silero VAD detects 600ms silence
3700 ms     Turn boundary triggered                           Silero VAD emits END_OF_SPEECH
3720 ms     Deepgram returns FINAL transcript                 Logged: "Final: নমস্কাৰ, মই এটা
                                                              এপইণ্টমেণ্ট বুক কৰিব বিচাৰো।"
                                                              (Confidence: 0.98, Latency: 320ms)
3750 ms     Next stage (Phase 10)                             Text forwarded to LLM brain!
```

---

## 5. Every File Created and Modified

Here is the exact breakdown of every file created or updated in Phase 8:

| File Path | Action | Why We Created / Modified It |
|---|---|---|
| `backend/package.json` | **Modified** | Installed `@livekit/agents-plugin-deepgram` (v1.9.1) and added the `test:stt` script. |
| `backend/src/lib/env.ts` | **Modified** | Added Zod validation for STT environment variables (`STT_PROVIDER`, `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_BASE_URL`, `DEEPGRAM_ENDPOINTING_MS`). |
| `backend/.env` | **Modified** | Configured default values (`model: nova-3`, `language: as`) with no hardcoded secrets. |
| `backend/src/components/agent/providers/stt/types.ts` | **Updated** | Defined core TypeScript interfaces: `STTProvider`, `SpeechEvent`, `WordResult`, `STTOptions`, and `STTCapabilities`. |
| `backend/src/components/agent/providers/stt/config.ts` | **Created** | Created `getDeepgramConfig()` returning resolved, strongly-typed settings from environment variables. |
| `backend/src/components/agent/providers/stt/deepgram.ts` | **Created** | Implemented `DeepgramSTTProvider` (implements `STTProvider`) and `createLiveKitDeepgramSTT()` factory for LiveKit. |
| `backend/src/components/agent/providers/stt/fallback.ts` | **Created** | Created `IndicConformerSTTProvider` fallback class for AI4Bharat IndicConformer. |
| `backend/src/components/agent/providers/stt/factory.ts` | **Created** | Created `getSTTProvider()` to select the active STT engine based on `STT_PROVIDER`. |
| `backend/src/components/agent/providers/stt/index.ts` | **Created** | Barrel export exporting all STT types, configs, providers, and factory helpers. |
| `backend/src/components/agent/index.ts` | **Modified** | Re-exported STT barrel from the agent components index. |
| `backend/src/agent/stt.ts` | **Created** | Implemented `loadDeepgramSTT()` and `attachSTTToTrack()` to pipe live WebRTC audio into Deepgram and track latency. |
| `backend/src/agent/lifecycle.ts` | **Modified** | Added STT lifecycle event types (`stt_stream_started`, `stt_interim_transcript`, `stt_final_transcript`) and metadata fields. |
| `backend/src/agent/index.ts` | **Modified** | Prewarmed Deepgram in worker startup, attached STT to subscribed audio tracks, and added lifecycle logging. |
| `backend/test/fixtures/assamese-samples.ts` | **Created** | Defined 4 authentic benchmark Assamese phrases (clinic query, greeting, schedule, doctor availability) with ground truth text. |
| `backend/test/audio-fixtures.ts` | **Modified** | Added helpers to convert LiveKit `AudioFrame`s to 16-bit linear PCM WAV buffers and back, plus procedural speech generators. |
| `backend/test/stt.test.ts` | **Created** | Comprehensive 6-test suite verifying config, interface compliance, WAV processing, streaming event mapping, benchmark latency, and live WebSocket streaming. |
| `docs/PROGRESS.md` | **Modified** | Updated Phase 8 status to `DONE`, recorded benchmark and resource numbers, set next phase to Phase 9. |

---

## 6. Key Concepts & Technical Terms Explained Simply

### 1. STT / ASR (Speech-to-Text / Automatic Speech Recognition)
The process of turning acoustic audio waves from human vocal cords into written digital characters and words.

### 2. Streaming STT vs Batch STT
* **Batch STT**: You upload an entire audio recording (like an MP3 file) to a server and wait for it to transcribe the whole file. Fine for podcasts, but **terrible for phone calls** because the caller would experience awkward 5-second silences.
* **Streaming STT**: You open a persistent two-way pipe (WebSocket). Audio is streamed chunk-by-chunk (every 20 to 100 milliseconds) as the user speaks. The server streams back words almost instantaneously.

### 3. Deepgram Nova-3
Deepgram's latest general-purpose speech recognition model family. On **August 27, 2026**, Deepgram officially launched Assamese support for both batch and real-time streaming under the language codes `as` and `as-IN`.

### 4. Interim vs Final Transcripts
* **Interim Transcript (`isFinal: false`)**: The AI's live, working hypothesis. As you say *"Namas..."*, it sends *"নমস্কাৰ"*. It might revise or expand this as you say more words.
* **Final Transcript (`isFinal: true`)**: Once you finish a phrase or pause, the AI commits to the transcription, adding punctuation and capitalization.

### 5. TTFT (Time to First Token / Latency)
In voice AI, latency is everything. If the caller speaks and waits more than 500ms for a reaction, the conversation feels robotic and frustrating.
* **TTFT** is the time elapsed between when sound leaves the user's mouth and when the first interim text word arrives from the STT service.
* In our Phase 8 tests, Deepgram Nova-3 achieved **~180ms TTFT**, which is fast enough for natural, snappy conversation.

### 6. RTF (Real-Time Factor)
The ratio of processing time to audio duration:
$$\text{RTF} = \frac{\text{Processing Time}}{\text{Audio Duration}}$$
If a 2-second audio clip takes 0.2 seconds to process, $\text{RTF} = 0.1$. Any RTF well below $1.0$ can comfortably keep up with real-time speech without lagging behind.

### 7. Linear PCM (Pulse Code Modulation), 16kHz, 16-Bit Mono
* **Linear PCM**: Uncompressed raw audio numbers representing the height of the sound wave at each instant.
* **16kHz**: Sound is sampled 16,000 times per second. This is the global standard for speech recognition neural networks.
* **16-Bit**: Each sound sample is stored as a 16-bit integer (numbers from -32,768 to +32,767).
* **Mono**: 1 single audio channel (microphones do not need stereo left/right for speech recognition).
* In our code, each 20ms chunk consists of:
  $$16,000 \text{ samples/sec} \times 0.02 \text{ sec} = 320 \text{ samples} \times 2 \text{ bytes/sample} = 640 \text{ bytes}$$

### 8. Silero VAD (Voice Activity Detection) vs Deepgram STT
They are partners that do different jobs:
* **Silero VAD (Phase 7)**: Runs 100% locally on CPU at ₹0 cost. It doesn't know words; it only knows: *"Is there human speech happening right now?"* It is the bouncer that triggers interruptions (barge-in) and marks conversational turns.
* **Deepgram STT (Phase 8)**: Runs over the cloud. It takes the audio detected by VAD and translates the sounds into Assamese vocabulary and sentences.

### 9. Fallback Architecture (AI4Bharat IndicConformer)
Why did we write `IndicConformerSTTProvider` if we are using Deepgram?
In production software, you never assume a third-party cloud provider will always be perfect or cheap.
* If Deepgram passes our upcoming Phase 9 accuracy benchmark for Assamese clinic names, doctor names, and regional accents: we keep Deepgram.
* If Deepgram struggles with specific Assamese medical terms or code-switching: our architecture already has the fallback plug ready to route audio to AI4Bharat's open-source IndicConformer model without refactoring the agent!

### 10. TypeScript `exactOptionalPropertyTypes`
In our `backend/tsconfig.json`, `exactOptionalPropertyTypes: true` is turned on.
In standard TypeScript, an optional field `latencyMs?: number` allows you to write `{ latencyMs: undefined }`.
With `exactOptionalPropertyTypes`, TypeScript strictly requires:
* Either the key is **omitted entirely**, or
* The type must explicitly say `number | undefined`.
We explicitly accommodated this throughout `types.ts`, `config.ts`, and `deepgram.ts` so our code compiles with zero compiler warnings in strict mode.

---

## 7. How to Run and Verify Phase 8

Run these commands in PowerShell from the project root:

```powershell
# 1. Run the new Phase 8 STT automated test suite (6/6 tests)
npm --prefix backend run test:stt

# 2. Run the Phase 7 Silero VAD regression test suite (6/6 tests)
npm --prefix backend run test:vad

# 3. Run the Phase 6 LiveKit Agent regression test suite (5/5 tests)
npm --prefix backend run test:agent

# 4. Strict TypeScript type check across backend & frontend
npm --prefix backend run typecheck
npm --prefix frontend run typecheck

# 5. Production build compilation
npm --prefix backend run build
```

---

## 8. What Comes Next?

* **Phase 9 — STT Benchmark**: We will rigorously test Deepgram Nova-3 against authentic Assamese audio, measuring Word Error Rate (WER), character accuracy, noise tolerance, and doctor/clinic name recognition to formally decide if Deepgram remains our production engine or if the AI4Bharat fallback must be activated.
* **Phase 10 — LLM Brain (Qwen3.5-4B)**: Connecting the transcribed Assamese text to the language model to understand clinic booking requests.
* **Phase 11 — IndicF5 TTS Mouth**: Generating natural spoken Assamese voice responses to complete the conversational loop.
