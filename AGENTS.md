# AGENTS.md — Assamese AI Voice Agent Platform Development Rules

You are building a production-grade multi-tenant AI voice-agent platform.

Before changing code, understand the architecture.

## Core Documents

| Document | Read when |
|---|---|
| `docs/PRODUCT_OVERVIEW.md` | Understanding the product or making architecture decisions |
| `docs/TECH_STACK.md` | Adding/changing libraries or SDKs |
| `docs/BACKEND_ARCHITECTURE.md` | Backend/API/DB work |
| `docs/FRONTEND_ARCHITECTURE.md` | Dashboard/frontend work |
| `docs/VOICE_AI_ARCHITECTURE.md` | LiveKit/VAD/STT/LLM/TTS/agent work |
| `docs/DATA_MODEL_AND_API_CONTRACT.md` | DB/API/tool work |
| `docs/PHASES.md` | Implementing a phase |
| `docs/PROGRESS.md` | Before every task |
| `docs/PROMPTS.md` | When starting a phase with an AI coding agent |

## Mandatory Workflow

Before implementation:

```text
Read AGENTS.md
   ↓
Read PROGRESS.md
   ↓
Read current phase in PHASES.md
   ↓
Read all listed dependency docs
   ↓
Inspect existing code
   ↓
Plan
   ↓
Implement
   ↓
Test
   ↓
Update PROGRESS.md
```

## General Rules

- Never guess architecture.
- Never invent APIs.
- Never duplicate existing utilities.
- Search the repository before creating a new abstraction.
- TypeScript strict mode.
- Avoid `any`.
- No `@ts-ignore` unless explicitly justified and documented.
- Do not silently change architecture.
- Do not skip phases.
- Do not refactor unrelated code during a phase.
- Do not run any git commands (git add, commit, push, status, branch, etc.). The user manages all git operations directly.
- Keep commits/changes focused.

## Reference Backend Rules

Production reference backend: `D:\conexus\ConexusCRM-BE`.

Before creating/replacing backend infrastructure, inspect its equivalent implementation. Prefer its proven Express setup, `Route[]` registry where suitable, thin controllers, one-operation services, `asyncHandler`, errors, logger, env validation, Drizzle, transaction hooks, Redis, permissions and JWT signing/verification primitives.

Do **not** blindly copy its CRM/e-commerce modules, FreeSWITCH/Kamailio/VoIP Innovations stack, Socket.IO voice transport, AWS Transcribe pipeline, 7-day access-token-only lifecycle, ad-hoc organization selection, or inconsistent response envelopes.

When Conexus and these docs differ, these docs define target behavior. Conexus defines implementation style.

## Backend Rules

- Controllers are thin.
- Business logic belongs in services.
- Use Zod for external input.
- Use Drizzle for PostgreSQL.
- Organization-scoped queries must enforce tenant access.
- Never allow the LLM to access the DB directly.
- Use typed tools for AI actions.
- Booking operations must be transactional.
- Use structured logging.
- Never log secrets or unnecessary sensitive user data.

## Frontend Rules

- Screens/pages do not make raw API calls.
- API calls go through `src/services/api`.
- Use native fetch through centralized API service modules and small custom request hooks for server/API data.
- Use React state before Zustand.
- Forms use React Hook Form + Zod.
- LiveKit is loaded only where realtime voice is needed.
- Reuse shadcn components.
- Every important page has loading, empty and error states.
- Do not duplicate API data in client state.

## Voice/AI Rules

- LiveKit owns realtime transport.
- Agent Engine owns business logic.
- STT/TTS are replaceable providers.
- LLM cannot invent business facts.
- Availability and booking facts must come from tools.
- Tool arguments must be validated.
- Never claim a booking succeeded unless the booking tool confirms it.
- Barge-in must be supported before production phone deployment.

## Infrastructure Rules

- Local development must remain ₹0.
- Use Docker Compose locally.
- Do not introduce Kubernetes prematurely.
- Do not introduce n8n.
- Production telephony is separate from local development.

## Documentation Rules

If architecture changes:
1. update the relevant architecture document
2. update `PHASES.md` if phase dependencies changed
3. update `PROGRESS.md`
4. record why the change was made

## Definition of Done

A phase is done only when:
1. implementation exists
2. happy path works
3. important failure paths are handled
4. tests/checks pass
5. build/typecheck passes where applicable
6. logs exist for important operations
7. documentation is updated
8. `PROGRESS.md` is updated

Never mark a phase complete because files merely exist.


## AI Provider Rules

### STT
- Use Deepgram Nova-3 for Assamese STT only after the project's benchmark passes.
- Do not create a Python STT service if Deepgram passes.
- Do not remove the benchmark requirement merely because Deepgram lists Assamese support.

### TTS
- Do not use Deepgram TTS for Assamese.
- Continue using AI4Bharat IndicF5 unless a future Assamese-capable TTS provider is benchmarked and approved.
- Therefore Python remains required for TTS in the current architecture.

### Agent SDK
- Use `@openai/agents` as the primary agent orchestration/tool-calling SDK.
- Do not create a second custom agent framework.
- Keep model/provider selection behind an adapter so Hugging Face Inference Providers can be used initially and self-hosted vLLM inference can be introduced later.
- Vercel AI SDK is optional as a model/provider adapter, not the primary agent runtime.
- Claude SDK is a future provider option, not the default architecture.

## Frontend State Rules

- Do NOT install TanStack Query.
- Use native `fetch` through centralized API services.
- Use Zustand only for genuine shared client state.
- Use local React state for local UI state.
- Do not turn Zustand into a global database/cache for every API response.

## Logging and API Contract Rules

- Use Winston.
- Reuse/adapt the reference project's Winston logger configuration.
- Reuse/adapt the reference project's common error classes and `errorHandler`.
- Inspect the actual reference source for its common response helper/class before creating a new one.
- New endpoints must use the project's standard `{ success, data }` / `{ success, error }` envelope.
- Never expose stack traces or provider secrets to clients.
