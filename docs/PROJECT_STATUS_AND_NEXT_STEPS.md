# Project Status, Voice Quality and Next Steps

> **Current checkpoint — 22 October:** a real Assamese call booked an appointment and received its token; a scoped database read verified booked state. Phase 18 Agent Configuration is the user's next discussion and remains NOT STARTED. Phase 17 remains IN PROGRESS for full live lookup/cancellation, the latest goodbye retest, reported dialogue/recognition issues and genuine voice/latency evaluation. See [PROGRESS.md](PROGRESS.md) for the current checklist. The longer review below preserves the earlier assessment unless explicitly updated.

> **Later update on 21 October:** Phase 16's staff backend, same-doctor rescheduling and Bruno acceptance have since been implemented and verified. See [Phase 16 backend completion](PHASE_16_BACKEND_ACCEPTANCE.md) for results and the required application migration. This report preserves the earlier review snapshot; its Phase 16 remaining-work statements describe the state before that implementation. Phase 17 voice acceptance remains pending.

**Project:** Assamese AI Voice Agent Platform  
**Review date:** 21 October 2026  
**Purpose:** Explain what is built, what is unfinished, how well the voice system is proven to work, and what to improve next.

## 1. The answer in simple words

The **Phase 17 booking MVP is operational**, and **Phase 18 — Agent Configuration is next for discussion**. Phase 17's full voice acceptance remains open; Phase 18 implementation has not started.

The project has moved beyond a basic talking demo. It has an agent engine, browser audio, speech recognition, spoken replies, interruption handling, clinic data services and eight clinic tools. Automated tests cover many important rules.

However, it is **not yet a finished clinic product or a production-ready phone service**. The main unfinished job is proving that a person can reliably book, hear the real token, check and cancel an appointment through a natural Assamese conversation using the actual microphone and hosted AI providers.

**Phase 16's staff APIs and safe rescheduling are complete and locally accepted.** Migration 0004 is verified in the local application database. Phase 18 and later implementation have not started. References elsewhere in this historical review to unfinished Phase 16 work describe the earlier snapshot.

**How efficient are the voices?** The code contains useful speed and reliability improvements. But the available benchmark evidence does not support a trustworthy overall accuracy percentage, a naturalness score, a full reply-time figure or a real simultaneous-call capacity figure. We need real speech measurements before making those claims.

### Quick status table

| Question | Answer |
|---|---|
| What phase are we in? | Booking MVP operational; Phase 17 acceptance remains in progress; Phase 18 discussion is next. |
| Is the core voice system built? | Yes. Its components and local test coverage exist. |
| Are clinic booking tools connected? | Yes, through the existing engine and local clinic services. |
| Is the clinic workflow accepted with real microphone/provider testing? | Booking/token verified live. Full lookup/cancellation, failure/recovery and quality acceptance remain pending. |
| Is Phase 16 fully complete? | Its selected staff backend milestone is complete and locally accepted; other deployment states need separate verification. |
| Can all dashboard pages manage real data? | No. Several inspected pages use sample data or unfinished controls. |
| Can a real mobile phone call this system today as an accepted product? | Production telephony is a later, unstarted phase. |
| Are reminders actually being delivered? | Delivery is unconfigured. Scheduling contracts exist. |
| Can we honestly say the voice is 96.6% accurate? | No. The reported 3.4% word-error result comes from predefined benchmark transcripts, not measured recognition of the benchmark speech. |

## 2. How this report was prepared

I compared the progress tracker and phase plan with the actual backend, frontend, configuration, benchmark code and selected tests.

The report uses three different meanings of progress:

| Term | Simple meaning |
|---|---|
| Implemented | The code exists and is connected to the intended path. |
| Locally verified | A local automated check passed. Some checks use scripted AI replies or artificial audio. |
| Accepted in real use | The complete workflow was tested with real speech and the actual providers, and its result was recorded. |

These are different levels of evidence. A passing scripted booking test does not prove that the recognizer will hear a real caller's name correctly.

This review did not make paid provider calls, test a microphone, send messages, run real telephone calls, run database acceptance suites, change providers or restart the application. It did not inspect cloud account balances or independently measure provider prices. The current health of running Docker services was not tested.

No Git commands were run. This task changes documentation only; the build and checks may refresh generated local output.

## 3. What the system does

The goal is to build one voice engine that different businesses can use. A clinic is the first business.

A patient should eventually be able to say:

> I want to see Dr. Baruah tomorrow morning.

The agent should find the real doctor, check actual availability, collect the missing patient details, read everything back, obtain confirmation, save the appointment and speak the real token number.

It must not invent an available time or say that a booking succeeded before the booking service confirms it.

