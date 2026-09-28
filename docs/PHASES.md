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
7. Test it
8. Update `docs/PROGRESS.md`

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
services/agent/
├── agent.ts
├── session.ts
├── state.ts
├── prompts.ts
├── providers/
└── tools/
```

Implement:
- AgentConfig
- conversation state
- provider interfaces
- prompt builder
- response policy

### Done when
Voice transport and business logic are clearly separated.

---

# Phase 15 — Tool System

### Read
- VOICE_AI_ARCHITECTURE.md
- DATA_MODEL_AND_API_CONTRACT.md

### Build
- tool registry
- Zod schemas
- tool executor
- tool context
- logging
- error handling

### Done when
LLM can safely call a typed server-side tool.

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

---

# Phase 17 — Voice Appointment Agent

### Read
- all architecture docs
- DATA_MODEL_AND_API_CONTRACT.md

### Build tools:
- get_doctors
- get_doctor_availability
- get_available_slots
- book_appointment
- cancel_appointment
- reschedule_appointment
- transfer_to_human

### Done when
A caller can book/cancel/reschedule through natural Assamese conversation.

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
