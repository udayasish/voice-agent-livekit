# Assamese AI Voice Agent Platform — Voice & AI Architecture

## 1. Realtime Pipeline

```text
Audio Input
   |
LiveKit
   |
Silero VAD
   |
Speech segment
   |
Deepgram Nova-3 STT
   |
Assamese/Hindi/English text
   |
Agent Engine
   |
Conversation State
   |
LLM
   |
Tool Call? ---- YES ---> Tool Executor ---> PostgreSQL/API
   |                                      |
   |<------------- Tool Result -----------|
   |
Generate final response
   |
IndicF5 TTS
   |
Audio frames
   |
LiveKit
   |
User
```

## 2. Realtime Responsibilities

LiveKit owns:
- media transport
- room/session
- participants
- realtime audio
- interruption primitives
- SIP integration

Agent code owns:
- business reasoning
- configuration
- state
- tool calls
- response policy

## 3. VAD

Initial choice:
- Silero VAD through LiveKit

VAD answers:
- did the user start speaking?
- is the user still speaking?
- has the user stopped speaking?

Initial tuning is only a starting point.

Tune against real Assamese recordings.

Typical symptoms:
- agent interrupts user -> increase end-of-speech silence
- response feels slow -> reduce silence
- first word clipped -> increase prefix padding
- background noise triggers turns -> adjust threshold/noise handling

## 4. STT

Initial:
- Deepgram Nova-3
- Assamese support

Deepgram is the initial STT provider. AI4Bharat IndicConformer remains a fallback option only if the Assamese STT benchmark shows that Deepgram is not sufficient.

Integration:

```text
LiveKit Agent
   |
Deepgram streaming STT
   |
stream/final transcript
```

The STT service must be isolated from the dashboard and ordinary API.

Benchmark:
- Assamese
- Hindi
- English
- code switching
- names
- doctor names
- locations
- dates/times
- noisy rooms
- phone-quality audio
- different accents
- fast speech

Measure:
- word accuracy
- semantic accuracy
- first-token latency
- final transcription latency
- CPU/RAM/GPU
- concurrent sessions

## 5. LLM

Initial:
- Hugging Face Inference Providers
- Qwen3.5-4B

The model must:
- understand Assamese
- understand Hindi/English
- preserve language preference
- avoid inventing appointment availability
- use tools for business facts
- ask for missing information
- confirm important actions

The LLM must NOT:
- query PostgreSQL directly
- invent doctors/rooms/slots
- claim a booking succeeded without tool confirmation
- execute arbitrary code
- change system configuration

## 6. TTS

Initial:
- AI4Bharat IndicF5

Integration:

```text
LLM text
   |
custom TTS node
   |
Python TTS service
   |
IndicF5
   |
audio
   |
LiveKit
```

Benchmark:
- Assamese pronunciation
- naturalness
- latency
- sentence chunking
- names
- numbers
- dates
- code-switched text

## 7. Barge-In

Required behavior:

```text
Agent is speaking
      |
User starts speaking
      |
VAD detects speech
      |
Stop/interrupt agent audio
      |
Capture user turn
      |
STT
      |
Agent continues
```

Never allow the agent to keep talking over the user after a confirmed interruption.

## 8. Agent State

The reusable runtime lives in `backend/src/components/agent/engine/`; LiveKit integration lives in `backend/src/agent/`. This follows the existing backend layout rather than introducing a separate service/package in Phase 14.

The engine separates session lifecycle from conversation state:

```ts
SessionContext    // organizationId, agentId, sessionId
SessionState      // active/closed, monotonic turn IDs, timestamps
ConversationState<T> // messages, toolHistory, language, repetition tracking, validated businessState
AgentConfig       // name/business, instructions, languages, greeting, model settings, recovery messages, enabledTools
```

Active state:
- Redis
- organization/session-scoped snapshots, serialized writes, refreshed 30-minute TTL
- delete on close; storage failure closes the affected session

Permanent outcome:
- PostgreSQL
- permanent call/outcome persistence is deferred to later phases

The engine uses the installed `@openai/agents` `Agent` and `Runner` with an SDK `Model` adapter over the existing `LLMProvider`. Vendor selection and credentials remain outside the core. SDK tracing/export processors are disabled; Winston receives operational IDs, events and timing, without transcripts or provider payloads.

`AgentSession<T>` provides `ready`, `processUserUtterance`, `chat`, immutable state/history/snapshot access, `reset`, `notifyInterruption` and idempotent `close`. Generation is buffered before approved response text and replay chunks are returned. Both entry points use the same prompt/response policy. Provider errors and empty output use localized recovery. Phase 15 adds optional injected tools; the default empty allowlist preserves existing voice sessions and rejects unsolicited calls.

New turns supersede in-flight generation. Cancellation retains the accepted user message and discards late output without recovery speech. Interrupted playback is marked in history and excluded from later model context. Reset preserves monotonic IDs. The existing `InterruptionManager` remains the authority for audio abort signals, native queue clearing and frame delivery.