### The main parts

| Part | Simple explanation | What this project uses |
|---|---|---|
| Dashboard | Staff screens for testing and later managing the service. | Next.js and React. |
| LiveKit | Carries sound between the browser and agent. | Local LiveKit server and browser/Node clients. |
| Speech detector, or VAD | Notices when the caller starts and stops speaking. | Silero. |
| Speech-to-text, or STT | Turns the caller's sound into words. | Deepgram Nova-3 adapter. |
| Language model, or LLM | Interprets words and writes replies. | Replaceable provider adapter; local configuration selects Groq GPT-OSS-120B. |
| Agent engine | Coordinates conversation, state, tools and reply rules. | OpenAI Agents SDK with the project's engine and provider adapters. |
| Business tools | Allowed operations such as checking slots or booking. | Typed, validated clinic tools calling clinic services. |
| Text-to-speech, or TTS | Turns the reply text into sound. | Raya BakBak is the code default; IndicF5 is retained. |
| PostgreSQL | Saves permanent clinic records, including appointments. | PostgreSQL through Drizzle. |
| Redis | Holds temporary active-session information and bindings. | Redis. |

The normal route is:

```text
You speak into the browser microphone
  -> LiveKit carries the sound
  -> Silero detects speech
  -> Deepgram writes the recognized words
  -> Agent engine interprets the request
  -> A clinic tool reads or changes real clinic data when needed
  -> The reply is checked
  -> TTS creates audio
  -> LiveKit plays it back to you
```

The model does not directly access the database. It must go through the allowed tools and services.

## 4. Which phases are complete, and which are not?

There are **25 planned phases**, numbered 0 through 24.

The progress tracker records **16 phases as DONE**, **two as IN PROGRESS**, and **seven as NOT STARTED**. That is a count of tracker labels, not a product-completion percentage. Later phases have very different sizes and risks, and some earlier evidence needs correction.

| Phase | Tracker status | What it means in simple words |
|---|---|---|
| 0 — Architecture freeze | Done | The main structure and responsibilities were chosen. |
| 1 — Local infrastructure | Done | Docker setup for PostgreSQL, Redis and LiveKit was established. |
| 2 — Dashboard foundation | Done | Navigation, layouts, routes and reusable UI were built. This does not mean every screen has real data. |
| 3 — Backend foundation | Done | API structure, database setup, logging and error handling were added. |
| 4 — Authentication and organization | Done | Staff login, token refresh/logout and organization access checks were added. |
| 5 — Browser audio | Done | Browser microphone publishing and LiveKit voice testing were added. |
| 6 — Node agent | Done | The voice worker can join a room and handle its lifecycle. |
| 7 — Speech detection | Done | Speech boundaries and interruption signals were added. |
| 8 — Speech recognition integration | Done | The Deepgram streaming adapter was connected. Real accuracy remains a separate question. |
| 9 — STT benchmark | Done in tracker; evidence gap | The harness exists, but its accuracy/timing results are predefined or simulated. Real acoustic acceptance needs to be recorded. |
| 10 — Language-model integration | Done | Provider adapters and text conversation were established. The selected local model has changed since the original phase. |
| 11 — Spoken replies | Done in tracker | Raya and IndicF5 adapters exist. The old IndicF5 benchmark uses synthetic audio, so it does not prove neural voice quality. |
| 12 — Complete voice loop | Done in tracker | The main audio-to-reply loop and error guards were connected. Full clinic voice acceptance is still pending. |
| 13 — Interruption handling | Done | The caller can interrupt processing/playback through the implemented cancellation system. Real acoustic cutoff still needs measurement. |
| 14 — Agent engine | Done | Conversation logic was separated from voice transport and clinic behavior. |
| 15 — Tool system | Done | Typed tools, validation, execution limits and SDK tool calling were added. |
| 16 — Clinic data and appointments | In progress | Local clinic services exist; HTTP/API acceptance and rescheduling remain unfinished. |
| 17 — Voice appointment agent | In progress — current | Eight tools and worker integration exist; real Assamese microphone/provider acceptance remains open. |
| 18 — Agent configuration | Not started | Save and manage agent settings from the dashboard. |
| 19 — Calls and conversations dashboard | Not started | Store and inspect real completed calls and outcomes. |
| 20 — Local SIP testing | Not started | Test calls using a software phone without paid mobile calls. |
| 21 — Production telephony | Not started | Connect real telephone calls through a telephony provider. |
| 22 — Docker and AWS pilot | Not started | Deploy a small pilot with production setup and backups. |
| 23 — Production hardening | Not started | Complete operational, security, recovery and load checks. Some individual protections already exist. |
| 24 — More business types | Not started | Extend the stable shared engine to hotels, restaurants and other workflows. |

