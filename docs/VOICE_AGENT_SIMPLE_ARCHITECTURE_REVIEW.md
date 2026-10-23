# Simple Review of the Assamese Voice Agent

**Review date:** 24 October 2026  
**Result:** The basic technology is correct. The booking conversation in the middle is too complicated.

## The main finding

We do **not** need a different STT, TTS or agent framework to fix the current booking problem.

The main gap is this:

> The LLM and several code rules can all decide what the caller meant and what question comes next.

Because control is shared, the agent may speak as if a date or time was selected even when that value was not saved. It can then ask the same question again.

The simpler design is:

> **The LLM understands the words. One backend booking flow controls the steps. Tools read or change real data.**

## What happens now

```text
Caller speaks
   ↓
LiveKit sends audio
   ↓
Silero VAD finds the end of the caller's turn
   ↓
Deepgram STT changes speech into text
   ↓
Clinic code, regex rules and a special intake LLM inspect the text
   ↓
The main LLM may also inspect the same turn and call tools
   ↓
Clinic tools read doctors, dates and times, or book in PostgreSQL
   ↓
More code checks or replaces the reply
   ↓
Raya TTS changes the final text into speech
```

This is a normal **cascaded voice pipeline**. LiveKit also describes this pattern as STT → LLM/workflow → TTS. The problem is not the pipeline. The problem is that the middle has too many decision makers.

## When each model is called

| Part | When it runs | Its job |
|---|---|---|
| **STT** | During every caller speech turn | Change Assamese audio into text. Phone capture temporarily uses English-digit recognition. |
| **LLM** | After a useful final transcript | Understand meaning, produce a reply and sometimes request a tool. A second small LLM call may also interpret patient details, date/time choices or confirmation. |
| **Clinic tools** | When real business data is needed | Find doctors, get real slots, resolve the patient, prepare a booking, and commit a confirmed booking. |
| **TTS** | After the final reply is accepted | Change the reply text into audio. It also speaks the saved opening greeting. |

## How an appointment is booked now

1. Find or list a real doctor.
2. Read real available dates from the database.
3. Read real available times for the selected date.
4. Collect patient name, age and phone number.
5. Read the phone number back and confirm it.
6. Create a booking draft and read all details back.
7. Wait for a later clear “yes”.
8. Run the transactional booking service.
9. Say “booked” only after the service returns the appointment and token.

The database part is strong: organization scope, strict tool input, locks, capacity checks, idempotency and confirmation are enforced on the server. The LLM does not access PostgreSQL directly.

## What is good

- LiveKit, VAD, STT, LLM, tools and TTS are separated.
- Business facts come from tools, not from the LLM.
- Booking uses a safe PostgreSQL transaction.
- The caller must hear a full readback and confirm before booking.
- Tool inputs are validated and organization identity is server-owned.
- Barge-in, interruption cancellation and session state already exist.

## What needs to change

Use one small, clear booking state machine:

```text
CHOOSE_DOCTOR
→ CHOOSE_DATE
→ CHOOSE_TIME
→ GET_NAME
→ GET_AGE
→ GET_PHONE
→ CONFIRM_PHONE
→ CONFIRM_BOOKING
→ BOOKED
```

For every caller turn:

1. First use simple exact parsing for digits, known doctor names and offered options.
2. If the text is still unclear, call the LLM **once** to return structured meaning such as intent, date, time, name, age or correction.
3. Validate that result against the current step and real offered records.
4. Save an accepted value once.
5. Let the backend choose the next step and exact question.
6. Call a tool only when that step needs real data or a real action.

The LLM may help with friendly general conversation outside the booking flow. During booking, it must not say that a choice was accepted, that booking started, or that booking succeeded unless the backend state proves it.

We do not need many separate LLM agents for this clinic. One clinic agent, one booking workflow and typed tools are enough. A hotel can later use the same voice pipeline with its own reservation workflow and tools.

## Assamese-specific work

- Keep Assamese as the main STT language.
- Benchmark real Assamese recordings, including code-switching, names, dates, times and ages.
- Give STT reviewed doctor and clinic names as dynamic key terms where the provider supports them.
- Use a reviewed Assamese/Hindi/English number normalizer before the LLM.
- Ask a short clarification when STT or the LLM is uncertain. Never guess a nearby date or time.

## Final judgement

| Area | Judgement |
|---|---|
| Voice pipeline | Good foundation |
| Booking database and security | Strong |
| Tool boundaries | Strong |
| Assamese speech quality | Works, but needs a real benchmark |
| Conversation control | Too complex and is the main gap |
| Best next step | Replace shared control with one backend-owned booking flow |

## Main code reviewed

- `backend/src/agent/index.ts` — audio, VAD, STT and TTS loop
- `backend/src/components/agent/engine/session.ts` — main LLM and tool loop
- `backend/src/components/clinic/voice/runtime.ts` — clinic state and booking control
- `backend/src/components/clinic/voice/dialogue.ts` — doctor/date/time state
- `backend/src/components/clinic/voice/intake.ts` — structured intake LLM
- `backend/src/components/clinic/services/create-appointment.ts` — booking transaction

## Industry references

- [LiveKit: cascaded STT–LLM–TTS pipelines](https://docs.livekit.io/agents/models/pipelines/)
- [OpenAI Agents SDK: the agent and tool loop](https://openai.github.io/openai-agents-js/guides/running-agents/)
- [Google Dialogflow CX: required fields and server-controlled form filling](https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter)
- [Rasa: flow steps, collected values and validation](https://learning.rasa.com/rasa-pro/flows/)
- [Deepgram: Nova-3 key-term prompting](https://developers.deepgram.com/docs/keyterm)
- [OpenAI: evaluate speech, conversation, tool calls and final application state together](https://developers.openai.com/cookbook/examples/audio/voice_agent_evaluation)

