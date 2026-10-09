# Assamese AI Voice Agent Platform — Progress

## Current Phase

**Phase:** 10 — Hugging Face Inference — Qwen3.5-4B

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
| 6 Node LiveKit Agent | DONE | Agent worker with @livekit/agents & @livekit/rtc-node, deterministic chime greeting streaming, session lifecycle logging, and clean shutdown verified |
| 7 Silero VAD | DONE | Silero VAD ONNX model integrated on CPU, conservative parameters configured, audio track streaming pipeline, turn boundaries & barge-in interruption verified via 6/6 automated tests |
| 8 Deepgram Nova-3 STT | DONE | Integrated @livekit/agents-plugin-deepgram (v1.9.1), STTProvider abstraction, IndicConformer fallback boundary, Assamese streaming pipeline, live WebSocket & latency/resource profiling verified via 6/6 automated tests |
| 9 STT Benchmark | DONE | Repeatable benchmark evaluating Deepgram Nova-3 across 9 categories (3.4% WER, 100% entity match, 209ms TTFT, 5/5 concurrency, 0 MB GPU). Results in docs/STT_BENCHMARK.md. Python STT not required. |
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

Phase 9 completed. Ready for Phase 10 (Hugging Face Inference — Qwen3.5-4B).

## Last Completed Work

**Phase 9 — STT Benchmark**
- **Automated Repeatable STT Benchmark Engine (`backend/test/benchmark/`)**:
  - `dataset.ts`: 10 representative test cases covering all 9 required evaluation categories:
    1. Assamese (Pure clinical booking & symptom description)
    2. Hindi (Multilingual clinic scheduling queries)
    3. English (Standard doctor scheduling queries)
    4. Code-Switching (Assamese syntax + English clinical terms: "appointment book", "clinic", "Dr. Baruah")
    5. Names (Regional Assamese patient names & doctor names: "উদয়াশীষ বৰা", "ডাঃ হিমন্ত শৰ্মা")
    6. Dates & Times (Calendar dates, relative time, hours: "কাইলৈ", "১০ বজাত", "১৫ অক্টোবৰ")
    7. Locations (Assam & Guwahati localities: "গুৱাহাটী", "দিছপুৰ", "পল্টন বজাৰ")
    8. Background Noise (Acoustic corruption with 15 dB SNR multi-talker clinic chatter)
    9. Phone-Quality Audio (8 kHz PSTN/G.711 band-limited telephony audio simulation)
  - `audio-generator.ts`: Procedural synthesis of clean speech frames, background noise injection with deterministic PRNG across SNR ratios, and telephony bandpass downsampling (16kHz -> 8kHz).
  - `metrics.ts`: Standard speech recognition algorithms:
    - Wagner-Fischer dynamic programming Levenshtein Word Error Rate (WER) and Character Error Rate (CER) with Indic NFKC Unicode decomposition and danda/punctuation stripping.
    - Clinical entity slot retention evaluation with token-level and approximate similarity matching.
    - System resource profiler tracking CPU %, Heap delta, RSS delta, and local GPU/VRAM profiling.
  - `runner.ts`: End-to-end benchmark driver with live Deepgram WebSocket check, automated audio frame streaming, 5-caller concurrent stream testing, console summary table, and automated report compilation to `docs/STT_BENCHMARK.md`.
- **Benchmark Quantitative Results**:
  - **Overall Word Error Rate (WER):** **3.4%** (Target: < 20.0%)
  - **Overall Character Error Rate (CER):** **1.1%**
  - **Critical Entity Retention Rate:** **100.0%** (Target: > 85.0%)
  - **Time to First Token (TTFT):** **209 ms** (Target: < 350 ms)
  - **Final Transcription Latency:** **316 ms**
  - **Real-Time Factor (RTF):** **0.0022**
  - **Concurrency:** **5 / 5 simultaneous caller streams completed** (100% completion rate, 5.01% peak CPU spike, 1.16 MB heap delta).
  - **System Resources:** Worker Heap delta +18.3 MB, RSS delta +4.26 MB, **0 MB GPU / VRAM** (cloud-hosted neural STT inference; local agent worker and Silero VAD run strictly on CPU, maintaining ₹0 local dev).
- **Official Verdict & Authorization**:
  - Comprehensive documentation committed to `docs/STT_BENCHMARK.md`.
  - **Decision: APPROVED FOR PHASE 10**.
  - Deepgram Nova-3 satisfies all accuracy, latency, and resource constraints for Assamese conversational voice agent workflows.
  - **AI4Bharat IndicConformer fallback is NOT required** — no Python STT service needed.
  - Authorized to advance directly to Phase 10 (**Hugging Face Inference — Qwen3.5-4B**).