### Why Phase 17 is active while Phase 16 is unfinished

The phase plan explicitly records earlier user authorization for a limited Phase 17 milestone using the already adopted internal clinic services. It also explicitly leaves the missing Phase 16 work open.

This is not evidence that Phase 16 is complete. Both sets of unfinished work need to remain visible.

## 5. What has been developed so far?

### 5.1 Local development foundation

The repository has a separate backend and frontend. Docker Compose defines PostgreSQL, Redis and LiveKit. The Python TTS container is behind an optional `benchmark` profile.

This keeps the normal local infrastructure relatively simple. Hosted STT, model inference and Raya TTS are external dependencies; local containers alone do not make their usage permanently free.

### 5.2 Backend and staff authentication

The backend has Express routes, input validation, response envelopes, Winston logging, common errors, PostgreSQL/Drizzle integration and Redis integration.

Staff authentication includes login, access tokens, refresh-token rotation and logout. Organization membership is checked before trusted organization context is used.

Important benefit: one organization's data should not become another organization's data just because a browser or model supplies a different identifier. Production-wide authorization auditing is still future work.

### 5.3 Browser voice laboratory

The frontend includes a working voice-testing component and LiveKit hook, microphone controls, connection status, transcripts and diagnostic information.

It also distinguishes useful states such as listening readiness, provider failure, tool results and interruptions. Being connected to a room is different from being ready to recognize speech.

### 5.4 Voice pipeline and interruptions

The project includes speech detection, streaming recognition, response generation and speech playback. The interruption manager cancels outdated work and clears queued agent audio.

The browser requests echo cancellation, noise suppression and automatic microphone gain. Additional guards reject speech recognition that does not line up with qualified speech and prevent stale audio from playing after a newer turn.

These are useful engineering protections. They do not prove that every accent, room or phone line works well.

### 5.5 Reusable agent engine

The engine owns conversation lifecycle, validated state, prompts, response policy and SDK orchestration. Clinic behavior lives outside the generic engine.

Provider adapters allow model changes without rebuilding the booking engine. This review does not recommend adding a second agent framework.

Active session snapshots are written to Redis with a sliding 30-minute lifetime and are deleted on normal close. They are **not permanent call history**, and the current store does not provide worker-restart session restoration.

### 5.6 Tool execution system

Tools have strict input/output contracts. The executor checks trusted context, allowed tools, cancellation and limits. Provider adapters preserve tool request/result relationships.

This makes the model a controlled caller of operations rather than an unrestricted database user.

### 5.7 Clinic business services

The project has local clinic models and services for doctors, schedules, slots, patients, bookings, cancellation and related settings.

The services were adopted from a separate appointment project, but the voice platform uses its **own independent database and records**. It does not automatically share or synchronize live WhatsApp appointments.

The booking service includes useful safeguards:

- Organization-scoped checks for the clinic, doctor, patient and slot.
- Database transactions: related changes succeed or fail together.
- Locks and capacity checks: competing requests should not overfill a slot.
- Per-doctor/day token assignment.
- A durable request key: replaying the same booking request should not create another appointment.
- Notification scheduling after a successful commit.

Database-backed tests are documented in earlier progress entries. This review did not rerun those database suites.

### 5.8 Eight clinic voice tools

| Tool | What it does |
|---|---|
| `resolve_clinic_and_caller` | Uses the clinic and server-retained confirmed phone to bind the caller. |
| `list_doctors` | Lists actual doctors. |
| `find_doctor` | Searches actual doctor names and reviewed aliases. |
| `get_available_dates` | Finds actual available dates. |
| `get_available_times` | Finds actual available slots. |
| `book_appointment` | Prepares a booking readback, then books only after the required separate confirmation. |
| `check_my_appointments` | Checks bookings subject to the caller-access rules. |
| `cancel_appointment` | Prepares cancellation and requires the separate confirmation before changing the booking. |

Phone confirmation does not automatically authorize booking or cancellation. An interrupted readback cannot authorize an action merely because its text was generated.

Rescheduling and human transfer are explicitly outside the selected Phase 17 milestone.

### 5.9 Recent conversation reliability improvements

Recent code and progress entries address problems observed during development:

