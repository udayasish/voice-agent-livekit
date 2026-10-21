# Assamese AI Voice Agent Platform — Backend Architecture

## Phase 16 staff backend completion (2026-10-21)

The authenticated clinic HTTP adapter uses the existing Route[] pipeline. Header UUID validation precedes organization membership verification; owner/admin manage doctor/schedule data while all member roles manage appointments. Thin handlers parse context/input/results; injected clinic services own queries and transactions. Final endpoints and local acceptance evidence: [PHASE_16_BACKEND_ACCEPTANCE.md](PHASE_16_BACKEND_ACCEPTANCE.md).

Migration 0004 adds appointment versions, persistent doctor/date token counters, scoped mutation receipts and move history. Same-doctor moves preserve appointment/patient/source identity and same-day tokens, allocating new tokens on date change. Relevant writers coordinate doctor locks and sorted date/slot locks. Blocking refuses booked appointments; deactivation refuses future bookings. Staff logs contain actor IDs without patient input.

Voice uses the shared allocator and trusted readback version/date/time guards, preventing stale cancellation after staff movement without new voice tool inputs. Notification jobs have versioned identities; delivery remains unconfigured. Pause API/worker writes to migrate an application database before deploying new writers. Implementation migrated only isolated test databases.

## Phase 17 confirmed-caller resolution (2026-10-17)

`resolve_clinic_and_caller` now takes only `{}`. The clinic runtime binds an already captured and playback-confirmed phone through the same enabled tool/executor and existing `getOrCreatePatient` service immediately after validated confirmation. No phone, patient ID or tenant identity is reconstructed by the model. Missing/unclear/interrupted confirmations cannot bind the caller; later explicit complete corrections invalidate the binding and require a fresh readback. Appointment authorization and knowledge checks remain separate.

The generic engine's dynamic instructions callback refreshes business prompt facts before each SDK model step. Provider-specific completion budgeting is optional on `LLMProvider`; GPT-OSS reasoning headroom is accounted for before context fitting. Truncated output is a classified model failure, not a valid answer or a reason to replay tools. No database, HTTP endpoint, migration or Bruno change was introduced.

## Phase 17 multilingual number validation (2026-10-17)

The clinic voice adapter's new `spoken-numbers.ts` shares bounded cardinal/token parsing between age validation and clock interpretation, reusing existing single-digit normalization. Mixed word/digit evidence is evaluated as a complete expression rather than treating its last digit as the whole age. Known expressions must agree with the proposed value; existing source evidence, integer bounds and disagreement guards remain. A server-derived current-utterance numeric hint and focused age/time task use the existing SDK interpretation call. Hints are model context only, not stored identity or permission.

`calendar.ts` adds contextual word/phonetic clock forms, `বজা`, minute phrases, repetition handling and conflict detection; `dialogue.ts` still selects only actual returned slot IDs and preserves AM/PM ambiguity. `runtime.ts` distinguishes explicit age/name input from short offered choices, whose interpretation cannot change patient fields. No SQL query, service transaction, tool allowlist, notification rule, provider runtime or reusable-engine domain branch was added.

## Phase 17 patient-name extraction boundary (2026-10-17)

The live `name_mismatch` failure is addressed in `clinic/voice/intake.ts` by separating model output from canonical state. `intakeModelDecisionSchema` requests one `{quote, sourceTurn}` name reference; `materializeIntakeDecision` validates the source substring, trims limited terminal speech punctuation and constructs the existing evidence-linked candidate. The model cannot supply a second, divergent stored spelling. `validateIntakeDecision` still checks canonical proposals from injected interpreters, evidence/age/disputes/selections and source ownership. No patient-service/query or permanent data schema is changed.

`runtime.ts` passes its server-owned expected field to focus the same single SDK interpretation and supplies spelling guidance after repeated failed name capture. This reduces ambiguity in the overloaded intake prompt while preserving semantic rejection of help/unrelated speech. High STT scores do not bypass validation, completed readbacks or service permissions. This changes the clinic interpretation contract, not the reusable engine or transport.

## Phase 17 focused speech and draft preparation (2026-10-17)

