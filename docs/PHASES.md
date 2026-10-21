# Assamese AI Voice Agent Platform — Development Phases

## How to Use This File

Never ask an AI coding agent to "build the whole project".

Give it ONE phase at a time.

Before every phase:
1. Read `docs/AGENTS.md`
2. Read `docs/PROGRESS.md`
3. Read the phase below
4. Read every dependency document listed by that phase
5. Inspect the existing code
6. Implement only the current phase
7. Test it (including automated tests)
8. Update `backend/bruno-collection/` with working `.bru` request files for any new/modified endpoints
9. Update `docs/PROGRESS.md`

---

# Phase 0 — Architecture Freeze

### Read
- PRODUCT_OVERVIEW.md
- TECH_STACK.md
- BACKEND_ARCHITECTURE.md
- FRONTEND_ARCHITECTURE.md
- VOICE_AI_ARCHITECTURE.md

### Build
No product feature.

Freeze:
- repo structure
- service boundaries
- stack
- provider interfaces
- development rules
- exact ConexusCRM-BE backend patterns to reuse/adapt vs reject

Inspect `D:\conexus\ConexusCRM-BE` during Phase 0 before creating backend infrastructure.

### Done when
The repository can be explained as:

```text
Dashboard
API
Agent
STT
TTS
LiveKit
Postgres
Redis
```

No major architectural ambiguity remains.

---

# Phase 1 — Local Infrastructure

### Read
- AGENTS.md
- TECH_STACK.md
- PRODUCT_OVERVIEW.md

### Build
Docker Compose for:
- PostgreSQL
- Redis
- LiveKit
- LiveKit SIP later/optional

Initialize:
- `apps/api`
- `apps/dashboard`
- `services/agent`
- `ai/tts`
- STT provider integration lives behind the agent/provider layer; no local Python STT service initially

### Done when
One command starts the local infrastructure and health checks pass.

---

# Phase 2 — Dashboard Foundation

### Read
- FRONTEND_ARCHITECTURE.md
- TECH_STACK.md

### Build
- Next.js App Router
- Tailwind
- shadcn/ui
- layout
- sidebar
- top bar
- route structure
- theme
- loading/error boundaries
- basic dashboard shell

### Done when
Dashboard opens with correct navigation and responsive layout.

---

# Phase 3 — Backend Foundation

### Read
- BACKEND_ARCHITECTURE.md
- DATA_MODEL_AND_API_CONTRACT.md

### Build
First inspect `D:\conexus\ConexusCRM-BE` and reuse/adapt its production patterns for Express, route registration, env validation, logger, errors/async handling, Drizzle, transaction hooks and Redis.

Then build:
- Express + TypeScript
- normalized API response helpers
- health endpoint
- PostgreSQL / Drizzle
- Redis

Do not copy CRM-specific domain or legacy telephony code.

### Done when
API, DB and Redis start and health checks work.

---

# Phase 4 — Authentication & Organization

### Read
- BACKEND_ARCHITECTURE.md
- DATA_MODEL_AND_API_CONTRACT.md
- FRONTEND_ARCHITECTURE.md

### Build
Inspect Conexus users, organizations, JWT and permissions first. Reuse compatible patterns, but implement our target lifecycle:
- users
- organizations
- memberships
- short-lived access token
- refresh-token flow
- login / refresh / logout
- protected API
- dashboard auth
- centrally verified organization context

### Done when
A user can securely log in and access only their organization.

---

# Phase 5 — LiveKit Browser Audio

### Read
- PRODUCT_OVERVIEW.md
- VOICE_AI_ARCHITECTURE.md
- FRONTEND_ARCHITECTURE.md

### Build
- LiveKit server
- backend token endpoint
- browser voice testing page
- `livekit-client`
- microphone publishing
- agent room connection

No AI yet.

### Done when
Browser A can connect to LiveKit and realtime audio works.

---

# Phase 6 — Node LiveKit Agent

### Read
- VOICE_AI_ARCHITECTURE.md
- TECH_STACK.md

### Build
- `@livekit/agents`
- agent worker
- session lifecycle
- basic greeting
- logging
- room connection

### Done when
Browser user joins and hears a basic agent response.

---

# Phase 7 — Silero VAD

### Read
- VOICE_AI_ARCHITECTURE.md

### Build
- VAD
- speech start detection
- speech end detection
- interruption detection

### Done when
The system reliably detects user turns in normal speech.

---

# Phase 8 — Deepgram Nova-3 STT

### Read
- VOICE_AI_ARCHITECTURE.md
- TECH_STACK.md

### Build
- Deepgram Nova-3 streaming integration
- provider abstraction/configuration
- streaming transcription
- Assamese transcription
- benchmark-ready logging and latency measurement

### Done when
Assamese speech becomes usable text inside the agent.

---

# Phase 9 — STT Benchmark

### Read
- VOICE_AI_ARCHITECTURE.md

### Test
- Assamese
- Hindi
- English
- code switching
- names
- dates
- locations
- noise
- phone-quality audio

### Measure
- transcription accuracy
- latency
- CPU/RAM/GPU
- concurrency

