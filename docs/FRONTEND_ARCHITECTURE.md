# Assamese AI Voice Agent Platform — Frontend Architecture

## Phase 17 listening readiness (2026-10-17)

The sandbox distinguishes room/microphone connection from agent audio-pipeline readiness. `use-livekit-room.ts` accepts `voice_status.category: listening_ready` from an agent participant and exposes `isAgentListening`; the UI shows “Preparing the agent — please wait” until ready. The worker sends the reliable event only to its caller after first VAD inference and first recognizer audio submission. This is a local readiness signal, not a remote recognition guarantee. Disconnect/agent departure clears readiness; an accepted agent transcript also establishes it. Existing recognition-failure status remains distinct. The change addresses callers speaking while the worker is still attaching, without changing token or HTTP contracts.

## Phase 17 context/provider feedback (2026-10-17)

The existing voice sandbox accepts optional safe `failureCategory` and `providerTtftMs` fields. It distinguishes an oversized request, rate limit, configuration/authentication or response-processing failure from unclear caller speech. Prepared readbacks, verified tool replies and generic recovery omit provider TTFT when no provider token arrived. Existing doctor/tool/outcome badges and transcript display stay compatible. These are diagnostic display changes using the current DataChannel; no dashboard configuration, raw API call, endpoint or patient login was added. Five offline frontend diagnostic tests pass; live microphone acceptance is separate.

## Phase 17 voice recovery feedback (2026-10-16)

The existing sandbox now validates optional listening-mode, confirmation-stage and recovery-category diagnostics through the shared Zod helpers. It displays waiting-for-confirmation, speech-unclear, recognition recovery and audio/provider failure statuses. Assistant-only recovery turns do not show a fabricated You (STT) message. Tool badges, selected-doctor display and existing transcript fields remain compatible.

This adds local UI state and optional DataChannel fields only; no API calls, dashboard controls or patient-login flow. Diagnostics have four offline checks; live browser microphone acceptance remains separate.


## Phase 17 doctor-result diagnostics (2026-10-16)

The sandbox now displays optional business outcome/count and reply provenance from the existing agent DataChannel. A successful lookup with zero matches shows `not found · 0 results`, rather than implying a doctor was found. `Verified reply` identifies a server-rendered business response; `Recovery` identifies generic generation recovery. Empty-output help no longer falsely asserts a retry after tool execution. A selected doctor appears immediately, with the approved English name as secondary information when the primary name is Assamese.

Validation and display helpers live in `src/lib/voice-diagnostics.ts`, used by the LiveKit hook/sandbox and covered by three offline tests (`npm run test:voice-diagnostics`). The tests use the already-installed backend `tsx` runtime; no frontend dependency was added. Existing legacy optional diagnostics remain compatible. No new API calls, configuration dashboard, patient login or audio transport behavior was added.

**App:** `apps/dashboard/`

**Framework:** Next.js App Router + React + TypeScript

## 1. Frontend Responsibilities

The dashboard is the control plane for business users.

It manages:
- authentication
- organization context
- agents
- agent configuration
- business settings
- tools
- doctors/staff
- appointments
- calls
- conversations/transcripts
- analytics
- phone/SIP configuration
- human handoff settings

The dashboard does NOT run STT, TTS or the LLM itself.

The dashboard talks to the API and, only where needed, connects to LiveKit for realtime voice testing/monitoring.

## 2. Application Flow

```text
Browser
  |
  +--> Next.js UI
  |
  +--> API Client
  |       |
  |       +--> Node/Express API
  |
  +--> LiveKit Client (voice pages only)
          |
          +--> LiveKit Server
```

## 3. Route Structure

Recommended:

