# Phase 14 Explained: The Reusable Agent Engine

## What was the goal?

We built a shared conversation engine that can be used by different businesses.

Think of it as the part of our voice agent that remembers the conversation, prepares instructions for the AI, handles the reply, and manages the conversation from start to finish.

A clinic, hotel, or salon can use this same engine with its own settings and business rules.

## What did we have before this phase?

Our agent could already listen, understand speech, generate a reply, and speak back. Callers could also interrupt it.

But the conversation code was closely tied to our clinic demo. It contained doctor names, patient details, appointment questions, and clinic-specific recovery replies alongside the general AI conversation handling.

This created a few drawbacks:

- Adding a hotel or salon would require changing the shared conversation code or copying it into another version.
- Some demo code filled in details the caller had not provided, such as a particular date or time.
- Some replies sounded like an appointment or request had been confirmed even though no booking service had actually completed it.
- Conversation memory was held inside the running process and used clinic-specific fields. It was not a reusable session structure stored in Redis.
- Stopping the audio did not, by itself, guarantee that a late AI reply would be kept out of conversation history.
- Some logs included conversation text or detailed provider errors, which could contain private information.

Phase 14 addressed these problems while keeping the existing voice pipeline.

## What did we build?

### 1. Agent settings

We added `AgentConfig`, which is a settings sheet for an agent.

It contains things such as the agent's name, business name, instructions, supported languages, AI model settings, and polite recovery messages.

The settings are checked before use. For example, an agent cannot choose a default language that it does not support.

**Why it matters:** Different businesses can give the same engine different instructions without rewriting its conversation handling.

### 2. Separate memory for each conversation

The engine keeps two kinds of information:

| Kind of information | What it means |
|---|---|
| Session information | Which organization and agent the conversation belongs to, whether it is active, and which turn is current. |
| Conversation information | What was said, the current language, repeated messages, and the details needed by that business. |

Each caller gets a separate session. Information from one organization is kept separate from another organization's session.

Code that reads the state receives a protected copy, so it cannot accidentally change the engine's memory.

**Why it matters:** The engine can remember the right information for the right caller without sharing or accidentally changing another conversation's state.

### 3. One place to build AI instructions

We added a prompt builder. A prompt is the set of instructions and context given to the AI before it answers.

The builder combines shared conversation rules, business settings, the caller's language, and the details collected so far.

The shared rules ask the AI to give short, polite replies, ask for missing information, and use confirmed business facts.

**Why it matters:** We can maintain common behavior in one place instead of repeating instructions throughout the code.

### 4. A common response policy

Both ways of asking the engine for a reply now use the same response handling.

The engine collects the AI's answer before returning text for speech. It removes common formatting that should not be spoken. If the AI fails or returns an empty answer, the engine provides a polite recovery message in the caller's language.

The spoken text and the saved reply agree, even when the engine replaces an unsuitable answer.

**Why it matters:** An empty AI answer should not cause silence or an error in the speech system. Reply handling should also behave consistently across different callers and businesses.

### 5. Clear handling of starts, interruptions, and endings

The engine can start a session, process a caller's message, reset the conversation, record an interruption, and close the session.

If a new turn replaces an unfinished turn, the old AI result is discarded. The caller's accepted message is still remembered. If a generated reply is interrupted during playback, it is marked as interrupted and excluded from the next AI request.

LiveKit and our existing interruption manager still handle stopping the actual audio.

**Why it matters:** The audio system and conversation memory now work together, so a delayed answer cannot become the reply to a newer question.

### 6. Temporary session storage in Redis

Redis is our fast, temporary storage system. We now save active conversation snapshots there, separately for each organization and session.

Updates are saved in order. Each save renews a 30-minute expiry. Closing the session deletes its temporary copy. If storage fails, the affected session closes instead of continuing as though its state was saved.

**Why it matters:** Active state has a defined storage and cleanup process. It is no longer only an object inside the running voice worker.

These snapshots are not permanent call records, and restarting a crashed conversation from them is not implemented yet.

### 7. A shared AI runtime with replaceable providers

We connected the engine to the OpenAI Agents SDK, the orchestration library required by our architecture.

An adapter connects that library to our existing AI model providers. Using the OpenAI Agents SDK does not mean that the engine must use an OpenAI model; our existing model providers remain behind the adapter.

