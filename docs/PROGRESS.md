# Assamese AI Voice Agent Platform — Progress

## Current Phase

**Phase:** 6 — Node LiveKit Agent

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
| 3 Backend Foundation | DONE | Drizzle models (users, orgs, members), first migration applied, response envelope helpers, health check verified |
| 4 Authentication & Organization | DONE | JWT + bcryptjs auth, HTTP-only cookie transport, Redis session revocation, org membership authorization, dashboard login & protected routes verified |
| 5 LiveKit Browser Audio | DONE | Secure token API with JWT grants, VoiceSandbox UI, microphone publishing, audio level visualizer, multi-tab WebRTC verified |
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

Phase 5 completed. Ready for Phase 6 (Node LiveKit Agent).

## Last Completed Work

**Phase 5 — LiveKit Browser Audio**
- **LiveKit Server Integration**:
  - LiveKit server container verified healthy on port 7880 (signaling) and 7882 (WebRTC UDP).
  - Aligned IPv4 network addressing to `127.0.0.1:7880` in `.env` and environment schemas for rock-solid Windows Docker communication.
- **Secure Backend Token Endpoint**:
  - `POST /api/v1/livekit/token`: strictly guarded by `auth` and `requireOrganization` middlewares.
  - Zod validation for `createTokenSchema` (`roomName`, `participantName`, `agentId`).
  - Implemented `backend/src/components/livekit/services/create-token.ts` using `livekit-server-sdk` `AccessToken`.
  - Generates signed JWTs with 15-minute TTL, organization isolation metadata, and video grants (`roomJoin`, `canPublish`, `canSubscribe`, `canPublishData`).
  - Registered in `backend/src/app.ts` under standard `{ success, data }` response envelope.
- **Frontend `livekit-client` Integration**:
  - Installed `livekit-client` (`^2.22.3`) isolated to voice routes (`/agents/[agentId]` and `/agents/[agentId]/testing`) without bloating the global shell bundle (103 kB base vs 258 kB dynamic voice routes).
  - Centralized API service `frontend/src/services/api/livekit.ts` attaching `x-organization-id` header from active organization.
  - Custom React hook `frontend/src/hooks/use-livekit-room.ts` managing token fetch, WebRTC room connection, microphone tracks, mute/unmute, call timer, remote participant tracking, and HTML audio attachment.
  - Real-time Web Audio API volume level analyzer (`AnalyserNode`) providing 60fps audio level metering.
- **Voice Testing UI & Dedicated Lab**:
  - `frontend/src/components/voice/voice-sandbox.tsx`: interactive voice sandbox with pulsing connection status badges, live volume visualizer, microphone mute toggle, room & participant diagnostics, and actionable browser microphone permission error alerts.
  - Wired into `frontend/src/app/(dashboard)/agents/[agentId]/page.tsx` replacing previous placeholder.
  - Created dedicated full-screen testing laboratory `frontend/src/app/(dashboard)/agents/[agentId]/testing/page.tsx` with step-by-step instructions for Phase 5 two-way multi-tab audio loopback verification.
- **Tooling & Automated Tests**:
  - Created `backend/test/livekit.test.ts` (script: `npm run test:livekit`): 8/8 tests passed verifying 401 unauthorized, 400 missing org, 403 invalid org, 400 invalid agentId format, 200 token generation with defaults, cryptographic JWT claims verification, and custom room/participant overrides.
  - Created Bruno collection request `backend/bruno-collection/LiveKit/Create Token.bru` with automated response variable capture.
  - Typecheck passed: `npm --prefix backend run typecheck` (0 errors), `npm --prefix frontend run typecheck` (0 errors).
  - Production build passed: `npm --prefix backend run build` (0 errors), `npm --prefix frontend run build` (15/15 routes, 0 errors).

**Phase 4 — Authentication & Organization**
- **Password Hashing & Security**:
  - Implemented `backend/src/lib/password.ts` using `bcryptjs` with 10 salt rounds (`hashPassword`, `verifyPassword`).
  - Web auth transport uses HTTP-only, SameSite=Lax cookies (`access_token` and `refresh_token`). Zero long-lived tokens in localStorage.
- **JWT & Redis Session Management**:
  - Short-lived access tokens (15m) and refresh tokens (7d) signed with unique `jti`.
  - Redis session tracking (`storeRefreshToken`, `isRefreshTokenValid`, `revokeRefreshToken`, `revokeAllUserTokens`).
  - Token rotation on `/auth/refresh`: old refresh token revoked in Redis upon issuing new token pair.