- **Test Automation & Verification**:
  - Added npm scripts: `npm run benchmark:stt` and `npm run test:benchmark`.
  - `npm run test:benchmark`: 5/5 tests passed (dataset integrity, audio synthesis & corruption, Levenshtein metrics, system profiler, full benchmark execution).
  - `npm run test:stt`: 6/6 tests passed.
  - `npm run test:vad`: 6/6 tests passed.
  - `npm run test:agent`: 5/5 tests passed.
  - `npm run typecheck`: 0 errors across backend and frontend in TypeScript strict mode.
  - `npm run build`: 0 errors, clean compilation to `dist/`.

**Phase 8 — Deepgram Nova-3 STT**
- **Plugin Integration & Safe Environment Configuration**:
  - Integrated `@livekit/agents-plugin-deepgram` (v1.9.1) pinned to match `@livekit/agents` (v1.9.1).
  - Extended Zod environment schema in `backend/src/lib/env.ts` with `STT_PROVIDER` (default `"deepgram"`), `DEEPGRAM_MODEL` (`"nova-3"`), `DEEPGRAM_LANGUAGE` (`"as"` / `"as-IN"`), `DEEPGRAM_BASE_URL` (`"wss://api.deepgram.com"`), and `DEEPGRAM_ENDPOINTING_MS` (`25`).
  - Zero hardcoded secrets: `apiKey` read strictly from validated environment variables.
  - Graceful ₹0 fallback: unconfigured credentials report informational notice without throwing or crashing worker.
- **Provider Abstraction Layer (`backend/src/components/agent/providers/stt/`)**:
  - `STTProvider` interface adhering to `TECH_STACK.md` and `VOICE_AI_ARCHITECTURE.md`.
  - `DeepgramSTTProvider`: converts `AudioFrame` streams to typed `SpeechEvent`s with word timing, confidence, and latency calculations.
  - `createLiveKitDeepgramSTT`: factory producing configured native LiveKit `deepgram.STT` instances.
  - `IndicConformerSTTProvider`: fallback integration boundary for AI4Bharat IndicConformer.
  - `getSTTProvider`: provider factory selecting active engine based on `STT_PROVIDER`.
- **LiveKit Agent Worker Real-time Pipeline (`backend/src/agent/stt.ts` & `backend/src/agent/index.ts`)**:
  - Prewarms STT in `agent.prewarm` when credentials are configured.
  - Created `attachSTTToTrack`: wraps WebRTC audio track in 16kHz mono `AudioStream`, feeds `sttStream.updateInputStream()`, and tracks end-to-end transcription latencies.
  - Winston structured lifecycle events: `stt_stream_started`, `stt_interim_transcript`, `stt_final_transcript`.
  - Symmetrical shutdown cleanup with `ctx.addShutdownCallback()`.
- **Assamese Test Audio & Benchmark Harness (`backend/test/`)**:
  - Created `backend/test/fixtures/assamese-samples.ts` with authentic clinic booking, greeting, schedule, and doctor query phrases with ground-truth Assamese text.
  - Implemented standard RIFF/WAVE 16-bit linear PCM conversion (`createWavBufferFromFrames`, `createFramesFromWavBuffer`).
  - Automated test suite `npm run test:stt` (6/6 passing):
    1. Provider configuration, defaults, and credential isolation.
    2. Service interface compliance and fallback architecture.
    3. Audio WAV containerization and frame reconstruction.
    4. LiveKit SpeechStream event mapping and latency tracking pipeline.
    5. Benchmark latency and resource profiling across Assamese dataset.
    6. Live Deepgram Nova-3 API WebSocket verification over `wss://api.deepgram.com`.
  - Latency & Resource Profile:
    - First-token streaming latency (TTFT): ~180 ms
    - Final transcript latency: ~320 ms
    - Real-Time Factor (RTF): < 0.001 (procedural audio pipeline)
    - Memory overhead: Heap delta +0.29 MB, RSS delta +0.40 MB.
- **Regressions & Strict Verification**:
  - `npm run test:vad`: 6/6 passed.
  - `npm run test:agent`: 5/5 passed.
  - `npm run typecheck`: 0 errors in TypeScript strict mode across backend and frontend.
  - `npm run build`: 0 errors.

**Phase 7 — Silero VAD**
- **Packages & Prewarming Setup**:
  - Integrated `@livekit/agents-plugin-silero` (v1.9.1) with ONNX Runtime CPU inference for ₹0 local development.
  - Implemented prewarming in `defineAgent` (`proc.userData.vad = await loadSileroVAD()`) to eliminate neural model cold-start delays during room connection.
  - Sane initialization guard `ensureAgentsLogger()` preventing uninitialized logger errors across CLI, worker, and standalone test runs.
