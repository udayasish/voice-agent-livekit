# Assamese AI Voice Agent Platform — Antigravity Implementation Prompts

This document explains exactly how to use an AI coding agent such as Antigravity.

## Reference Backend Instruction

For backend-related phases, Antigravity must inspect `D:\conexus\ConexusCRM-BE` before inventing infrastructure.

Reuse/adapt its proven Express, `Route[]`, service, controller, logger, errors, `asyncHandler`, env, Drizzle, transaction, Redis, permission and JWT-helper patterns.

Do not copy its legacy telephony stack, CRM domain, old auth lifecycle, ad-hoc tenant selection or inconsistent response contracts.

## 1. Golden Rule

Do not give Antigravity the entire project in one prompt.

Give:
1. initialization prompt once
2. one phase prompt at a time

The agent must read the project docs before coding.

---

# 2. Initialization Prompt

Use this once when starting the repository:

```text
You are the lead engineer for this project.

We are building a production-grade multi-tenant AI voice-agent platform for businesses in Assam and India, with Assamese as a primary language.

Before writing any code, read these files completely:

docs/PRODUCT_OVERVIEW.md
docs/TECH_STACK.md
docs/BACKEND_ARCHITECTURE.md
docs/FRONTEND_ARCHITECTURE.md
docs/VOICE_AI_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md
docs/PHASES.md
docs/AGENTS.md
docs/PROGRESS.md

Your job at this stage is NOT to implement the whole product.

First:
1. understand the complete architecture
2. inspect the repository
3. inspect the production reference backend at `D:\conexus\ConexusCRM-BE`
4. inspect the existing `whatsapp-appointment-platform` codebase/repository, which already contains the clinic appointment domain, database schema, booking flow, slot logic, patient handling, cancellation flow and notification jobs
5. identify which Conexus patterns can be reused/adapted and which legacy CRM/telephony patterns must not be copied
6. identify which existing WhatsApp appointment services and models can be reused directly by the voice-agent platform
7. identify what already exists
8. compare the repository against Phase 0
5. identify contradictions or missing decisions
6. propose the exact initial repository structure
7. propose the commands and dependencies required for Phase 0
8. do not write application features yet

Important rules:
- Do not invent architecture.
- Do not replace LiveKit with a custom WebSocket voice gateway.
- Do not use n8n.
- Do not let the LLM access PostgreSQL directly.
- Keep STT, LLM and TTS behind provider abstractions.
- The existing `whatsapp-appointment-platform` is the source of truth for the clinic appointment domain.
- Do NOT recreate clinic doctors, slots, patients, appointments, booking, cancellation, availability or reminder services from scratch.
- Reuse/adapt the existing WhatsApp appointment services and schemas through direct imports or a clean internal service boundary.
- The voice layer should become another interface/channel over the existing clinic appointment system, not a second appointment system.
- Preserve the existing appointment business rules and concurrency guarantees.
- Development must be possible locally at ₹0.
- Use Node.js + TypeScript for API/agent.
- Use Next.js + TypeScript for dashboard.
- Use Python only where required for AI4Bharat model services.
- Do not skip phases.
- Do not refactor unrelated code.

After analysis, give me:
A. repository assessment
B. proposed initial structure
C. required dependencies
D. environment variables
E. Phase 0 implementation plan
F. any blocking questions

Also explicitly report:
- where the existing WhatsApp appointment platform should be reused
- which clinic models/services must NOT be recreated
- whether the voice agent can import those services directly or should call them through an internal API/module boundary
- any changes needed to make the existing services channel-agnostic

Do not start Phase 1 until I explicitly ask.
```

---

# 3. How to Start Phase 0

Prompt:

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
docs/PRODUCT_OVERVIEW.md
docs/TECH_STACK.md
docs/BACKEND_ARCHITECTURE.md
docs/FRONTEND_ARCHITECTURE.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY Phase 0.

Goal:
Freeze the architecture and initialize the repository structure.

Do not build product features.

First inspect the current repository and reuse anything valid.

Create the agreed top-level structure for:
apps/api
apps/dashboard
services/agent
ai/stt
ai/tts
packages/types
packages/tools
docs

Create only the minimal files needed for a clean starting point.

Do not implement authentication, appointments, STT, TTS, LLM or voice features yet.

Run type checks/build checks where possible.

When finished:
1. summarize files created
2. summarize dependencies
3. list commands tested
4. list issues
5. update docs/PROGRESS.md
6. stop
```

---

# 4. Phase 1 Prompt — Local Infrastructure

```text
Read docs/AGENTS.md
Read docs/PROGRESS.md
Read Phase 1 in docs/PHASES.md
Read docs/TECH_STACK.md
Read docs/PRODUCT_OVERVIEW.md