| Problem | Implemented response | Still needs proof |
|---|---|---|
| Asking for a phone again after confirmation. | Bind from server-owned state; refresh post-tool facts; protect confirmed identity. | Retest a fresh hosted microphone call. |
| Losing name or age supplied early. | Capture validated candidates before slot selection. | Test varied real speech and corrections. |
| Wrong interpretation of mixed word/digit ages or spoken times. | Shared number parsing, focused interpretation and offered-slot checks. | Broader accents and ambiguous phrases. |
| Repeated doctor questions after selection. | Retain the selected doctor and route clear reads through existing tools. | Real long conversations. |
| Large model requests and provider rejections. | Bound context, compact results, narrow tool lists and classify failures. | Hosted limits and actual call latency. |
| Model output ends before a usable answer. | Give GPT-OSS completion headroom and reject incomplete output. | Real-provider response quality and cost. |
| Confirmation treated as heard too early. | Require successful playback completion before later confirmation can authorize the draft. | Speaker/microphone interruption scenarios. |

These are implemented fixes with local tests. They are not a claim that all original live problems have disappeared.

## 6. How efficient and effective are the voices?

Voice quality is more than how pleasant the speaker sounds. The system must hear correctly, understand correctly, reply promptly and perform the right operation.

### 6.1 Current provider selection

The inspected local environment selects:

- STT provider: Deepgram, model `nova-3`, normal recognition language `multi`.
- LLM provider: Groq, model `openai/gpt-oss-120b`.

The code defaults to Raya TTS in Assamese at 24,000 samples per second. The inspected environment did not explicitly override `TTS_PROVIDER`; a trusted profile or other runtime override may still affect an actual session. No running worker configuration was verified here.

The normal recognition experiment uses English `en-IN` for phone digits, the trusted reply language for pending critical confirmations, and then returns to the normal baseline. Project records describe `multi` as an experiment whose normal Assamese quality remains unverified. Do not assume it has the same acceptance as an Assamese-specific configuration.

Older product/stack documents still describe Hugging Face/Qwen and IndicF5 as the main path. Those describe earlier plans and do not consistently match current code and local configuration.

### 6.2 Recognition accuracy: the important benchmark gap

`STT_BENCHMARK.md` reports approximately 3.4% word error, 100% entity retention, 208 ms first-token time and five successful concurrent streams.

However, the source of those numbers matters:

1. `getEmpiricalHypothesis()` in the benchmark runner returns predefined recognized sentences for each test case.
2. The same function returns `simulatedTtftMs` and `simulatedFinalLatencyMs`.
3. The audio generator makes tones and harmonics. It does not speak the reference sentences.
4. The case loop scores those predefined sentences rather than collecting actual Deepgram transcripts for the generated cases.
5. The concurrency section runs local audio-generation/byte-processing loops with timers, rather than five real recognition sessions.
6. The optional provider warm-up is separate. A short connection attempt cannot validate the predefined transcripts, and the runner continues even if that attempt fails.

**What this means:** this harness can exercise calculations and report generation. Its published numbers cannot establish actual Assamese recognition accuracy, real provider latency or five-call capacity.

The Phase 9 tracker label is historical. The mandatory real STT benchmark requirement should be treated as an open evidence gap until representative recordings have been transcribed and scored. This report does not switch STT providers or create a Python STT service.

### 6.3 Spoken voice quality: the older TTS results also need care

The older IndicF5 report quotes roughly 64–66 ms to first audio and 1–2 ms synthesis time.

The saved benchmark summary says `mode: synthetic`. The synthetic generator produces test tones; it does not prove intelligible Assamese neural speech. These results show that test audio can pass through the service/adapter path. They do not measure IndicF5 pronunciation, naturalness or real neural generation speed.

The saved summary also contains HTTP round-trip values around two seconds for the shown cases, which do not match the report's roughly 65 ms description. The report and saved result should be reconciled before either is used for a speed claim.

The Raya integration tests verify decoding, streaming-event parsing, phrase splitting, frame construction and cancellation using mocked responses. That is useful adapter validation, but it does not give a real Raya naturalness rating or validate the explanatory document's approximately 100 ms claim.

No side-by-side human listening evaluation was performed in this review. There is insufficient evidence here to rank available voices or claim a naturalness score.

### 6.4 What is already efficient in the implementation?

| Improvement | Why it helps | Limitation |
|---|---|---|
| Hosted recognition and the normal hosted TTS path. | Avoid local neural-model GPU work for those providers. | Internet, provider availability, credits and limits still matter. |
| Raya streaming audio and 20 ms frames. | Supports incremental audio delivery in small regular packets. | Packet size is not the full delay before a reply. |
| Phrase splitting. | Can send complete phrases to synthesis and preserve important punctuation. | Does not prove the current engine speaks the first model token immediately. |
| Cancellation and queue clearing. | Stops outdated work/audio after interruption. | Local queue clearing is not the same as measured sound cutoff at the caller's ears. |
| Smaller model context and paged tool results. | Reduces repeated input and helps avoid oversized requests. | Too little context can lose useful details; structured state must remain authoritative. |
| Tool selection limited to the current stage. | Avoids advertising unnecessary operations to the model. | Every actual operation still needs full validation. |
| Validated retained patient details. | Reduces repeated questions and unnecessary model work. | Depends on correct recognition and interpretation. |
| One intake interpretation can also write the follow-up. | Avoids a separate routine extraction-plus-reply request. | Some confirmation and tool turns still require more work. |
| Optional background work pauses under low quota. | Gives foreground conversation priority. | Does not remove provider limits. |