Clinic-owned response checks and `voice/speech-style.ts` shorten ordinary model-written guidance, retain canonical state and reject bounded obvious factual conflicts. They do not modify the generic engine or replace the existing booking service. Once a confirmed phone, selected actual slot and undisputed name/age are present, a clear booking request can plan the existing tool's prepare operation. Prepare lazily binds the confirmed caller through the existing `getOrCreatePatient` service; it creates no appointment. Confirm still requires its server-owned draft and later playback-eligible authorization. All tool permissions, request identity, transaction locks and notification semantics remain unchanged.

The existing doctor lookup additionally accepts an exact normalized stored name/alias followed by Assamese possessive `ৰ`. It does not add fuzzy matching, transliteration or unreviewed spelling aliases. Intake failure logs now separate validation categories from HTTP failures using safe finish reason/status/count metadata. This change addresses diagnostic ambiguity exposed by live calls; it cannot reconstruct missing earlier provider output. No new service query implementation, database migration or HTTP endpoint is introduced.

## Phase 17 early intake and correction state (2026-10-17)

The clinic adapter now captures name/age independently of slot-selection order and persists evidence-linked candidates, name/age dispute flags, revision, approved last-question context, bounded non-progress count and two unresolved source utterances. This corrects the earlier mismatch between early model acknowledgements and absent validated fields. `intake.ts` validates proposals and reduces limited keep/set/dispute transitions; `runtime.ts` applies them only for the current uncancelled turn/revision. No unrestricted model state patch is accepted. Candidate updates do not grant patient identity or appointment access.

The same tool-free SDK interpretation can write the ordinary follow-up, avoiding routine extraction-plus-generation calls. Short ambiguous option answers may propose only returned date/slot references. The clinic dialogue validates/commits those references and uses existing enabled availability tools; no duplicate query/service is introduced. Pending booking corrections invalidate the old draft and require a revised readback and later confirmation. Active snapshots retain existing organization scope, serialized writes, thirty-minute TTL and deletion on close; no migration, restart hydration or permanent storage is added. Operational logs contain identifiers, field-presence/dispute booleans, next goal and outcome counts, never candidate values/evidence.

## Phase 17 selected-record and recovery follow-up (2026-10-17)

The live date-selection failure is addressed inside `components/clinic/voice/`: offered-date resolution, selected-doctor binding, stage-relevant tool subsets, concise model goals and retained failed-read context. Availability tools use the selected trusted record when doctorId is omitted and reject conflicting supplied references before services. The existing service performs its tenant/active/availability checks as before. No duplicate database query or appointment implementation was added.

The generic context budget reserves room for the next result and retains the latest exchange when hard limits permit. Provider quota headers suppress optional background work through the existing injected cooldown infrastructure; no account-limit guarantee or automatic mutation retry is introduced. Clinic read-event summaries are skipped because selections already live in validated state. Failed operations and caller-scoped confirmed outcome summaries support contextual replies without leaking earlier caller facts. Worker recovery admission suppresses repetitive unusable-speech prompts while keeping listening active. No new endpoint, migration, dependency or Bruno change is required.

## Phase 17 bounded context boundary (2026-10-17)

**Reason for the change:** the previous SDK request replayed growing history, full tool results and overlapping clinic state until live provider requests returned HTTP 413. The backend now keeps complete active session snapshots in the existing serialized, organization-scoped Redis store while `engine/context.ts` and the per-session `ContextBudget` construct a bounded model view for every SDK call. The transport enforces the final serialized body size. No clinic fields, SQL, Redis access or LiveKit transport were added to the reusable context builder.

Optional validated tool-result projections keep complete canonical results in the executor's invocation cache and session history, with compact recorded results for the SDK and later model replay. Clinic voice read tools provide validated offsets and bounded pages through existing services; the module determines doctor ambiguity before paging. A projection error cannot change a committed service outcome. The clinic adapter owns early name/age candidate capture, contextual help, selected facts and the caller-change boundary; the engine owns cancellation, preparation, memory lifecycle and storage. Background memory sees only business-supplied safe public notes, remains non-authoritative and never delays the caller.

The existing LLM HTTP adapter measures exact request bytes, distinguishes 413 from 429 and other safe categories, and maintains provider cooldown via an injected Redis port. One 413 recovery retries the same failed request at a smaller budget without replaying completed tools. Trusted server profile configuration may lower context limits; the browser and model cannot raise them. Winston records operational size/usage/failure metrics without transcripts, patient details, tool payloads, provider bodies or credentials. This adds no migration, HTTP endpoint, Bruno request, library or new appointment service.

