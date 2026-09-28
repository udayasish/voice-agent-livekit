# Assamese AI Voice Agent Platform — Progress

## Current Phase

**Phase:** 1 — Local Infrastructure

**Status:** NOT STARTED

## Status Legend

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `DONE`

## Phase Status

| Phase | Status | Notes |
|---|---|---|
| 0 Architecture Freeze | DONE | Architecture frozen, backend/ and frontend/ scaffolded and verified |
| 1 Local Infrastructure | NOT STARTED | |
| 2 Dashboard Foundation | NOT STARTED | |
| 3 Backend Foundation | NOT STARTED | |
| 4 Authentication & Organization | NOT STARTED | |
| 5 LiveKit Browser Audio | NOT STARTED | |
| 6 Node LiveKit Agent | NOT STARTED | |
| 7 Silero VAD | NOT STARTED | |
| 8 Deepgram Nova-3 STT | NOT STARTED | |
| 9 STT Benchmark | NOT STARTED | |
| 10 Hugging Face Inference — Qwen3.5-4B | NOT STARTED | |
| 11 IndicF5 TTS | NOT STARTED | |
| 12 Complete Voice Loop | NOT STARTED | |
| 13 Barge-In | NOT STARTED | |
| 14 Agent Engine | NOT STARTED | |
| 15 Tool System | NOT STARTED | |
| 16 Clinic Data & Appointment MVP | NOT STARTED | |
| 17 Voice Appointment Agent | NOT STARTED | |
| 18 Agent Configuration | NOT STARTED | |
| 19 Calls & Conversations Dashboard | NOT STARTED | |
| 20 Local SIP Testing | NOT STARTED | |
| 21 Production Telephony | NOT STARTED | |
| 22 Docker & AWS Pilot | NOT STARTED | |
| 23 Production Hardening | NOT STARTED | |
| 24 Multi-Business Expansion | NOT STARTED | |

## Current Work

Phase 0 completed. Ready for Phase 1 (Local Infrastructure).

## Last Completed Work

**Phase 0 — Architecture Freeze**
- Inspected production reference backend `D:\conexus\ConexusCRM-BE` and existing clinic platform `d:\Projects\whatsapp-appointment-platform`.
- Froze architectural boundaries: backend and AI services co-located in `backend/` following ConexusCRM-BE modular layout (`src/components/`, `src/lib/`, `src/middlewares/`), with dashboard in `frontend/` (Next.js 15).
- Created clean minimal skeletons for `backend/`, `backend/ai/tts`, and `frontend/`.
- Tested and verified:
  - `backend`: `npm run typecheck` (passed with 0 errors)
  - `backend`: `npm run build` (passed with 0 errors)
  - `backend`: server boot & `GET /api/v1/health` returning `{ success: true, data: { status: "ok" } }`
  - `frontend`: `npm run typecheck` (passed with 0 errors)
  - `frontend`: `npm run build` (Next.js production build succeeded)

## Known Blockers

None.

## Important Decisions

### Decision 1 — LiveKit
LiveKit is the realtime transport and voice infrastructure.

### Decision 2 — AI4Bharat
Deepgram Nova-3 is the initial STT and IndicF5 is the initial TTS. AI4Bharat IndicConformer remains a fallback option if benchmarking requires it.

### Decision 3 — Local LLM
Hugging Face Inference Providers is the initial development LLM runtime using Qwen3.5-4B.

### Decision 4 — Tool Boundary
The LLM cannot directly access PostgreSQL.

### Decision 5 — First Business
Clinic appointment booking is the first production workflow.

### Decision 6 — Development Cost
The complete development environment should work locally at ₹0.

### Decision 7 — Clinic Domain Integration Strategy
The WhatsApp appointment platform is kept completely separate with its own DB. In Phase 16, clinic schemas and services (`createAppointmentFromBooking`, `generateSlots`, etc.) will be copied directly into `backend/src/components/clinic/` with `tenantId` adapted to `organizationId` and `source`/`call_id` columns added.

### Decision 8 — Repository Layout
Repository structured into:
- `backend/`: Node.js Express 5 + TypeScript backend, following ConexusCRM-BE structure (`src/components/`, `src/lib/`, `src/middlewares/`), with AI agent provider interfaces and `ai/tts` Python FastAPI service.
- `frontend/`: Next.js 15 App Router web dashboard.
- Root: `docker-compose.yml` for local ₹0 services (Postgres, Redis, LiveKit).

### Decision 9 — Zod Version Alignment
Aligned to Zod v4 (`^4.1.12`) matching ConexusCRM-BE and satisfying peer dependency requirements of `@openai/agents`.

## Update Rule

After completing a phase, update:
- status
- implementation summary
- tests performed
- known issues
- next phase

Do not change future phase status in advance.
