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

Example:

```ts
type ConversationState = {
  intent?: "appointment_booking" | "appointment_cancel" | "general_query";
  doctorId?: string;
  date?: string;
  time?: string;
  patientName?: string;
  patientPhone?: string;
  confirmed?: boolean;
};
```

Active state:
- Redis

Permanent outcome:
- PostgreSQL

## 9. Tool Architecture

Tools are typed functions.

Example:

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
