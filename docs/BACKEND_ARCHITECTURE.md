# Assamese AI Voice Agent Platform — Backend Architecture

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
apps/api/

├── src/
│   ├── common/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── organization.middleware.ts
│   │   │   └── validate.middleware.ts
│   │   ├── types/
│   │   └── constants/
│   │
│   ├── components/
│   │   ├── auth/
│   │   ├── organizations/
│   │   ├── agents/
│   │   ├── calls/
│   │   ├── conversations/
│   │   ├── doctors/
│   │   ├── appointments/
│   │   ├── tools/
│   │   ├── analytics/
│   │   └── livekit/
│   │
│   ├── lib/
│   │   ├── db/
│   │   ├── redis/
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   └── async-handler.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── drizzle/
│   └── migrations/
│
├── drizzle.config.ts
├── package.json
├── .env
└── bruno-collection/
```

## 3. Service Pattern

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
