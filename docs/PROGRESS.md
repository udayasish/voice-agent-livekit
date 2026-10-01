# Assamese AI Voice Agent Platform — Progress

## Current Phase

**Phase:** 3 — Backend Foundation

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
| 1 Local Infrastructure | DONE | Docker Compose up (PostgreSQL, Redis, LiveKit healthy), HF external config verified |
| 2 Dashboard Foundation | DONE | Next.js 15 App Router shell, Sidebar, Topbar, MobileNav, all 14 routes & UI primitives built and verified |
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

Phase 2 completed. Ready for Phase 3 (Backend Foundation).

## Last Completed Work

**Phase 2 — Dashboard Foundation**
- Built responsive, accessible dashboard foundation in `frontend/` conforming to `FRONTEND_ARCHITECTURE.md`:
  - **Core Primitives & Config**: `src/lib/utils.ts` (`cn` helper), `src/config/navigation.ts` (centralized routes and section groupings), `src/store/ui-store.ts` (Zustand client UI state for sidebar toggle and mobile nav — zero server data stored in Zustand).
  - **UI Component Primitives**: `Button`, `Card`, `Badge`, `Avatar`, `Separator`, `Input`, `Skeleton`.
  - **Layout Shell**:
    - `Sidebar`: Collapsible desktop navigation (260px / 72px) with active route highlighting, organization header, and status footer.
    - `Topbar`: Breadcrumb title, local environment badge, and organization context pill.
    - `MobileNav`: Responsive slide-out drawer with backdrop blur.
  - **Route Structure & Boundaries**:
    - `(public)/login`: Auth login skeleton.
    - `(dashboard)/layout`: Shell layout with nested loading boundary (`loading.tsx`), error boundary (`error.tsx`), and global `not-found.tsx`.
    - **14 Built Routes**: `/` (Overview), `/agents`, `/agents/new`, `/agents/[agentId]`, `/calls`, `/calls/[callId]`, `/conversations`, `/clinic`, `/phone`, `/analytics`, `/organization`, `/settings`.
- Verified and tested:
  - `npm --prefix frontend run typecheck` (Passed with 0 errors in TypeScript strict mode).
  - `npm --prefix frontend run build` (Next.js 15 production build succeeded across all 14 static and dynamic routes).
  - `npm --prefix backend run typecheck` (Passed with 0 errors).

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

### Decision 10 — External Hugging Face Inference Providers
Hugging Face Inference Providers are strictly configured as an external cloud API (`https://router.huggingface.co/v1`) using token authentication, and are NOT run as a local container.

### Decision 11 — Frontend State & Realtime Rules
- No TanStack Query installed.
- Native `fetch` through centralized API service modules (`src/services/api/client.ts`).
- Zustand used exclusively for shared client UI state (`ui-store.ts`).
- `livekit-client` is kept out of global shell bundles and loaded only where realtime voice is needed.

## Update Rule

After completing a phase, update:
- status
- implementation summary
- tests performed
- known issues
- next phase

Do not change future phase status in advance.