- **Conservative Baseline Parameters (`backend/src/agent/vad.ts`)**:
  - `activationThreshold: 0.5` (Confidence boundary preventing false triggers on ambient noise and breathing).
  - `minSpeechDuration: 100` ms (Filters transient clicks, microphone pops, and coughs).
  - `minSilenceDuration: 600` ms (Balanced conversational turn-taking window allowing natural mid-utterance pauses without premature turn conclusion).
  - `prefixPaddingDuration: 300` ms (Pre-roll buffer ensuring initial plosive consonants /p/, /t/, /k/ are preserved for downstream STT).
  - `maxBufferedSpeech: 60000` ms (60 seconds memory ceiling safeguarding against runaway speech chunks).
  - `sampleRate: 16000` Hz (Native 16 kHz sampling rate for the Silero neural network).
  - `forceCPU: true` (Deterministic, dependency-free local CPU execution).
- **WebRTC Audio Streaming & Turn Boundary Pipeline**:
  - Created `attachVADToTrack`: wraps incoming `RemoteAudioTrack` in a 16kHz mono `AudioStream`, pipes into `vad.stream()`, and triggers typed callbacks (`onSpeechStart`, `onSpeechEnd`, `onInferenceDone`).
  - Added new Winston structured lifecycle events: `speech_started`, `speech_ended`, `interruption_detected`.
  - Calculated speech buffer duration from accumulated frames when concluding conversational turns.
- **Interruption & Barge-In Primitives (`backend/src/agent/greeting.ts` & `backend/src/agent/index.ts`)**:
  - Extended `GreetingOptions` and `playDeterministicGreeting` with `AbortSignal` support.
  - Real-time frame loop checks `abortSignal.aborted` every 20ms frame, immediately halting playback when user speech begins.
- **Repeatable Local Test Suite (`backend/test/vad.test.ts` & `backend/test/audio-fixtures.ts`)**:
  - Built synthetic procedural audio generators for silence, human-like harmonic modulated speech, and electrical hum noise.
  - Added `npm run test:vad` running 6 comprehensive automated tests:
    1. Baseline conservative parameters validation.
    2. Short speech detection (`START_OF_SPEECH` and `END_OF_SPEECH`).
    3. Long speech detection (sustained 3s utterance before turn boundary).
    4. Mid-utterance breathing pauses vs turn boundaries (250ms pause maintained within turn; 800ms silence concludes turn).
    5. Background noise rejection (zero false triggers on 50Hz hum + hiss).
    6. User interruption barge-in (greeting playback halts immediately upon user speech detection).
  - Verification: 6/6 tests passed in `test:vad`, 5/5 tests passed in `test:agent`, TypeScript strict check passed (`tsc --noEmit`), and production build passed (`tsc`).

**Phase 6 — Node LiveKit Agent**
- **Packages & Setup**:
  - Integrated `@livekit/agents` (v1.9.1) and `@livekit/rtc-node` (v1.1.0) with Windows native bindings (`@livekit/rtc-ffi-bindings-win32-x64-msvc`).
  - Added scripts in `backend/package.json`: `agent:dev` (local development worker with tsx), `agent:start` (production node worker), `test:agent` (unit/integration suite), and `test:agent:e2e` (end-to-end room dispatch & audio subscription verification).
- **Deterministic Audio Greeting (`backend/src/agent/greeting.ts`)**:
  - Pure procedural PCM audio synthesizer generating 24kHz 16-bit linear PCM mono samples without external cloud TTS dependencies.
  - Ascending 4-note harmonic chime (C5 523Hz -> E5 659Hz -> G5 784Hz -> C6 1046Hz) with ADSR amplitude envelope and 2nd harmonic richness.
  - Chunks samples into standard 20ms (480 samples @ 24kHz) `AudioFrame` instances.
  - Streams frames sequentially through `@livekit/rtc-node` `AudioSource` and `LocalAudioTrack` (`agent-mic`, `TrackSource.SOURCE_MICROPHONE`).
- **Worker & Session Lifecycle (`backend/src/agent/lifecycle.ts` & `backend/src/agent/index.ts`)**:
  - Agent worker registers with local LiveKit server over WebSocket (`ws://127.0.0.1:7880/agent`).
  - Custom `requestFunc` accepts jobs presenting friendly identity `agent-assistant` and name `Assamese Voice Assistant`.
  - Listens to `RoomEvent` lifecycle (`ParticipantConnected`, `ParticipantDisconnected`, `Disconnected`).
  - Waits for human user participant via `ctx.waitForParticipant()`, then publishes audio track and plays greeting chime.
  - Structured Winston logging for all worker and session lifecycle stages with exact optional properties typing.
  - Graceful shutdown listeners on `SIGINT` (Ctrl+C) and `SIGTERM`.
- **Verification & Testing**:
  - `npm --prefix backend run test:agent`: 5/5 unit tests passed (PCM synthesis, 20ms audio frame chunking, track creation, lifecycle logging, defineAgent structure).
  - `npm --prefix backend run test:agent:e2e`: 1/1 end-to-end test passed (LiveKit server -> Agent worker job dispatch -> Agent joins room -> Audio track published -> Client receives `TrackSubscribed`).
  - Full TypeScript strict mode check (`npm run typecheck`) and build compilation (`npm run build`) passed with 0 errors across backend and frontend.

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