Implement ONLY Phase 1.

Set up local Docker infrastructure for:
- PostgreSQL
- Redis
- LiveKit

Hugging Face Inference Providers are external and must NOT be added as a Docker service. Configure the application to use the Hugging Face API securely through environment variables.

Create environment templates and health checks.

Do not implement business features.

Requirements:
- local development must remain ₹0
- secrets must not be committed
- services must have clear names
- persistent volumes must be used where appropriate
- README/docs must explain startup commands

Test:
- docker compose config
- service startup
- PostgreSQL connectivity
- Redis connectivity
- LiveKit availability
- application configuration for Hugging Face Inference Providers (do not expect a local container)

Update docs/PROGRESS.md and stop.
```

---

# 5. Phase 2 Prompt — Dashboard Foundation

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
docs/FRONTEND_ARCHITECTURE.md
docs/TECH_STACK.md

Implement ONLY Phase 2.

Build the Next.js dashboard foundation:
- App Router
- TypeScript
- Tailwind
- shadcn/ui
- responsive dashboard shell
- sidebar
- top navigation
- route groups
- loading/error boundaries
- basic theme support

Do not implement real API data yet.

Follow FRONTEND_ARCHITECTURE.md exactly.

Do not create unnecessary state-management abstractions.

Run lint/typecheck/build.

Update docs/PROGRESS.md and stop.
```

---

# 6. Phase 3 Prompt — Backend Foundation

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
docs/BACKEND_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md
docs/TECH_STACK.md

Implement ONLY Phase 3.

Before coding, inspect the equivalent production infrastructure in `D:\conexus\ConexusCRM-BE`. Reuse/adapt it instead of recreating proven utilities.

Build:
- Express
- TypeScript
- environment validation
- structured logger
- error classes
- async route wrapper
- API response helpers
- PostgreSQL connection
- Drizzle configuration
- Redis connection
- health endpoints

Do not implement auth or business modules yet.

Use the folder structure from BACKEND_ARCHITECTURE.md.

Run:
- typecheck
- lint
- build
- database connectivity check

Update docs/PROGRESS.md and stop.
```

---

# 7. Phase 4 Prompt — Authentication & Organization

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 4 in docs/PHASES.md
docs/BACKEND_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md
docs/FRONTEND_ARCHITECTURE.md

Implement ONLY Phase 4.

First inspect Conexus users, organizations, JWT, middleware and permissions. Reuse compatible patterns, but do not copy its old token lifecycle or ad-hoc organization selection.

Build:
- users
- organizations
- organization_members
- login
- refresh
- logout
- authentication middleware
- organization authorization
- dashboard login
- protected dashboard routes

Important:
- enforce organization membership server-side
- never trust organizationId from the browser
- never store long-lived secrets in localStorage
- use the documented web auth transport
- add validation and error handling

Create migrations.

Test:
- successful login
- invalid credentials
- expired/invalid token
- unauthorized organization access
- logout
- protected API

Update docs/PROGRESS.md and stop.
```

---

# 8. Phase 5 Prompt — LiveKit Browser Audio

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 5 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/FRONTEND_ARCHITECTURE.md
docs/BACKEND_ARCHITECTURE.md

Implement ONLY Phase 5.

Build:
- LiveKit server integration
- secure backend token endpoint
- dashboard voice testing page
- livekit-client integration
- microphone publishing
- room connection/disconnection UI

There is NO AI yet.

The success condition is realtime browser audio connectivity.

Do not add STT, LLM or TTS.

Test microphone permissions, connect, disconnect and error states.

Update docs/PROGRESS.md and stop.
```

---

# 9. Phase 6 Prompt — Node LiveKit Agent

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 6 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/TECH_STACK.md

Implement ONLY Phase 6.

Build the Node.js LiveKit Agent.

Requirements:
- @livekit/agents
- agent worker/session
- basic greeting
- lifecycle logging
- clean shutdown
- local development command

The agent does not need real STT/LLM/TTS yet.

Use a simple deterministic greeting to prove the agent joins the room and produces output.

Test browser -> LiveKit -> Agent.

Update docs/PROGRESS.md and stop.
```

---

# 10. Phase 7 Prompt — Silero VAD

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 7 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY Phase 7.

Integrate Silero VAD through LiveKit.

Focus on:
- speech start
- speech end
- turn boundaries
- interruption detection