- **Middlewares & Server-Side Tenant Isolation**:
  - `auth` middleware (`src/middlewares/auth.ts`): verifies Bearer token header or cookie `access_token`, ensures user exists in DB and is active, attaches typed `req.ctx.user`.
  - `requireOrganization` middleware (`src/middlewares/organization.ts`): intercepts `x-organization-id` header or path parameter, verifies membership in PostgreSQL, attaches trusted `req.ctx.organization`. Never trusts client-supplied organizationId.
  - Auto-injected `auth` middleware on all protected routes in `src/app.ts`.
- **Auth & Organization Endpoints**:
  - `POST /api/v1/auth/login` (and alias `/api/v1/users/login`)
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout` (and alias `/api/v1/users/logout`)
  - `GET /api/v1/me` (and alias `/api/v1/users/me`)
  - `GET /api/v1/organizations`
  - `GET /api/v1/organizations/:organizationId` (and alias `/api/v1/organizations/:id`)
- **Database Seed**:
  - `src/lib/db/seed.ts` (script: `npm run db:seed`): idempotently creates "Brahmaputra Health Clinic", "Guwahati Dental Clinic", and admin user `admin@brahmaputrahealth.com` (`Password123!`) as owner.
- **Frontend Dashboard Auth**:
  - `services/api/auth.ts` & `services/api/organization.ts`: centralized API calls with `credentials: "include"`.
  - `store/auth-store.ts`: Zustand store for user profile and active organization. Zero tokens in localStorage.
  - `app/(public)/login/page.tsx`: form validation via React Hook Form + Zod, error alert banners, and redirect.
  - `components/auth/auth-guard.tsx`: client-side session verification on dashboard mount with loading skeletons.
  - `components/layout/topbar.tsx`: displays authenticated user name, active organization pill, and working Sign Out action.
  - `middleware.ts`: Next.js Edge route protection redirecting unauthenticated users to `/login`.
- **Verification & Automated Tests**:
  - Integration test suite `test/auth.test.ts` (script: `npm run test:auth`):
    1. Successful Login ✅
    2. Invalid Credentials ✅
    3. Expired / Invalid Token ✅
    4. Protected API Access ✅
    5. Unauthorized Organization Access ✅
    6. Token Refresh & Logout ✅
  - Typecheck passed: `npm --prefix backend run typecheck` (0 errors), `npm --prefix frontend run typecheck` (0 errors).
  - Production build passed: `npm --prefix backend run build` (0 errors), `npm --prefix frontend run build` (14/14 routes + Edge middleware).

**Phase 3 — Backend Foundation**
- Established Drizzle ORM models under `backend/src/lib/db/models/`:
  - `common.ts`: Reusable `commonFields` (UUID primary key defaultRandom, timestamp `createdAt`, timestamp `updatedAt`).
  - `users.ts`: `users` table schema with `passwordHash`, `userStatusEnum` ('active', 'suspended'), and relations.
  - `organizations.ts`: `organizations` table, `organizationMembers` table, enums (`businessTypeEnum`, `organizationStatusEnum`, `memberRoleEnum`), composite unique constraints, indexes, and cascade relations.
  - `index.ts`: Barrel export of all models.
- Standard API response helpers:
  - `backend/src/lib/response.ts`: Implemented `successResponse` / `success` and `errorResponse` / `failure` helpers enforcing the `{ success: true, data }` / `{ success: false, error }` contract.
  - Exported from `backend/src/lib/index.ts`.
- Migrations:
  - Added `dotenv/config` to `backend/drizzle.config.ts`.
  - Added `db:migrate` script to `backend/package.json` using `tsx`.
  - Generated initial migration: `0000_worried_sphinx.sql`.
  - Successfully executed `npm run db:migrate` against PostgreSQL container; verified `users`, `organizations`, `organization_members` tables and 4 enums exist in PostgreSQL.
- Health Check:
  - Updated `backend/src/components/health/controllers.ts` to test Drizzle ORM query execution (`db.execute(sql\`SELECT 1 AS ok\`)`) alongside PostgreSQL pool, Redis, LiveKit, and external Hugging Face inference configuration.
  - Returns standard response envelope using `successResponse`.
- Verification:
  - `npm --prefix backend run typecheck` passed (0 errors in strict mode).
  - `npm --prefix backend run build` passed (0 errors).
  - Server starts cleanly on port 4000 and connects to Redis.

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