The latest progress entry reports a reconstructed 12-slot request at **7,762 bytes**, compared with a historical **20,928 bytes**: about **63% smaller**. This is a useful offline request-size improvement. It is not evidence that real calls became 63% faster or 63% cheaper.

### 6.5 Why the caller may still experience a long pause

The turn collector intentionally waits for quiet:

- **1.2 seconds** for ordinary turns.
- **3 seconds** while collecting a phone number.

New VAD/transcript activity can restart the wait. Recognition and speech-end detection can add time before processing begins. Missing final transcripts have an additional bounded recovery path.

After that, interpretation, tools, model generation, reply approval, TTS and browser playback may add more delay. The engine buffers generation before approved response text is returned, so streaming-capable providers alone do not guarantee immediate caller playback.

```text
Caller stops speaking
  + speech-end / transcript timing
  + quiet-period waiting
  + interpretation and business work
  + model reply and approval
  + first TTS audio
  + transport / browser playback
  = time until the caller hears the reply
```

Some stages overlap, so this is an explanation of the path, not a measured arithmetic total. Existing model-generation timing does not include the whole experience.

The important measurement is: **from the caller's last spoken sound to the first audible reply**. We do not yet have a trustworthy current distribution for that measurement.

### 6.6 Overall voice assessment

| Area | Assessment from this review |
|---|---|
| Audio adapter implementation | Useful streaming, decoding and cancellation coverage exists. |
| Natural Assamese pronunciation | Not reliably scored by the inspected evidence. |
| Names, digits, dates and corrections | Improved code and local tests; real recognition remains an acceptance risk. |
| Full response speed | Unknown; configured listening pauses are a visible contributor. |
| Business correctness | Stronger service/tool safeguards exist; natural voice completion still needs acceptance. |
| Interruption experience | Implemented and tested locally; needs real acoustic measurement. |
| Simultaneous-call capacity | Not established by the current benchmark. |
| Per-minute or per-booking cost | Not established in this review. |

**Practical verdict:** the implementation is ready for focused evaluation and continued development. Its voice performance is not yet sufficiently measured for a production-quality claim.

## 7. What is still remaining?

### 7.1 Work needed to finish the current voice milestone

- Complete a real browser call that books, speaks the actual token, checks and cancels an appointment.
- Verify confirmed phone state survives the next turns.
- Verify early name/age, corrected age, doctor selection and date/time choices remain consistent.
- Check Assamese wording, including the previously reported Bengali-style phrasing.
- Test normal recognition and critical-confirmation language changes using actual speech.
- Test interruption during phone and action readbacks.
- Run a 15–20-turn conversation without losing important details or entering a repeated-question loop.
- Test provider timeout, empty/incomplete output, unavailable slots and request/rate limits.
- Record the exact provider/model/language configuration and actual outcomes.

### 7.2 Remaining Phase 16 work

The internal clinic services are not a complete clinic HTTP API. The inspected API registry currently registers health, authentication, organization and LiveKit routes; it does not register clinic appointment routes.

Remaining work includes designing the required staff/patient authorization contracts, exposing approved clinic operations through thin controllers, validating input and organization access, and proving the API/database happy and failure paths.

Rescheduling still needs a safe service and tests. A future design must avoid losing the original booking if the replacement slot cannot be reserved. Do not simulate rescheduling with an unprotected cancel-then-book sequence.

New or modified endpoints need matching working Bruno requests.

### 7.3 Dashboard work

The dashboard foundation is built, but several product screens remain demonstrations:

| Inspected page | Current evidence | Remaining work |
|---|---|---|
| Overview | KPI and recent-call arrays are declared in the page. | Read actual authorized metrics and outcomes. |
| Calls | Call records are declared in the page. | Persist calls and fetch real lists/details. |
| Clinic | Doctors and token queue are sample arrays. | Connect approved clinic APIs and real management actions. |
| Create agent | “Save & Deploy” is a navigation link. | Validate, save and apply agent configuration. |

A polished screen is not proof that its backend operation exists. Real data screens also need loading, empty and error states.

### 7.4 Calls, history and recovery