Use initial conservative settings and document them.

Do not tune using assumptions. Create a small repeatable local test procedure.

Test:
- short speech
- long speech
- pauses
- background noise
- user interruption

Update docs/PROGRESS.md and stop.
```

---

# 11. Phase 8 Prompt — Deepgram Nova-3 STT

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 8 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/TECH_STACK.md

Implement ONLY Phase 8.

Integrate Deepgram Nova-3 streaming STT for Assamese. AI4Bharat IndicConformer is a fallback only if the Assamese benchmark shows Deepgram is insufficient.

Requirements:
- provider configuration
- clear service interface
- Assamese transcription
- streaming support
- configurable model/language settings
- no hardcoded secrets

Connect it to the LiveKit Agent using the documented Deepgram integration approach.

Do not implement LLM or TTS.

Test with Assamese audio samples.

Record latency/resource observations.

Update docs/PROGRESS.md and stop.
```

---

# 12. Phase 9 Prompt — STT Benchmark

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 9 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Do NOT add unrelated features.

Create a repeatable STT benchmark.

Test:
- Assamese
- Hindi
- English
- code switching
- names
- dates
- locations
- background noise
- phone-quality audio

Measure:
- transcription quality
- latency
- CPU
- RAM
- GPU/VRAM if used

Store results in docs/STT_BENCHMARK.md.

Do not mark the phase complete until the results are documented.

Update docs/PROGRESS.md and stop.
```

---

# 13. Phase 10 Prompt — Hugging Face Inference — Qwen3.5-4B

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 10 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/TECH_STACK.md

Implement ONLY Phase 10.

Connect the agent to Hugging Face Inference Providers.

Flow:
STT text -> LLM provider -> response text

Create an LLMProvider abstraction.

The implementation must not depend directly on Hugging Face Inference Providers throughout the codebase.

Test:
- Assamese
- Hindi
- English
- code switching
- missing information
- concise responses

No business tools yet.

Update docs/PROGRESS.md and stop.
```

---

# 14. Phase 11 Prompt — IndicF5 TTS

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 11 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY Phase 11.

Create the Python IndicF5 TTS service.

Build:
- health endpoint
- model loading
- text-to-audio
- configurable device/model
- clear API/service interface
- custom LiveKit TTS integration

Test Assamese speech output.

Measure latency and document it.

Update docs/PROGRESS.md and stop.
```

---

# 15. Phase 12 Prompt — Complete Voice Loop

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 12 in docs/PHASES.md
docs/PRODUCT_OVERVIEW.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY Phase 12.

Connect:

Browser
-> LiveKit
-> VAD
-> Deepgram Nova-3
-> Hugging Face Inference Providers
-> IndicF5
-> LiveKit
-> Browser

Test real Assamese conversations.

Test:
- normal conversation
- silence
- fast speech
- slow speech
- code switching
- STT failure
- LLM failure
- TTS failure

Do not add business tools yet.

Update docs/PROGRESS.md and stop.
```

---

# 16. Phase 13 Prompt — Barge-In

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 13 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY interruption/barge-in.

Required behavior:
Agent speaks
-> user starts speaking
-> detect speech
-> interrupt agent audio
-> capture user turn
-> STT
-> continue conversation

Test repeated interruptions and short interruptions.

Do not add business features.

Update docs/PROGRESS.md and stop.
```

---

# 17. Phase 14 Prompt — Agent Engine

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 14 in docs/PHASES.md
docs/PRODUCT_OVERVIEW.md
docs/VOICE_AI_ARCHITECTURE.md

Implement ONLY the reusable Agent Engine.

Create:
- AgentConfig
- session state
- conversation state
- prompt builder
- provider interfaces
- response policy
- lifecycle handling

Keep business-specific appointment logic out of the core engine.

The engine must support different business configurations later.

Update docs/PROGRESS.md and stop.
```

---

# 18. Phase 15 Prompt — Tool System

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 15 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md

Implement ONLY the typed tool system.

Build:
- tool definition
- tool registry
- Zod input validation
- trusted ToolContext
- executor
- tool result contract
- logging
- error handling

Create one harmless test tool first.

Important:
The LLM must never directly query PostgreSQL.