## Phase 17 contextual confirmation boundary (2026-10-16)

**Why this changed:** keyword-first negation could discard a correctly captured number before the LLM interpreted a conversational correction. Confirmation text was also considered heard before audio playback finished. These changes separate understanding, state validation and playback eligibility; appointment services, tables and authorization remain the source of truth.

The clinic voice interpreter uses the injected provider through the existing `ProviderModel` and a tool-free SDK Runner. A strict Zod output proposes confirm/reject/replace/restore/correct/cancel-pending/unclear, a known server reference and exact current-utterance evidence. It sees the current utterance, at most four preceding messages, candidate references and the pending readback. One model turn, temperature zero, 256 output tokens and a three-second deadline apply. Invalid JSON/schema/references/evidence, provider failures and timeout become unclear, without repair or automatic retry. SDK tracing remains disabled. Semantic decisions are probabilistic; schema checks are not proof of correct language understanding.

The generic engine now establishes cancellation ownership, retains the accepted user turn, awaits optional asynchronous business preparation, rejects stale results, validates/persists state, and only then runs the existing SDK tool loop. A prepared business reply skips generation while retaining response policy/history/stream consistency. `processRecovery` adds assistant-only history with no fake user utterance and no model/tool execution. These are optional business-neutral hooks; the core imports no clinic or database modules.

Clinic snapshots retain up to five server-identified number candidates, active confirmation/playback state, pending action confirmation metadata and committed action summaries. Rejection keeps a number unconfirmed; restoration triggers a fresh readback. Complete replacements must normalize from explicitly supplied digits. Partial corrections request the full corrected number. Changing or restoring a phone revokes patient bindings, grants and uncommitted drafts; committed outcomes/request identities remain available for reconciliation. Session writes retain the existing serialized Redis writes, thirty-minute TTL and deletion on close. These are active snapshots, not durable conversation storage or worker-restart hydration.

`notifyPlaybackResult` establishes readback eligibility only after nonempty audio and native queue drain. Interrupted/failed/empty/timed-out playback cannot authorize an action. Booking/cancellation still require a later affirmative decision targeting the exact draft; corrections invalidate it and require preparation again. Rejecting a cancellation draft never cancels the appointment. Existing service locks, capacity checks, tokens, idempotency and post-commit scheduling are unchanged.


## Phase 17 bilingual doctor / dialogue follow-up (2026-10-16)

The adopted clinic boundary now includes additive reviewed doctor metadata: nullable `clinic_doctors.name_en` / `name_as` and non-null `search_aliases` (empty by default), migration `0003_chief_purple_man.sql`. Existing contacts, doctor identities and appointment relationships stay intact. `findDoctorsByName` remains the single scoped lookup implementation, normalizing legacy/bilingual names and aliases consistently. It filters one organization-scoped catalog in application code for Unicode normalization; it does not perform fuzzy matching or cross-script guessing. Larger catalogs may need a reviewed normalized search index later. Existing public-name fields remain compatible; doctor service results add optional bilingual metadata. The internal operator importer validates and applies reviewed metadata transactionally, defaults to dry-run and exposes missing-English-name readiness. No new endpoint was introduced.

The clinic voice adapter owns read-request routing, candidate/selected-doctor state, calendar interpretation and localized fallback rendering. Optional neutral engine hooks supply a server-owned initial SDK call, narrow the per-turn tool subset, distinguish verified context from caller data, and classify reply source. The SDK Model bridge emits the initial call once; the normal registry/executor still validates every execution against the trusted session and allowlist. No SQL, clinic keywords or booking rules enter the reusable engine/providers. Existing booking locks, tokens, request identities, confirmation and notification contracts remain unchanged.

This change addresses the observed live doctor-list/name loop: a successful query alone did not guarantee model tool choice, persistent selection or usable speech. Read outcomes now carry explicit status/count and can render verified facts when generation fails. Safe diagnostics distinguish HTTP/network/timeout/protocol/SDK-limit failures; provider bodies and private arguments remain excluded. The separately reported phone issue is addressed by the contextual confirmation follow-up above. Microphone/hosted-model acceptance remains open.

**Stack:** Node.js + Express.js + TypeScript + PostgreSQL + Drizzle ORM + Redis