### Done when
Results are documented and the model is acceptable for continued development.

---

# Phase 10 — Hugging Face Inference — Qwen3.5-4B

### Read
- VOICE_AI_ARCHITECTURE.md
- TECH_STACK.md

### Build
STT text
-> Hugging Face Inference Providers
-> response text

No business tools yet.

### Done when
Agent can hold a basic multilingual text conversation.

---

# Phase 11 — IndicF5 TTS

### Read
- VOICE_AI_ARCHITECTURE.md

### Build
- Python TTS service
- model loading
- text-to-audio
- custom LiveKit TTS node

### Done when
Agent can respond with Assamese speech.

---

# Phase 12 — Complete Voice Loop

### Read
- PRODUCT_OVERVIEW.md
- VOICE_AI_ARCHITECTURE.md

### Build

```text
Browser
-> LiveKit
-> VAD
-> STT
-> Hugging Face Inference Providers
-> TTS
-> LiveKit
-> Browser
```

### Done when
A real Assamese conversation can happen end-to-end.

---

# Phase 13 — Barge-In

### Read
- VOICE_AI_ARCHITECTURE.md

### Build
- interrupt agent audio
- capture user speech
- resume after user turn

### Done when
The user can naturally interrupt the agent.

---

# Phase 14 — Agent Engine

### Read
- PRODUCT_OVERVIEW.md
- VOICE_AI_ARCHITECTURE.md

### Build

```text
backend/src/components/agent/
├── engine/             # config, session, state, prompts, response policy, lifecycle, store contract
├── business/           # isolated clinic intake demo
├── providers/          # existing STT/LLM/TTS adapters, SDK Model bridge
└── session-store.ts    # Redis implementation

backend/src/agent/      # LiveKit worker, audio pipeline and sandbox compatibility adapter
```

Implement:
- AgentConfig
- conversation state
- provider interfaces
- prompt builder
- response policy
- session lifecycle and Redis-backed active state

Use `@openai/agents` for orchestration. Keep transport and business demo behavior outside the core.

### Done when
Voice transport and business logic are clearly separated.

---

# Phase 15 — Tool System

### Read
- VOICE_AI_ARCHITECTURE.md
- DATA_MODEL_AND_API_CONTRACT.md

### Build
- typed tool definitions and result contracts
- tool registry
- Zod schemas
- tool executor
- tool context
- logging
- error handling
- SDK function-tool adapters and provider call/result transport
- harmless offline server-time tool demonstration

Implementation lives under `backend/src/components/agent/tools/`, with optional runtime injection into the existing engine. The SDK Runner owns orchestration; tools are disabled by default. No business tools or database access are added in this phase.

### Done when
The real SDK completes a deterministic tool request → validated execution → structured result → assistant reply. Input/output validation, trusted context, allowlists, serial execution, timeout/cancellation, invocation caching/limits, history replay and safe errors are tested. Offline provider protocol tests, affected regressions, strict typechecks and backend build pass.

---

# Phase 16 — Clinic Data & Appointment MVP

### Read
- DATA_MODEL_AND_API_CONTRACT.md
- BACKEND_ARCHITECTURE.md
- PHASES.md

### Build
- doctors
- schedules
- patients
- appointments
- availability
- booking
- cancellation
- rescheduling

### Done when
A booking can be completed safely through API and database.

### Selected service-adoption milestone (2026-10-13)

Adopt the existing WhatsApp appointment platform's clinic models and domain services locally under `backend/src/components/clinic/`, using an independent voice database. Preserve capacity-based concrete slots, transactional advisory/row locking and per-doctor/day tokens; adapt tenant scope, trusted context, safe contracts and timezone handling. Include internal service/database tests and reminder/booking-alert scheduling contracts without actual delivery.

This Phase 16 milestone added no HTTP endpoints, voice tools, WhatsApp transport, live-data migration or rescheduling implementation. Its completion is recorded separately in `PROGRESS.md`; the full phase remains **IN PROGRESS** until API/database acceptance and rescheduling are completed. The user subsequently authorized the scoped Phase 17 voice-tool milestone below while those Phase 16 items remain open. The existing source has no rescheduling service to copy, so its voice tool remains deferred.

---

# Phase 17 — Voice Appointment Agent

### Read
- all architecture docs
- DATA_MODEL_AND_API_CONTRACT.md

### Selected voice-tool milestone (2026-10-16)

Use the locally adopted Phase 16 services and independent voice database. Build:
- resolve_clinic_and_caller
- list_doctors
- find_doctor
- get_available_dates
- get_available_times
- book_appointment
- check_my_appointments
- cancel_appointment

Connect the existing browser worker through server-owned profiles and one-use Redis bindings. Patients need no login; require confirmed phone and separate action readbacks, and token/date knowledge for access to existing bookings. Preserve source locks/capacity/tokens/timezones and injected post-commit scheduling. Add durable request-key replay protection in the existing appointment table. Document automated checks separately from live microphone/provider acceptance.

Rescheduling is excluded because no safe source service exists. Human transfer is outside this selected milestone. Phase 18 saved configuration is not started. Details and frontend instructions: `CLINIC_VOICE_TOOLS.md`.