Business behavior is injected through `BusinessBehavior<T>` with a Zod state schema, an initial state, an update operation, prompt context and optional response guidance. The clinic intake demo is isolated under `business/clinic-demo.ts`; phone normalization remains a reused domain utility. It captures requested details without inventing dates/availability or confirming bookings. The mock provider is business-neutral. A hotel test configuration exercises the same engine without clinic code branches.

The response guidance hook also receives the previous approved reply. The optional `onResponse` hook returns validated business state after the approved reply; this records the question actually asked, including model-generated intake questions. Clinic intake uses that context to interpret short doctor/name answers, accepts spoken title spellings including `ডঃ`, and clarifies unrecognized details without repeating the exact same prompt. Worker diagnostics report only whether each detail is present and whether the reply repeated, without logging the detail values.

Empty or formatting-only model output retries once only when no tool invocation has been attempted, respecting cancellation and preserving a single accepted user/history turn. Recovery policy applies after business guidance and removes internal reasoning text before speech. `fallbackReason` distinguishes empty output, provider failure and repeated-response replacement; empty-output events include provider completion reason/token counts when available. No sensitive provider payload is logged. The sandbox Safe Guard tooltip explains the category.

STT final-transcript callbacks dispatch without blocking the speech-event consumer on LLM generation or TTS playback. A finalized Deepgram segment is not a completed caller turn. `backend/src/agent/turn-collector.ts` groups final segments, preserves repeated words/digits, and waits for a quiet interval: 1,200 ms normally and 3,000 ms when the sandbox adapter is collecting a phone number. VAD speech start cancels the timer and immediately interrupts ongoing generation/playback through `InterruptionManager`; VAD speech end, interim results and later final segments refresh the listening window. The interval starts after the latest such activity, so VAD/STT latency is additional. Pending fragments/timers are discarded on participant departure, room disconnect and shutdown. Existing TTFT/total generation metrics exclude this listening interval.

Phone drafts and confirmation belong to the isolated clinic demo, not the engine or collector. Valid digit fragments are retained across turns, including a multiplier split from its following digit. Unknown tokens, extra digits and incomplete numbers trigger clarification without guessed digits. Full valid retries replace a draft; callers can explicitly restart it. The completed number is read back and requires an affirmative answer; a negative answer clears it. Full doctor names and explicitly supplied morning/clock information are preserved. This does not validate a doctor's identity, improve recognition accuracy, or book an appointment.

The phone normalizer splits joined word/numeral boundaries (for example `ছেভেন00`) while retaining unknown words as ambiguous. A multiplier applied to an entire numeric run requires clarification. An incomplete transcript does not establish where a digit was lost: prompts allow continuation if the caller has not finished, or a complete digit-by-digit retry if they have. Repeated unclear-number prompts vary their guidance to avoid generic repetition recovery. Guided group collection and typed/DTMF fallback are recommendations for further work, not implemented features.

The clinic sandbox requests English digit dictation. Before speaking that prompt, the worker sets the participant's STT input mode to `english-digits`: Deepgram Nova-3 `language=en-IN`, `numerals=true`, `smartFormat=false`, `punctuate=false`. On entering confirmation it restores the configured conversation recognition settings, including Assamese by default. `attachSTTToAudio` owns one continuous audio reader and replaces only the recognizer; incoming frames queue in the replacement during connection setup. Superseded recognizers cannot emit stale transcripts or close the current audio reader. Close/abort cancels the reader, closes the recognizer and removes the abort listener. The shared prewarmed STT provider is never reconfigured. Winston logs `stt_input_mode_changed` with mode/language and operational identifiers only.

The generic engine's validated `TurnOptions.responseLanguage` can preserve the conversational reply language independently of specialized input recognition. The sandbox adapter uses it during phone capture, so English digits do not switch an Assamese conversation's replies to English. Phone confirmation accepts natural affirmative sentences in the supported languages, checks negation first, and leaves unclear/questioning answers unconfirmed. An unclear answer gets a short yes/no clarification rather than repeated full readback. This confirms only the collected number, never a booking. Stream behavior is tested with deterministic streams and the real Deepgram SDK against a local WebSocket server; microphone recognition accuracy still needs live validation.

Groq's Qwen 3 adapter explicitly requests non-reasoning/hidden output for voice, uses the documented completion-token field, and preserves completion metadata. Generic live text probes validate that adapter; they do not replace live browser/audio testing.

The LiveKit worker validates participant organization metadata and creates one engine session per participant. STT confidence and acoustic echo filters, speech providers and diagnostic DataChannel fields remain compatible. Participant departure, room disconnect and job shutdown close subscriptions and sessions.

Phase 14 limitations: snapshots are active state, not crash-resumable sessions; greetings remain transport-managed; voice quality and cloud inference need their existing live validation procedures. Generic factuality rules are prompt constraints, not a semantic proof of model claims. The clinic demo uses deterministic intake responses; real business actions require the typed tool system in subsequent phases.

## 9. Tool Architecture