**Project path:** `backend/`

## Reference Project — ConexusCRM-BE

**Reference path:** `D:\conexus\ConexusCRM-BE`

`ConexusCRM-BE` is our production backend reference for **implementation patterns**, not for product/domain behavior. It already matches much of our target style: modular components, one-operation services, thin controllers, Drizzle/PostgreSQL, Redis, permissions, strict TypeScript, and transaction helpers.

### Reuse / Adapt

| Pattern | Reference | Target rule |
|---|---|---|
| Express setup | `src/app.ts` | Reuse/adapt |
| Route registry | component `routes.ts` + `src/types.ts` | Keep `Route[]` style if suitable; do not rewrite merely to use `Router()` |
| Thin controllers | component controllers | Reuse |
| One service = one operation | `src/components/*/services/*` | Reuse |
| Error classes | `src/lib/errors.ts` | Reuse/adapt |
| Logger | `src/lib/logger.ts` | Reuse |
| Env validation | `src/lib/env.ts` | Reuse pattern; add platform vars |
| JWT helpers | `src/lib/jwt.ts` | Reuse cryptographic helpers; replace lifecycle |
| Drizzle setup | `src/lib/db/db.ts` | Reuse |
| Transaction hooks | `transactionWithHooks` / `onCommit` | Reuse where appropriate |
| Redis | `src/lib/redis.ts` | Reuse connection pattern |
| Permissions | `src/lib/permissions/*` | Reuse concepts; centralize verified org context |
| Zod validation | existing middleware/routes | Reuse conventions |
| Bruno collection | `backend/bruno-collection/` | Reuse collection pattern for local API testing |

### Do NOT Copy

- Kamailio / FreeSWITCH / VoIP Innovations architecture
- Socket.IO as the primary voice transport
- AWS Transcribe post-call voice pipeline
- CRM/e-commerce modules such as orders, products, campaigns, gateways and fulfillments
- the current long-lived 7-day access-token-only lifecycle
- ad-hoc organization selection without centralized membership verification
- API keys in query strings for new internal AI services
- inconsistent legacy response envelopes
- existing chatbot code as the new Voice Agent Engine

Our realtime media layer is **LiveKit**.

### Reference-vs-Target Rule

Before creating backend infrastructure, inspect `D:\conexus\ConexusCRM-BE`. Reuse/adapt proven logging, errors, async handling, JWT primitives, Drizzle, Redis, transactions, validation and permission patterns rather than inventing duplicates.

When the reference conflicts with these architecture docs, **these docs define target behavior**; Conexus defines implementation style.

### Deliberate Target Differences

**Authentication:** reuse JWT primitives, but implement short-lived access tokens plus refresh/rotation/logout.

**Organization context:** centrally verify active organization membership and attach trusted organization context. Never trust a client-supplied `organizationId` by itself.

**API contract:** normalize new endpoints to `{ success: true, data }` or `{ success: false, error: { code, message } }`.

**LiveKit:** add a dedicated LiveKit component using `livekit-server-sdk` for short-lived room tokens. Never expose the LiveKit API secret to the browser.

**Appointment concurrency:** PostgreSQL is the final integrity boundary. Prefer DB constraints + transactions/row locking. Redis locks may supplement this when justified, but must not be the sole booking-integrity mechanism.


## 1. Responsibilities

The backend is the authoritative business/API layer.

It owns:
- authentication
- users
- organizations
- agents
- business configuration
- tools
- clinic/business data
- appointments/bookings
- calls
- conversations
- analytics queries
- LiveKit token generation
- authorization
- tenant isolation

It does NOT own realtime audio transport.

LiveKit owns realtime media.

## 2. Folder Structure

```text
backend/

├── src/
│   ├── agent/              # LiveKit worker and provider/transport adapters
│   ├── components/
│   │   ├── agent/          # engine, tools, interruption, isolated demo
│   │   ├── auth/
│   │   ├── organizations/
│   │   ├── clinic/         # adopted domain; internal services only
│   │   ├── health/
│   │   └── livekit/
│   ├── middlewares/       # auth.ts, organization.ts, index.ts
│   │
│   ├── lib/
│   │   ├── db/            # shared Drizzle models/client/transaction hooks
│   │   ├── redis.ts
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   └── async-handler.ts
│   │
│   ├── app.ts
│   ├── index.ts
│   └── types.ts
│
├── test/
├── drizzle/
│   └── migrations/
│
├── drizzle.config.ts
├── package.json
├── .env
└── bruno-collection/
```