```text
app/
├── (public)/
│   ├── login/
│   │   └── page.tsx
│   └── page.tsx
│
├── (dashboard)/
│   ├── layout.tsx
│   ├── page.tsx                         # Overview
│   ├── calls/
│   │   ├── page.tsx
│   │   └── [callId]/
│   │       └── page.tsx
│   ├── conversations/
│   │   ├── page.tsx
│   │   └── [conversationId]/
│   │       └── page.tsx
│   ├── agents/
│   │   ├── page.tsx
│   │   ├── new/
│   │   └── [agentId]/
│   │       ├── page.tsx
│   │       ├── configuration/
│   │       ├── tools/
│   │       └── testing/
│   ├── organization/
│   │   ├── page.tsx
│   │   └── members/
│   ├── clinic/
│   │   ├── doctors/
│   │   ├── schedules/
│   │   └── appointments/
│   ├── phone/
│   │   └── page.tsx
│   ├── analytics/
│   │   └── page.tsx
│   └── settings/
│       └── page.tsx
│
└── layout.tsx
```

The exact business-specific routes may evolve. Keep the navigation configuration centralized.

## 4. Folder Structure

```text
apps/dashboard/

├── src/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (dashboard)/
│   │   ├── api/                  # Only if Next.js BFF routes are explicitly needed
│   │   ├── globals.css
│   │   └── layout.tsx
│   │
│   ├── components/
│   │   ├── ui/                   # shadcn primitives
│   │   ├── layout/
│   │   ├── navigation/
│   │   ├── agents/
│   │   ├── calls/
│   │   ├── conversations/
│   │   ├── appointments/
│   │   ├── doctors/
│   │   └── analytics/
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── agents/
│   │   ├── calls/
│   │   ├── conversations/
│   │   ├── appointments/
│   │   ├── doctors/
│   │   └── organization/
│   │
│   ├── services/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── auth.ts
│   │   │   ├── agents.ts
│   │   │   ├── calls.ts
│   │   │   ├── conversations.ts
│   │   │   ├── appointments.ts
│   │   │   └── organization.ts
│   │   ├── livekit/
│   │   │   ├── client.ts
│   │   │   ├── room.ts
│   │   │   └── permissions.ts
│   │   └── auth/
│   │       ├── session.ts
│   │       └── token-storage.ts
│   │
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   ├── use-agent.ts
│   │   ├── use-calls.ts
│   │   └── use-livekit.ts
│   │
│   ├── lib/
│   │   ├── query-client.ts
│   │   ├── env.ts
│   │   ├── utils.ts
│   │   └── permissions.ts
│   │
│   ├── schemas/
│   │   ├── auth.ts
│   │   ├── agent.ts
│   │   ├── doctor.ts
│   │   └── appointment.ts
│   │
│   ├── types/
│   │   ├── api.ts
│   │   ├── agent.ts
│   │   ├── call.ts
│   │   └── organization.ts
│   │
│   └── config/
│       ├── navigation.ts
│       └── constants.ts
│
├── public/
├── package.json
└── next.config.ts
```

## 5. Component Rules

### Page
Responsible for:
- route-level composition
- loading/error boundaries
- server-side layout decisions

### Feature
Responsible for:
- domain-specific UI
- domain hooks
- domain schemas
- domain-specific presentation logic

### Service
Responsible for:
- HTTP API calls
- LiveKit operations
- authentication/session operations

### UI component
Responsible only for presentation and reusable interactions.

A screen must not contain raw `fetch()` calls.

## 6. API Data Flow

Correct:

```text
Page
 -> Feature component
 -> native fetch + lightweight request hooks hook
 -> API service
 -> Express API
 -> response validation
 -> UI
```

Incorrect:

```text
Page
 -> fetch(...)
 -> manually manage loading/cache/error everywhere
```

## 7. Server State vs Client State

### Server state — native fetch + lightweight request hooks
Use for:
- agents
- calls
- conversations
- appointments
- doctors
- organization
- analytics

### Client state
Use React state first.

Use Zustand only when state is:
- shared by unrelated client components
- temporary
- UI-specific

Do not duplicate server data in Zustand.

## 8. Forms

All important forms:

```text
React Hook Form
    +
Zod schema
    |
submit
    |
API service
```

Validate on the client for UX, but the backend remains authoritative.

## 9. Authentication