Active Redis state is temporary. Permanent conversations, tool events, outcomes, retention rules and an operator-facing call history remain future work.

A saved appointment is permanent business data. A temporary conversation snapshot is a different thing. After a worker failure, the current snapshot mechanism does not automatically resume the call.

### 7.5 Notifications and human help

Reminder and doctor-alert scheduling interfaces exist, but actual delivery is unconfigured. Durable job storage, retries, delivery-state checks and restart recovery are still needed before promising a message was sent.

Human transfer is deferred. The product needs a defined escalation experience before real callers depend on it.

### 7.6 Phone calls and deployment

Local SIP, real telephony and the AWS pilot remain future phases. Browser microphone success alone does not validate telephone audio, dropped calls, hangup handling, network behavior or telephony costs.

The first pilot should remain small: one organization, one clinic, one agent and low concurrency, as the product plan specifies.

## 8. What should become more effective or efficient?

### Priority 1 — Replace uncertain voice claims with real measurements

Keep artificial tests for fast development, but label them clearly. Add a separate evaluation path that uses real consented recordings, real provider transcripts and independently checked reference text.

The benchmark should fail or report an incomplete run if the provider cannot be reached. It should not produce a passing acoustic verdict from predefined replies.

This is the highest-priority evidence improvement because it tells us whether to improve configuration, audio capture, recognition, conversation logic or the provider itself.

### Priority 2 — Improve reliable recognition before adding more languages

Compare the current `multi` experiment with the approved candidate Assamese configuration using the same recordings and clinic tasks. Record which configuration wins for Assamese, English digits and mixed speech.

Do not silently select a different provider or treat a successful connection as a passed benchmark. Keep IndicConformer as the existing fallback option if a genuine evaluation shows Deepgram is insufficient.

### Priority 3 — Reduce unnecessary conversation turns

Measure how many questions a normal booking takes. Preserve validated details, ask one missing question at a time, offer only a few real options and avoid repeating confirmed information.

Fewer unnecessary turns can reduce waiting and model usage while making the agent easier to use. Keep separate critical readbacks and confirmations.

### Priority 4 — Tune waiting using measurements

Measure ordinary replies and phone dictation separately. Then evaluate whether quiet-period settings can be safely shortened for specific stages.

Do not simply reduce every pause: a fast agent that cuts off the final phone digit creates more correction work. Check both reply delay and premature interruptions after any change.

### Priority 5 — Compare model choices using the actual task

The local GPT-OSS-120B experiment has completion headroom and low-reasoning configuration, but this review has not proved its hosted speed, Assamese quality or cost advantage.

Compare available configured candidates on the same synthetic clinic scenarios and consented speech tasks. Measure completed bookings, factual errors, clarification turns, latency and actual token usage. A larger model is not automatically the best fit for this workflow.

Do not remove the additional output headroom solely to save tokens; the recent incomplete-output issue shows why it exists. Revisit it only with provider measurements.

### Priority 6 — Evaluate the spoken voice itself

Have Assamese-speaking listeners assess greetings, names, doctor names, phone digits, dates, time, token numbers and mixed-language terms.

Compare Raya with genuine IndicF5 inference only when that environment and model access are working. Do not compare cloud speech with synthetic tones. Record voice/model settings so results can be repeated.

### Priority 7 — Close concrete production gaps

The code inspection found specific items to address before deployment:

| Finding | Why it matters | Needed action |
|---|---|---|
| `backend/src/app.ts` allows an unlisted origin in its final CORS branch. | The intended browser-origin restriction is not enforced there. | Use an explicit production origin policy and test allowed/rejected origins. |
| `backend/src/lib/env.ts` provides development JWT and LiveKit secret defaults. | A production process could accept predictable defaults if configuration is missing. | Require proper production secrets and fail startup when missing or using development values. |
| `docker-compose.yml` contains a credential-like Hugging Face fallback value. | Source should not supply a usable provider credential. Its validity was not checked. | Remove the embedded value and revoke/rotate it if it was a real token. Do not copy it into reports or logs. |
| LiveKit runs in development mode and uses a `latest` image tag. | This is not a reproducible secured production configuration. | Keep a separate tested production configuration and pin the selected image version. |
| Permanent call records and durable notification delivery are missing. | Operators cannot depend on temporary state for history or delivery recovery. | Implement those capabilities in their planned phases. |

These findings are a focused readiness review, not a full security audit. No infrastructure or credential changes were made by this report task.

### Priority 8 — Make the documentation agree with the implementation

The root rules still name IndicF5 as the required current Assamese TTS, while code defaults and later progress entries select Raya. Product/stack documents also retain the older LLM/TTS path.