This is the implemented layout. Persistent agents, calls, conversations, analytics and clinic HTTP controllers remain later work; the initial API groups below are a roadmap, not an assertion that all routes exist.

## 3. Service Pattern

### Phase 16 — Local clinic service adoption

`backend/src/components/clinic/` owns the adapted appointment domain. It is copied/adapted from the existing WhatsApp appointment platform and uses this repository's independent PostgreSQL database. There are no cross-repository imports, shared clinic records or internal API calls to the original application. Full source mapping, dependency classifications and SHA-256 provenance are in `CLINIC_SERVICE_ADOPTION.md`.

```text
backend/src/components/clinic/
├── index.ts                    # typed, validated server service facade
├── contracts/                  # trusted identity, Zod inputs/results, safe errors
├── models/                     # adopted contacts, doctors, slots, blocked dates,
│                               # appointments, clinic settings and enum subset
├── services/                   # one operation per source-derived service
│   └── runtime.ts              # injected dependencies and scope/clock/lock helpers
├── notifications/              # reminder/alert scheduling ports and test recorder
└── timezone.ts                 # adopted Intl conversion and civil-day helpers
```

Clinic models are exported through `src/lib/db/models/index.ts`; Drizzle generates migrations in the existing `backend/drizzle/migrations/` history. Auth `users` and `organizations` are retained. Source clinic `users` become `clinic_people`, avoiding a second patient/login identity implementation. Concrete capacity-based slots replace the earlier provisional recurring-schedule outline.

The facade binds readonly, server-owned organization/source/call/patient context separately from strict operation arguments. It checks organization status/type/timezone from the database, tenant ownership and related-record relationships. The factory itself does not authenticate a browser or caller; future adapters must verify organization/staff permissions and patient ownership before binding context. It exposes no HTTP route or model tool.

Booking preserves the original PostgreSQL transaction, doctor/day advisory lock, slot row lock, capacity count and doctor/day token allocation. Appointment date/time come from the selected slot. The same doctor/day lock protects cancellation, date blocking/unblocking and generation. Blocking/cancellation repairs are limited to atomicity, tenant scope and retaining blocked/cancelled slot states; the original WhatsApp conversation ladder is untouched.

`src/lib/db/transaction-with-hooks.ts` extracts the existing `transactionWithHooks` implementation for injection into isolated database tests; `db.ts` retains its existing exported helper. Post-commit notification scheduling uses injected adapters. Missing delivery configuration is explicit, and a scheduler failure cannot report a committed booking as failed. No queue library or delivery worker is introduced. Actual durable scheduling, delivery-time status/settings checks and business request idempotency remain future work.

Winston events contain operation/organization identifiers, notification appointment identifiers, duration and stable error codes. Clinic services omit names, phone numbers, ages, complaints, query/provider payloads and exception stacks from logs.

Why the architecture docs changed: the earlier clinic schema was a provisional design. Inspection established a proven, different model with clinic contact roles, concrete capacity-based slots and per-doctor/day tokens. These sections now describe the approved implementation and its independent data ownership, rather than implying another booking system should be created.

One service = one business operation.

Examples:
- `create-agent.ts`
- `update-agent.ts`
- `get-agent.ts`
- `book-appointment.ts`
- `cancel-appointment.ts`

Controllers should be thin.

```text
Route
 -> Middleware
 -> Controller
 -> Service
 -> Repository/Drizzle
 -> Response
```

## 4. Database Rule

Use Drizzle ORM.

No raw SQL unless a documented query genuinely cannot be expressed safely through the ORM.

All schema changes require migrations.

## 5. Tenant Isolation

Every organization-owned query must include organization scope.

Example concept:

```text
authenticated user
 -> organization membership
 -> organization ID
 -> service
 -> query scoped by organization ID
```

Never trust an organization ID from the client by itself.

## 6. API Route Prefix

All API routes:

`/api/v1/`

## 7. Initial API Groups

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/me
GET    /api/v1/organizations
GET    /api/v1/organizations/:id