Phase 15 implements reusable typed functions in `backend/src/components/agent/tools/`. Only explicitly enabled tools are adapted into SDK function tools. The engine injects server-owned context into the SDK run; it never obtains tenant identity from model arguments. Tool definitions validate both input and successful output and return the standard success/error envelope.

```text
Provider function call -> SDK Runner -> ToolExecutor -> validated handler
                       <- SDK Runner <- ToolResult  <- output validation
Final assistant reply -> shared response policy -> buffered speech
```

The SDK owns the loop (maximum five model turns); the executor serializes handlers with four attempts and a five-second timeout by default. Matching invocation IDs reuse their cached result within the run, conflicting reuse is rejected, and executed sequences are never restarted to recover an empty spoken reply. Cancellation propagates into handlers and discards late results. A timeout stops further handlers in that run. Validated call/result pairs are retained in active session state and replayed next turn; interrupted and superseded pairs are excluded.

Groq and Hugging Face support fragmented streaming function calls, multiple correlated results and equivalent non-streaming responses through `providers/llm/chat-protocol.ts`. SDK 0.8 pre-parses malformed JSON before tool invocation; the adapter routes syntax errors through a reserved, always-invalid argument so our executor returns a safe validation envelope instead of SDK exception text. SDK tracing and model/tool payload logging are disabled. Winston records operational identifiers, tool names, duration and error codes.

The harmless `get_server_time` tool has strict empty input and returns a validated UTC timestamp from an injected clock. Run `npm run smoke:tools` in `backend/` for an offline demonstration using the real SDK with a deterministic provider. The live clinic demo still has an empty allowlist; its listening, recognition and confirmation backlog is unchanged. No database/network/business tool or persisted call record was added. This phase validates mocked vendor protocols; cloud tool-calling behavior still needs later live qualification.

Future business-tool example (not implemented in Phase 15):

```ts
bookAppointment({
  doctorId,
  patientName,
  patientPhone,
  slotId,
})
```

Execution:

```text
LLM
 -> validate tool arguments with Zod
 -> execute Node service
 -> DB transaction
 -> result
 -> LLM
```

Critical booking operations must be transactional and protected against double booking.

### Phase 16 clinic service boundary (internal adoption only)

The clinic implementation now lives in `backend/src/components/clinic/`, adapted from the existing WhatsApp appointment platform and backed by the voice repository's independent PostgreSQL database. It exposes strict, scoped service contracts for doctor/slot lookup, patient creation, booking and cancellation, plus operator scheduling/date-blocking operations. Source provenance and contracts are documented in `CLINIC_SERVICE_ADOPTION.md` and `DATA_MODEL_AND_API_CONTRACT.md`.

No clinic tools or worker integration are enabled in this milestone. The browser conversation continues using the isolated intake demo and cannot prove database booking. Future Phase 17 tools must bind trusted organization context and verified patient scope, then call these services through the Phase 15 executor. The LLM, model providers and reusable engine continue to have no PostgreSQL access.

Services preserve concrete slot capacity (default 30), doctor/day tokens and transaction/advisory/row locks. They derive appointment date/time from the database, validate caller-supplied patient details, and expose successful booking separately from reminder/alert scheduling outcomes. Missing/failed notification delivery configuration never means an appointment failed or a message was sent. Durable business idempotency and patient-ownership verification must be settled before live callers can trigger actions. Existing speech/intake inconsistencies remain in the live voice backlog.

## 10. Human Handoff

The agent must be able to call:

```text
transfer_to_human()
```

Before transfer:
- preserve call context
- store conversation state
- store reason
- identify organization
- mark call as transferred

## 11. Failure Handling

If STT fails:
- ask user to repeat
- retry when safe
- escalate after repeated failures

If LLM fails:
- use fallback response
- retry once where safe
- transfer when necessary

If TTS fails:
- retry
- if still failing, terminate/transfer according to policy

If booking tool fails:
- never tell the user it succeeded
- explain that booking could not be confirmed
- offer retry/human transfer

## 12. Provider Abstraction

Do not hard-wire business logic to a specific model vendor.

```text
STTProvider
LLMProvider
TTSProvider
```

Initial implementation:

```text
Deepgram Nova-3
Qwen3.5-4B via Hugging Face Inference Providers
IndicF5
```

The LLM integration must use the provider abstraction. Hugging Face provides an OpenAI-compatible chat-completions endpoint, so the Agent Engine can later switch to a self-hosted vLLM endpoint without changing business tools or conversation logic.

Future providers can be added behind the same interfaces.

## 13. LiveKit Custom Nodes

LiveKit Agents supports custom STT/LLM/TTS pipeline nodes, making it possible to connect self-hosted AI4Bharat services rather than requiring an official provider plugin.

Reference:
https://docs.livekit.io/agents/logic/nodes/

## 14. Development Rule

Do not begin PSTN integration before the browser voice loop works reliably.

Do not begin production scaling before measuring:
- audio quality
- STT latency
- TTS latency
- LLM latency
- total turn latency
- concurrent calls