**Why it matters:** We use one supported orchestration layer while keeping the model provider replaceable.

### 8. The clinic demo moved outside the core

The clinic intake rules now live in a separate business module. That module collects the requested doctor, date or time, name, and phone number.

It keeps the details the caller actually supplied. For example, if the caller says "tomorrow," the demo does not add "10 AM."

Once the details are collected, the demo clearly says that an appointment has not been booked. It does not treat collecting information as a successful booking.

**Why it matters:** We keep a useful clinic demo while making the shared engine suitable for other businesses.

## How does it work now?

```text
Caller speaks
    ↓
Existing voice system turns speech into text
    ↓
Shared engine remembers the message and prepares AI instructions
    ↓
AI model generates a reply
    ↓
Engine applies response rules and saves the conversation state
    ↓
Existing voice system speaks the reply
```

Business settings and the separate business module tell the shared engine how to behave.

For example, a clinic can collect appointment details, while a future hotel module could collect stay dates and guest details. We tested a hotel configuration through the same engine; a full hotel booking feature has not been built.

## Before and after

| Before Phase 14 | After Phase 14 |
|---|---|
| Shared conversation handling contained clinic rules. | The reusable engine and clinic demo have separate responsibilities. |
| Demo replies could fill in missing dates or imply confirmation. | The clinic demo preserves supplied details and explains that no booking has happened. |
| Conversation memory used a clinic-specific structure inside the process. | The engine supports business-specific state and saves active snapshots in Redis. |
| A stopped reply could still cause problems in conversation history. | Late results are discarded, and interrupted replies are marked. |
| Some logs could include private conversation details. | Engine and worker lifecycle logs use operational information and timing. |

## What did we verify?

We passed 37 engine tests, 24 listening/phone dictation tests, 5 STT language-switch tests, and one earlier test against the real local Redis service. These include the frontend's demo agent ID, short spoken answers, and the reported conversation that previously got stuck.

These checks covered different business configurations, separate sessions, languages, empty replies, AI failures, interruptions, delayed answers, storage errors, expiry, and cleanup.

The existing voice-loop, interruption, agent, speech detection, and speech generation tests also passed. Backend and frontend typechecks passed, and the backend build passed.

We did not repeat a live browser conversation in this phase. The live cloud test is now optional; the normal tests can run without calling a paid AI service.

## How can we test it by talking through the frontend?

The frontend's Voice Testing Lab sends your speech through the new engine.

Run these commands from `D:\Projects\voice-agent`. If the services are already running, restart the agent worker to load the latest code.

Start the local infrastructure:

```powershell
docker compose up -d postgres redis livekit
```

Keep each of these commands running in a separate terminal:

```powershell
npm run dev:backend
npm run dev:frontend
npm --prefix backend run agent:dev
```

Sign in at `http://localhost:3000`, select your organization, open **Agents → Testing → Voice Testing Lab**, and click **Start Voice Session**. Allow microphone access and wait for the agent to join. Use headphones for a clearer interruption test.

Speak one sentence at a time and wait for the reply:

| Say this | What should happen? |
|---|---|
| "নমস্কাৰ, মই ডাঃ বৰুৱাৰ লগত এটা এপইণ্টমেণ্ট বিচাৰোঁ।" | It remembers the requested doctor and asks for your preferred date or time. |
| "কাইলৈ।" | The date chip shows tomorrow without adding 10 AM. It asks for your name. |
| "মোৰ নাম উদয় বৰা।" | It remembers your name and asks for a phone number. |
| Give a made-up 10-digit test phone number, with short pauses between groups. | It waits, joins the digits, reads the number back and asks if it is correct. |
| Say "হয়" if the readback is correct, or "নহয়" if it is wrong. | Yes confirms the collected number. No lets you give it again. Neither creates a booking. |

The **Live Conversation** feed shows what speech recognition heard, the agent's reply, and chips for collected details. Check the transcript first: if speech recognition heard a different sentence, the engine is answering that sentence.

When it asks for the phone number, say the digits in English. The worker now uses English speech recognition during that step, so the transcript can show English digit words or numeric digits. It switches back to Assamese recognition before asking whether the number is correct. The conversation can keep its Assamese replies throughout.

You can confirm naturally: "হয় শুদ্ধ, নম্বৰটো শুদ্ধ" or "ঠিক আছে". Saying "নম্বৰটো শুদ্ধ নহয়" clears the number and lets you give it again. An unclear answer asks you for a short yes/no reply. Confirmation only means the number was accepted; it does not book an appointment.