GET    /api/v1/agents
POST   /api/v1/agents
GET    /api/v1/agents/:id
PATCH  /api/v1/agents/:id
DELETE /api/v1/agents/:id

GET    /api/v1/agents/:id/tools
PATCH  /api/v1/agents/:id/tools

POST   /api/v1/livekit/token

GET    /api/v1/calls
GET    /api/v1/calls/:id

GET    /api/v1/conversations
GET    /api/v1/conversations/:id

GET    /api/v1/doctors
POST   /api/v1/doctors
PATCH  /api/v1/doctors/:id

GET    /api/v1/appointments
POST   /api/v1/appointments
PATCH  /api/v1/appointments/:id
DELETE /api/v1/appointments/:id

GET    /api/v1/analytics/overview
```

The exact API is finalized in `DATA_MODEL_AND_API_CONTRACT.md` before implementation of dependent phases.

## 8. Authentication

For web dashboard:
- short-lived access credential
- refresh mechanism
- secure browser transport
- server-side authorization

For machine/service communication:
- service credentials
- never expose internal AI service secrets to browsers

## 9. LiveKit Token Endpoint

The browser never receives the LiveKit API secret.

Correct:

```text
Dashboard
 -> POST /api/v1/livekit/token
 -> backend validates user/org/agent access
 -> backend creates LiveKit access token
 -> browser receives short-lived token
 -> browser connects to LiveKit