That disagreement needs an explicit approved provider decision and matching documentation. The report records the difference; it does not declare Raya approved or alter the provider rules.

The old known-blocker section contains historical statements that Phase 17 had not started. Use the top current-phase section and latest dated entries for present status. Keep old entries as history, with clear labels.

## 9. Recommended order of work

This is a proposed order, not a claim that the work has already been authorized or completed.

| Step | Work | Evidence needed before moving on |
|---|---|---|
| 1 | Establish trustworthy STT/TTS evaluation and label simulated results. | Real audio inputs, actual outputs, configuration and honest measured results. |
| 2 | Retest and finish the current Phase 17 voice milestone. | Recorded acceptance of book/token/check/cancel plus important failure and correction cases. |
| 3 | Close remaining Phase 16 API/rescheduling work. | Authorized endpoints, transactions, database/API acceptance and synchronized Bruno requests. |
| 4 | Phase 18: saved agent configuration. | Dashboard changes persist and affect the intended agent. |
| 5 | Phase 19: permanent call records and real dashboard data. | Operators can inspect actual completed calls and outcomes. |
| 6 | Phase 20: local SIP. | Inbound/outbound softphone calls and hangup handling pass. |
| 7 | Phase 21: real telephony. | Controlled real-phone testing passes. |
| 8 | Phase 22 pilot, with required operational/security fixes before exposure. | HTTPS, secret management, backups, recovery and a small monitored deployment. |
| 9 | Phase 23: complete hardening and load acceptance. | Measured reliability, authorization, concurrency, monitoring and restore evidence. |
| 10 | Phase 24: expand business types. | Clinic workflow is stable enough to reuse the engine confidently. |

Notification delivery and human escalation need explicit scope and acceptance before they are promised to pilot callers. They are not included merely because a booking succeeds.

## 10. A simple real-world acceptance plan

### Test cases to record

Use synthetic patient identities and test clinic data. For real recordings, obtain appropriate consent and use restricted storage rather than adding private recordings to ordinary logs.

| Test | Expected result |
|---|---|
| Straightforward Assamese booking. | Correct doctor, actual slot and patient details; separate confirmation; real token. |
| Give name and age before choosing a doctor. | Details are retained and not asked again unnecessarily. |
| Dictate the phone slowly in English. | All digits are retained; confirmation uses the intended reply language. |
| Reject a phone, restore the earlier one, then correct it. | No guessed digits; fresh readback and confirmation when required. |
| Say an unclear age or ambiguous time. | Focused clarification; no invented age, date, AM/PM or slot. |
| Change doctor/date after preparing a booking. | The old draft becomes unusable; revised details need a new readback. |
| Interrupt a confirmation readback and say yes. | The incomplete readback does not authorize the action. |
| Ask for an unavailable slot. | Honest unavailability; only actual alternatives offered. |
| Check an existing appointment. | Correct caller access checks and actual stored result. |
| Reject cancellation, then separately confirm cancellation. | First booking remains; only the later authorized operation cancels it. |
| Provider failure or rate limit. | Truthful processing-failure guidance; retained state; no duplicate booking. |
| Long conversation and multiple corrections. | Important validated details remain consistent. |
| Same booking request repeated. | No duplicate appointment for that request identity. |
| Two callers compete for the last place. | Capacity remains correct. Requires database/concurrency acceptance as well as speech testing. |

### Measurements to keep

| Measurement | Simple meaning |
|---|---|
| Word error rate | How many recognized words differ from the checked reference. |
| Exact important-field accuracy | Whether phone, doctor, age, date, time and token are correct. A nearly correct phone is still wrong. |
| Task completion | How often a caller finishes the intended booking/check/cancellation correctly. |
| Extra questions | How often the caller must repeat or clarify information. |
| End-of-speech to first audible reply | The wait the caller actually experiences. |
| Interruption cutoff | Time from genuine caller interruption to agent sound stopping at playback. |
| Listener score | Assamese-speaking listeners' ratings for clarity, pronunciation and naturalness. |
| Failure rate | Provider failures, empty/incomplete replies, disconnects and wrong actions. |
| Cost per completed task | Actual provider usage divided by successful tasks, including failed attempts. |
| Real concurrency | Behavior when multiple complete sessions use providers and business services together. |

Report the median and the slower 95th-percentile reply time. The 95th percentile means roughly 95 out of 100 measured replies were at least that fast. Averages alone hide frustrating delays.

As an initial evaluation batch, **100–200 representative utterances from several speakers and 20–30 full test conversations** would be a useful starting point, not a production guarantee. Separate clean audio, noisy audio, mixed language, names/digits and phone-quality results. Agree quality gates before judging the results; do not choose a pass mark after seeing them.