The agent now waits longer before answering: a 1.2-second quiet window for ordinary answers and a 3-second window while collecting the phone number, after the latest speech/transcript activity. Speech recognition and reply generation add their own delay. If you continue speaking, the window starts again. Small transcript fragments are joined into one conversation turn.

If you pause before finishing, continue where you stopped: it remembers the clear digits already given. Say "নতুনকৈ" to start again. It supports "ডাবল" and mixed Assamese/English digit spellings, including joined text such as `ছেভেন00`. If speech recognition produces an unclear word, it asks you to repeat rather than guessing. If you already said the whole number but it heard nine digits, repeat the full number: the missing digit may be in the middle.

Our latest check found two different causes: one transcript lost a zero in the middle, while another contained all ten digits but joined a spoken word with numeric digits. The joined-token parser issue is fixed and covered by a replay test. Lost speech-recognition information still needs clarification from the caller.

Before changing speech providers, build a small phone-number benchmark with repeated zeros, double/triple words, mixed scripts and natural pauses. Measure whether the entire number is correct and how many retries are needed; a good general transcription score can still hide mistakes in phone numbers. This benchmark is a recommended next check, not a completed result.

For stronger reliability, the recommended next improvement is to ask for the first five digits and then the last five after an unclear attempt, confirm the full number, and offer typed entry after repeated failures. Future phone calls can offer keypad entry. These additional fallback flows are not implemented yet. Established platforms provide related mechanisms: [Dialogflow documents recognition adapted to digit sequences](https://docs.cloud.google.com/dialogflow/cx/docs/concept/speech-adaptation), and [Twilio supports speech and keypad input](https://www.twilio.com/docs/voice/twiml/gather). Deepgram's [Numerals feature](https://developers.deepgram.com/docs/numerals) does not currently list Assamese among its supported languages, so enabling number formatting alone is not a verified fix for this use case.

Check that a full doctor name stays complete and "কাইলৈ ৰাতিপুৱা ১০ বজাত" stays tomorrow morning at 10, rather than changing to night. An unclear sentence should not be accepted as your name. These fixes have automated coverage; the live microphone test is still needed.

When it asks for a doctor, you can also answer just "বৰুৱা". When it asks for your name, you can answer just "উদয় বৰা". The clinic demo remembers the question actually asked, including a question in the AI's greeting. Spoken spellings such as "ডাক্তৰ বৰুৱা" and "ডঃ বৰুৱা" are supported. Negative replies or unclear speech are not treated as doctor names. If a detail is unclear, it asks a clarification rather than repeating the identical sentence.

If the AI returns no spoken answer, the engine tries once more before using a recovery reply. Hover over the **Safe Guard** badge to see whether the AI returned no text, its request failed, or a repeated reply was replaced. Speech recognition now keeps processing incoming speech while the agent prepares or speaks its reply.

Also try these checks:

- While it speaks, say "ৰব, ৰব, শুনক।" It should stop speaking and continue with your new turn. A speaking reply may show an **Interrupted** badge. Interruptions during thinking may not have a reply card to mark.
- Switch to Hindi or English. The next reply should use the detected supported language.
- Click **Disconnect**, wait for the worker's `session_closed` event, then start again. The new conversation should start with empty business state.
- **Clear** only clears the visible conversation feed. It does not reset the engine's memory.

Keep the worker terminal visible. A session should produce `session_started`, `turn_started`, `turn_completed`, and eventually `session_closed` events. `provider_failed` or a **Safe Guard** badge indicates a recovery response; it does not prove that the cloud AI call succeeded.

Talking through the frontend checks the real voice path. Storage errors, provider failures and business configuration reuse are covered more thoroughly by the automated tests. The dashboard settings and tool controls are still placeholders; real booking and saved configuration are later-phase features.

## What remains for later phases?

This phase prepares the shared conversation foundation. Actual business actions still need their own tools and services.

Later work includes safe tool execution, real appointment availability and booking, saved agent settings editable from the dashboard, and permanent call records.

The general AI instructions encourage factual answers, but instructions alone cannot guarantee that every model answer is correct. Real booking success must come from a confirmed booking tool result.

**Phase 14 is complete. Phase 15, the Tool System, has not started.**