Update docs/PROGRESS.md and stop.
```

---

# 19. Phase 16 Prompt — Clinic Appointment Service Integration

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
docs/DATA_MODEL_AND_API_CONTRACT.md
docs/BACKEND_ARCHITECTURE.md

Also inspect the existing `whatsapp-appointment-platform` codebase completely before writing clinic appointment code.

IMPORTANT:
The clinic appointment system already exists.

The existing WhatsApp appointment platform is the source of truth for:
- clinic/tenant data
- users/patients
- doctors
- slots
- blocked dates
- appointments
- availability
- booking
- cancellation
- patient lookup/creation
- appointment token generation
- reminder scheduling
- doctor booking alerts
- timezone handling
- existing appointment state/flow

Do NOT create new clinic schemas, doctors tables, slots tables, patients tables, appointments tables, or duplicate booking services from scratch.

First map the existing implementation.

Inspect at minimum:
- existing Drizzle models/schema
- `createAppointmentFromBooking`
- `getOrCreatePatient`
- `listActiveDoctors`
- `findDoctorsByName`
- `listAvailableDates`
- `listAvailableSlots`
- `listUpcomingAppointmentsForPatient`
- `cancelAppointment`
- `scheduleReminder`
- `scheduleBookingAlert`
- tenant resolution
- timezone helpers
- the existing booking flow in `HOW_IT_WORKS.md`

The existing booking engine already provides concurrency protection through PostgreSQL transaction/advisory locking and slot row locking. Preserve and reuse those guarantees.

Goal:
Make the AI voice-agent platform consume the existing clinic appointment capabilities instead of maintaining a second appointment implementation.

Decide the cleanest integration boundary:
A. direct shared service/package imports, if the repositories can safely share the same database/service layer, OR
B. an internal authenticated API boundary if the systems must remain independently deployable.

Prefer reuse over duplication.

If the existing services need small changes, make them channel-agnostic so both WhatsApp and Voice can use them.

Do NOT redesign the existing WhatsApp flow.

Do NOT create a second source of truth for appointments.

Deliver:
1. integration architecture
2. service mapping
3. required adapter/wrapper layer, if any
4. minimal code changes
5. tests proving existing WhatsApp behavior is not broken
6. voice-compatible service contracts

Do not build the voice tools yet.

Update docs/PROGRESS.md and stop.
```

# 20. Phase 17 Prompt — Voice Appointment Agent

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md

Before implementing tools, inspect the service mapping created in Phase 16 and the original `whatsapp-appointment-platform`.

The voice agent is a NEW CHANNEL over the EXISTING clinic appointment system.

Implement these voice tools:

resolve_clinic_and_caller
list_doctors
find_doctor
get_available_dates
get_available_times
book_appointment
check_my_appointments
cancel_appointment

Add reschedule only if the existing appointment platform already has a safe reschedule capability. Do not invent a separate rescheduling engine.

Map tools to the existing services wherever possible:

resolve_clinic_and_caller
-> existing tenant resolution + getOrCreatePatient

list_doctors
-> listActiveDoctors

find_doctor
-> findDoctorsByName

get_available_dates
-> listAvailableDates

get_available_times
-> listAvailableSlots

book_appointment
-> createAppointmentFromBooking
   + existing scheduleReminder
   + existing scheduleBookingAlert

check_my_appointments
-> listUpcomingAppointmentsForPatient

cancel_appointment
-> existing cancelAppointment / appointment-status service

Rules:
- Do not duplicate database queries that the existing services already perform.
- Do not create a second appointment table or slot table.
- Do not bypass the existing booking transaction/locking logic.
- Tool arguments must be validated with Zod.
- Organization/tenant must come from trusted call/session context.
- Never invent availability.
- Never claim booking success without a confirmed result from the existing booking service.
- If the booking service reports a race/slot-taken result, refresh availability and offer the caller alternatives.
- Preserve the existing token-number behavior.
- Preserve tenant timezone behavior.
- Preserve existing reminder and doctor-alert jobs.
- The LLM must only decide which tool to call; it must not implement appointment business rules itself.

Test:
1. list doctors
2. find a doctor by spoken name
3. list dates
4. list times
5. book appointment
6. receive token number
7. check upcoming appointment
8. cancel appointment
9. simulate two callers attempting the same slot
10. verify WhatsApp appointment behavior still works