## 11. Checks performed during this review

These checks were run on 21 October 2026:

| Check | Result |
|---|---|
| Selected backend automated tests | **193 passed, 0 failed, 0 skipped.** |
| Frontend voice diagnostics | **6 passed, 0 failed.** |
| Backend TypeScript typecheck | Passed. |
| Frontend TypeScript typecheck | Passed. |
| Strict engine-test typecheck | Passed. |
| Strict clinic-test typecheck | Passed. |
| Backend build | Passed. |

The selected backend tests cover clinic contracts, voice integration boundaries, dialogue, intake, contextual confirmation, compact context, tool execution, engine behavior and the Raya adapter.

Backend test command, run from `backend/`:

```powershell
node --import tsx --test test/clinic.test.ts test/clinic-voice.test.ts test/clinic-dialogue.test.ts test/clinic-intake-reliability.test.ts test/contextual-confirmation.test.ts test/compact-context.test.ts test/tools.test.ts test/engine.test.ts test/tts-bakbak.test.ts
```

Other commands, run from the repository root:

```powershell
npm --prefix frontend run test:voice-diagnostics
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix backend run typecheck:engine-tests
npm --prefix backend run typecheck:clinic-tests
npm --prefix backend run build
```

The benchmark runner was inspected but not rerun because it can attempt an external connection and rewrites the benchmark document. No new acoustic measurements are claimed.

The frontend production build, Python tests, database/Redis integration, SIP, cloud deployment and complete voice regressions were not rerun in this review. Earlier progress entries report broader historical checks; those should not be confused with this review's fresh results.

## 12. Files behind the findings

Paths below are relative to the project root. They are included so a developer can check the conclusions without relying on this report alone.

| Topic | Main evidence |
|---|---|
| Current phase and latest implementation history | `docs/PROGRESS.md`, `docs/PHASES.md`. |
| Product and architecture | `docs/PRODUCT_OVERVIEW.md`, `docs/TECH_STACK.md`, `docs/BACKEND_ARCHITECTURE.md`, `docs/FRONTEND_ARCHITECTURE.md`, `docs/VOICE_AI_ARCHITECTURE.md`, `docs/DATA_MODEL_AND_API_CONTRACT.md`. |
| Clinic voice acceptance instructions | `docs/CLINIC_VOICE_TOOLS.md`, `docs/PHASE17_CONVERSATION_RELIABILITY.md`. |
| Clinic adoption boundary | `docs/CLINIC_SERVICE_ADOPTION.md`, `backend/src/components/clinic/index.ts`. |
| Booking integrity | `backend/src/components/clinic/services/create-appointment.ts`. |
| Current clinic conversation configuration | `backend/src/components/clinic/voice/session.ts`, `backend/src/components/clinic/voice/runtime.ts`. |
| Turn waiting and response transport | `backend/src/agent/turn-collector.ts`, `backend/src/agent/index.ts`. |
| STT benchmark limitations | `backend/test/benchmark/runner.ts`, `backend/test/benchmark/audio-generator.ts`, `docs/STT_BENCHMARK.md`. |
| Synthetic TTS results | `docs/TTS_BENCHMARK.md`, `ai/tts/tests/outputs/benchmark_summary.json`, `ai/tts/src/synthetic.py`. |
| Raya implementation and test boundary | `backend/src/components/agent/providers/tts/raya/`, `backend/test/tts-bakbak.test.ts`. |
| TTS selection and environment defaults | `backend/src/agent/tts.ts`, `backend/src/lib/env.ts`; selected non-secret local settings were checked without copying credentials. |
| Temporary session storage | `backend/src/components/agent/session-store.ts`, `backend/src/components/agent/engine/store.ts`. |
| HTTP route availability and CORS | `backend/src/app.ts`. |
| Sample dashboard data | `frontend/src/app/(dashboard)/page.tsx`, `frontend/src/app/(dashboard)/calls/page.tsx`, `frontend/src/app/(dashboard)/clinic/page.tsx`. |
| Unfinished agent saving | `frontend/src/app/(dashboard)/agents/new/page.tsx`. |
| Local infrastructure and credential fallback | `docker-compose.yml`. |

## 13. What “ready” should mean

For the current milestone, ready means a real caller can complete the supported clinic tasks with the actual voice stack, while corrections, interruptions and failures are handled honestly and the database outcome is correct.

For production, ready additionally means real telephone testing, operational security, persistent records, recovery, monitoring and measured capacity are in place.

The project has substantial implementation and passing local checks. The next most valuable step is to prove and improve the complete caller experience with trustworthy measurements, then close the remaining clinic and product phases.