Recommended web pattern:
- backend owns authentication
- short-lived access token
- refresh mechanism
- secure HTTP-only cookie/session transport for browser authentication where deployment architecture allows it
- never store long-lived secrets in localStorage

The exact auth transport must match the final API deployment topology and be documented before implementation.

## 10. Organization Context

The dashboard must always know the active organization.

Every organization-scoped request must be authorized by the backend.

Do not treat a route parameter such as `/organizations/:id` as proof of access.

## 11. Voice Testing Page

The agent testing screen is special.

```text
Open Testing Page
      |
Request LiveKit token from API
      |
Connect `livekit-client`
      |
Publish microphone
      |
Agent joins room
      |
User speaks
      |
Agent responds
```

UI should show:
- connection status
- microphone status
- agent status
- current transcript
- latency indicators
- tool activity
- call/session duration
- disconnect button

### Phase 17 implemented sandbox changes

The actual application uses `frontend/src/`. `/agents/default/testing` can exercise a server-configured default clinic profile. `VoiceSandbox` uses the existing authenticated organization-membership store for a test organization selector, disabled during connection/calls. It adds no raw API calls or agent-configuration dashboard; selected organization headers still undergo server membership authorization.

The token response shape remains compatible. Room labels now resolve to separate organization-scoped caller rooms, so two tabs represent independent calls rather than shared audio loopback. The testing page's instructions were updated accordingly. Patients speaking into the microphone do not need accounts; the test operator retains the existing staff login.

The existing transcript DataChannel adds optional validated `tools` summaries: tool name, success flag, safe error code and optional domain outcome (`confirmation_required`, `booked`, `unavailable`, `cancelled`). Badges distinguish prepared requests/unavailable results from a completed booking. Raw tool arguments/results are not published as tool activity. Existing slots, transcripts, TTFT, interruption and audio diagnostics remain compatible.

Guarded setup, prerequisites, exact frontend steps and pending live acceptance are in `CLINIC_VOICE_TOOLS.md`. Saved tools/agent configuration remains Phase 18. Microphone and cloud-provider quality are not proven by deterministic SDK tests.

## 12. Calls and Conversations

Calls list:
- date/time
- caller
- duration
- status
- agent
- outcome
- transfer status

Call detail:
- call metadata
- transcript
- tool calls
- timestamps
- errors
- appointment/result
- recording status if recording is enabled later

Do not expose sensitive internal infrastructure details to ordinary business users.

## 13. Accessibility and UX

All dashboard forms and interactive components must:
- support keyboard navigation
- have visible focus states
- have labels
- handle loading/empty/error states
- avoid destructive actions without confirmation
- provide clear success/error feedback

## 14. Frontend Performance Rules

- Prefer Server Components where no browser interactivity is required.
- Use Client Components only when necessary.
- Do not make the entire dashboard a Client Component.
- Paginate large lists.
- Do not fetch the same server data independently from many components.
- Lazy-load heavy voice/analytics components when useful.
- Do not load LiveKit client code on pages that do not need realtime voice.

## 15. Frontend Completion Checklist

A frontend phase is complete only when:
1. route works
2. loading state exists
3. empty state exists
4. error state exists
5. validation exists
6. API errors are mapped to user-friendly messages
7. mobile/tablet/desktop layout is reasonable
8. no raw API calls exist in components
9. TypeScript passes
10. lint/build passes
11. `docs/PROGRESS.md` is updated


## State Management Rule

Do not introduce TanStack Query.

Keep frontend state simple:

```text
Component-local state
    ↓
useState/useReducer

Shared UI/session state
    ↓
Zustand

Server/API communication
    ↓
src/services/api/*
    ↓
native fetch
    ↓
small custom hooks for loading/error state
```

Do not put every API response into a global Zustand store.

Use Zustand for state that genuinely needs to be shared across routes/components, such as:
- authenticated user/session metadata
- selected organization
- active agent configuration
- dashboard UI preferences
- voice-test session state

Use local component state for one-screen state.

Keep API response caching minimal until real usage demonstrates a need for a dedicated cache library.