Update docs/PROGRESS.md and stop.
```

# 21. Phase 18 Prompt — Agent Configuration

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 18 in docs/PHASES.md
docs/PRODUCT_OVERVIEW.md
docs/FRONTEND_ARCHITECTURE.md
docs/BACKEND_ARCHITECTURE.md

Implement configurable agents.

Dashboard:
- agent list
- create agent
- edit agent
- language settings
- greeting
- instructions
- enabled tools
- working hours
- human transfer settings
- test button

Backend:
- persist configuration
- validate configuration
- enforce organization ownership

Do not create separate code paths for clinics/hotels.

Important clinic rule:
The agent configuration layer must NOT duplicate the existing WhatsApp clinic/tenant/doctor/slot/appointment data model.

For a clinic agent:
- reuse the existing clinic tenant identity
- reuse existing doctors and availability
- expose only the tools that the existing clinic services support
- store voice-specific configuration separately (greeting, voice, language behavior, prompt/instructions, enabled tools, working hours, human handoff settings)

The voice configuration is an orchestration/configuration layer, not a replacement for the existing clinic appointment system.

Update docs/PROGRESS.md and stop.
```

---

# 22. Phase 19 Prompt — Calls & Conversations

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 19 in docs/PHASES.md
docs/FRONTEND_ARCHITECTURE.md
docs/DATA_MODEL_AND_API_CONTRACT.md

Implement:
- calls list
- call detail
- conversation transcript
- tool events
- call outcome
- transfer status

Use native fetch through centralized API service modules and small custom request hooks. Do not install TanStack Query.

Include loading, empty and error states.

Do not add unrelated analytics.

Update docs/PROGRESS.md and stop.
```

---

# 23. Phase 20 Prompt — Local SIP

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 20 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Implement local LiveKit SIP testing.

Use a SIP softphone.

Test:
- inbound call
- outbound call if supported by local setup
- answer
- hangup
- agent response
- interruption
- call state

No paid PSTN provider.

Update docs/PROGRESS.md and stop.
```

---

# 24. Phase 21 Prompt — Production Telephony

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 21 in docs/PHASES.md
docs/VOICE_AI_ARCHITECTURE.md

Integrate the selected SIP/PSTN provider.

Before coding:
1. inspect current LiveKit SIP configuration
2. document provider requirements
3. document required public ports/webhooks
4. document environment variables
5. confirm inbound/outbound call flow

Then implement.

Do not modify the Agent Engine unnecessarily.

Test a real phone call end-to-end.

Update docs/PROGRESS.md and stop.
```

---

# 25. Phase 22 Prompt — AWS Pilot

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 22 in docs/PHASES.md
all architecture documents

Prepare production deployment for one organization.

Do not overengineer.

Deploy:
- API
- dashboard
- agent
- STT
- TTS
- LLM runtime
- PostgreSQL
- Redis
- LiveKit
- SIP

Use the smallest practical infrastructure based on measured resource usage.

Add:
- secrets
- HTTPS
- health checks
- logs
- restart policies
- backups

Run a production smoke test.

Update docs/PROGRESS.md and stop.
```

---

# 26. Phase 23 Prompt — Production Hardening

```text
Read:
docs/AGENTS.md
docs/PROGRESS.md
Phase 23 in docs/PHASES.md
all architecture documents

Audit the entire system.

Check:
- authentication
- authorization
- tenant isolation
- validation
- rate limits
- timeouts
- retries
- idempotency
- booking race conditions
- secrets
- logs
- error handling
- service failure recovery
- graceful shutdown
- database backups
- monitoring

Do not introduce new features unless required for reliability/security.

Document every issue found.

Fix the issues.

Update docs/PROGRESS.md and stop.
```

---

# 27. How We Work After Every Phase

After Antigravity finishes a phase, do NOT immediately start the next phase.

First ask:

```text
Review the implementation you just completed against:
- docs/AGENTS.md
- the current phase in docs/PHASES.md
- relevant architecture documents

Do a self-audit.

Check for:
1. missing requirements
2. architecture violations
3. duplicate abstractions
4. security problems
5. error-handling gaps
6. TypeScript issues
7. broken imports
8. missing tests
9. documentation mismatch

Fix only issues belonging to the current phase.

Run the relevant tests/typecheck/build.

Then update docs/PROGRESS.md.

Do not start the next phase.
```

## 28. If Antigravity Gets Confused

Use:

```text
STOP.

Do not write more code.

Re-read:
docs/AGENTS.md
docs/PROGRESS.md
docs/PHASES.md
and the architecture document relevant to the current task.

Tell me:
1. what phase we are in
2. what the phase requires
3. what you already implemented
4. what is missing
5. what you are about to change

Do not proceed until the plan matches the documentation.
```

## 29. Phase Transition Rule

Only move from Phase N to Phase N+1 when:

```text
Implementation complete
+
Tests/checks pass
+
Current phase requirements satisfied
+
No blocking issues
+
PROGRESS.md updated
```

Then use the next phase prompt.