```

## 10. Redis

Use Redis for:
- active agent session state
- temporary conversation state
- short-lived locks
- rate limiting where needed
- idempotency keys where useful

Do not use Redis as the permanent source of truth.

### Phase 14 Active Agent Sessions

The reusable engine is `backend/src/components/agent/engine/`. It owns validated configuration, conversational state, prompt construction, response policy and lifecycle. It receives providers, typed business behavior, a session store and a logger by injection; it imports no LiveKit, environment configuration, database services or clinic implementation.

`backend/src/components/agent/session-store.ts` adapts the existing Redis client. Active snapshots use `agent-session:<encoded organizationId>:<encoded sessionId>`, with a sliding 30-minute TTL. Writes are serialized per session and close waits for pending writes before deleting the key. A storage failure closes the affected session and attempts cleanup; TTL bounds retention if Redis remains unavailable. The in-memory store is for offline tests.

`backend/src/agent/` owns LiveKit resources and session disposal. Organization context comes from validated token-service-issued participant metadata. Engine state does not authorize database operations; subsequent tools must enforce the trusted tenant context. No API endpoints or database schema were added in Phase 14.

### Phase 15 Typed Tool Boundary

`backend/src/components/agent/tools/` contains `types.ts`, `registry.ts`, `executor.ts`, `sdk.ts`, `server-time.ts` and `logger.ts`. This extends the existing component boundary and keeps `@openai/agents` as the orchestrator. `AgentSession` accepts an optional injected registry/runtime and `enabledTools` configuration; the live clinic worker continues with no enabled tools.

The SDK `Runner` owns up to five model turns. Groq and Hugging Face share an OpenAI-compatible wire adapter that advertises enabled function schemas, reconstructs fragmented streaming calls, preserves invocation IDs and sends correlated tool-result messages. The adapter executes no actions. The executor checks server-owned organization/agent/session/call/conversation/turn context, validates strict arguments and outputs, and serializes handlers with four attempts and five seconds per invocation by default.

Only `get_server_time` is implemented. `npm run smoke:tools` in `backend/` exercises the actual SDK loop with a deterministic offline provider and Winston events. `npm run test:tools` covers the execution boundary and mocked vendor HTTP responses. Neither command makes paid/cloud calls. No endpoint or Bruno changes were needed.

Tool results are retained in the existing active snapshots, with the same serialized writes, TTL and cleanup. They are not permanent audit records. Interruption/supersession prevents late commits and excludes interrupted pairs from replay. Per-run invocation caching prevents duplicate handler execution for matching IDs; it is not durable business idempotency. Future booking tools must use trusted services with tenant access checks and transactions; PostgreSQL clients and SQL remain outside providers and the reusable engine.

Winston tool events include identifiers, tool name, duration and error code only. SDK tracing and model/tool payload logging are disabled. Exceptions are mapped to safe error envelopes, and empty-output recovery cannot restart a tool sequence that has already been attempted.

### Phase 17 clinic voice integration (current)

Clinic tools now live in `components/clinic/voice/`. They call the adopted service facade; models/providers and the reusable engine still have no SQL/client/service imports. The earlier Phase 15/16 descriptions above record their original milestone boundaries. Current contracts, code map and frontend setup are in `CLINIC_VOICE_TOOLS.md`.

`components/agent/profiles.ts` loads strict server-owned organization/agent profiles from `VOICE_AGENT_PROFILES_PATH`. Effective tools are the selected module's registered tools intersected with organization capability and the agent allowlist. Defaults have no tools; explicit unknown agents fail with 403. A clinic profile cannot serve a hotel organization. Saved configuration remains Phase 18.

The existing authenticated token endpoint stores server-generated organization/user/agent/session/call/conversation/room/participant context and the resolved profile in Redis for 15 minutes. JWT participant metadata contains only its one-use reference. The worker consumes and validates that binding, selects the business adapter in `src/agent/create-session.ts`, and closes sessions through its existing lifecycle. Each token receives a unique organization-scoped room; a caller-supplied room name is only a label. This deliberately replaces the earlier multi-tab shared-room test semantics to keep patient calls private. Response fields are unchanged, and Bruno/token regressions cover the changed contract.

Patients have no login. Phone collection/readback creates or reuses a scoped contact through the existing service. Access to older appointments additionally checks token/date (and doctor on ambiguity), limits failures to three per session and grants only matching appointment IDs. A corrected phone invalidates drafts/grants. This is a basic knowledge check, not strong authentication or cross-session rate limiting.

Booking/cancellation use server-owned prepare/readback/confirm drafts, requiring a later affirmative caller utterance. All mutations are serialized across a session's turns. `clinic_appointments` gains nullable request key/fingerprint fields and an organization/request unique constraint through additive migration `0002_classy_madame_web.sql`. Request-key locking precedes the original doctor/day and slot locks. Matching retries reuse the appointment; conflicting details fail; original callers without keys retain their behavior. No new appointment table or alternate booking service exists.

The locked slot must still match the server-owned readback date/time/timezone expectation. Contention/changes refresh alternatives through existing services without auto-booking. Cancellation or timeout cannot undo a commit; request identity and the active adapter retain/reconcile the effect before replay. Active sessions remain non-resumable after process loss. Fresh confirmed requests are distinct intents.

Scheduling remains the injected post-commit port; live delivery is unconfigured. Database request replays return `not_repeated` scheduling outcomes, never claim original delivery status and never reschedule. SDK invocation caching and durable booking idempotency solve different problems. Operational Winston logs omit tool arguments/results/transcripts and patient details; IndicF5/Raya text/phrase previews and raw TTS provider-error logging were removed before enabling patient readbacks. Failed or empty audio delivery invalidates pending readback confirmation.

## 11. Logging

Use structured logging.

Log:
- request IDs
- organization ID
- user ID where appropriate
- call ID
- agent ID
- tool name
- tool success/failure
- booking result
- external service errors

Never log:
- passwords
- refresh secrets
- API keys
- full sensitive patient information unnecessarily

## 12. Transactions

Use DB transactions for operations such as:
- appointment booking
- cancellation
- rescheduling
- organization membership changes

Booking must prevent two simultaneous callers from receiving the same slot.

## 13. Environment Variables

```env
NODE_ENV=development
PORT=4000

DATABASE_URL=postgresql://...
REDIS_URL=redis://...

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...

LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

AGENT_SERVICE_URL=http://agent:8080
STT_SERVICE_URL=http://stt:8000
TTS_SERVICE_URL=http://tts:8001
```

Never commit secrets.

## 14. Error Contract

Use a consistent shape:

```json
{
  "success": false,
  "error": {
    "code": "APPOINTMENT_SLOT_UNAVAILABLE",
    "message": "The selected slot is no longer available."
  }
}
```

Success:

```json
{
  "success": true,
  "data": {}
}
```

## 15. Backend Rules

- TypeScript strict mode.
- No `any` unless explicitly justified.
- Validate all external input.
- Controllers remain thin.
- Business logic belongs in services.
- No database access from controllers.
- No LLM direct database access.
- Every organization-scoped operation is authorized.
- Every important asynchronous route uses the standard async error wrapper.