The authorized follow-up adds reviewed bilingual doctor metadata/aliases, deterministic first read-tool routing through the same SDK/executor, immediate doctor selection, clinic-local calendar interpretation, verified fallback speech and clearer frontend diagnostics. It does not change the independent database boundary or complete Phase 16 API/rescheduling work. A subsequent authorized follow-up replaces live clinic keyword confirmation with contextual SDK interpretation, retained phone candidates, playback eligibility and bounded speech/no-input recovery. Automated acceptance and remaining live limitations are recorded in PROGRESS.md. Live microphone/hosted-provider acceptance remains outstanding; Phase 17 remains IN PROGRESS.

The 17 October follow-up bounds the SDK's model view while retaining full active session records, projects read-tool results, saves name/age candidates before booking, uses the configured model for ordinary intake replies and idle conversational notes, and classifies 413/rate/provider failures honestly. Exact action readbacks and service-confirmed outcomes remain server-controlled. This is part of Phase 17; frontend microphone/hosted-provider acceptance is still required before marking it complete. Phase 16 HTTP/rescheduling acceptance and Phase 18 configuration work remain open.

The subsequent live-call follow-up adds offered-date selection, server-bound doctor references, stage-relevant tools, prospective result headroom, concise options and contextual failure recovery. Redundant clinic read-event summaries yield quota to foreground calls, and repeated unusable-speech prompts are suppressed until accepted input. This remains Phase 17 reliability work; automated checks do not complete live Assamese/provider acceptance.

The early-intake follow-up removes the slot-stage gate for patient capture, retains name/age candidates and explicit disputes, tracks approved question context and non-progress, and resolves short contextual date/slot choices against returned records before speech. Ordinary capture and follow-up share the existing tool-free SDK interpretation; real operations retain the SDK tool loop. Corrections invalidate pending drafts and require revised readbacks. Exceptional availability guidance consults retained details instead of always asking for a name. No schema/endpoint/dependency or booking engine changes. Live early-details/age-correction acceptance remains outstanding; Phase 17 remains IN PROGRESS.

The first-transcript follow-up adds a bounded delayed-final grace/Finalize request, an agent listening-readiness signal, shorter ordinary model guidance, explicit intake-failure categories and prepare-only routing for complete booking requests. Existing services bind confirmed callers; no new appointment operation or schema is added. This fixes reproducible local paths while the supplied initial-hello cause and hosted intake-validation outcome still require live verification. Phase 17 remains IN PROGRESS; Phase 18 remains NOT STARTED.

### Done when
The selected milestone is accepted when its typed tool/service/database checks pass and a caller can book, receive a token, check and cancel through natural Assamese conversation in the frontend. Implementation/local automated verification may be complete while live audio acceptance remains pending; do not mark the phase DONE prematurely. Rescheduling and human transfer remain explicitly deferred capabilities.

---

# Phase 18 — Agent Configuration

### Read
- PRODUCT_OVERVIEW.md
- BACKEND_ARCHITECTURE.md
- FRONTEND_ARCHITECTURE.md

### Build
Dashboard:
- create agent
- name
- languages
- greeting
- prompt
- enabled tools
- working hours
- transfer settings

Backend persists configuration.

### Done when
An agent can be changed from the dashboard without changing code.

---

# Phase 19 — Calls & Conversations Dashboard

### Read
- FRONTEND_ARCHITECTURE.md
- DATA_MODEL_AND_API_CONTRACT.md

### Build
- calls list
- call detail
- transcripts
- tool events
- outcomes
- transfer status

### Done when
A business user can inspect a completed call.

---

# Phase 20 — Local SIP Testing

### Read
- PRODUCT_OVERVIEW.md
- VOICE_AI_ARCHITECTURE.md

### Build
- local LiveKit SIP
- SIP softphone
- inbound test
- outbound test
- hangup handling

No paid PSTN.

### Done when
A SIP softphone can talk to the agent.

---

# Phase 21 — Production Telephony

### Read
- VOICE_AI_ARCHITECTURE.md
- BACKEND_ARCHITECTURE.md

### Build
Connect a SIP/PSTN provider.

### Done when
A real phone can reach the agent.

Do not rewrite the AI engine for telephony.

---

# Phase 22 — Docker & AWS Pilot

### Read
- all architecture docs
- PROGRESS.md

### Build
- production Docker images
- secrets
- reverse proxy
- HTTPS
- health checks
- backups
- logs

Initial target:
- one organization
- one clinic
- one agent
- low concurrency

### Done when
The pilot can run reliably in AWS.

---

# Phase 23 — Production Hardening

### Build
- rate limiting
- authorization audit
- tenant isolation tests
- retries
- timeouts
- idempotency
- booking race-condition protection
- monitoring
- alerting
- backup/restore test
- graceful shutdown
- failure recovery

### Done when
The pilot is operationally safe enough for real users.

---

# Phase 24 — Multi-Business Expansion

Only after the clinic flow is stable.

Add:
- hotel tools
- restaurant tools
- salon tools
- configurable business workflows

The voice engine remains shared.
