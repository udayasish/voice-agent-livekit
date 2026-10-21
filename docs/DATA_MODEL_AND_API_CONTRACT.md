# Assamese AI Voice Agent Platform — Data Model & API Contract

## Phase 16 staff HTTP completion

The approved staff endpoints, role matrix, request/version/idempotency rules, token counters, migration and acceptance requirements are specified in [PHASE_16_BACKEND_ACCEPTANCE.md](PHASE_16_BACKEND_ACCEPTANCE.md). This supersedes historical statements below that no clinic HTTP API or rescheduling exists. Voice tool contracts remain compatible; date blocking now refuses booked appointments.

## Phase 17 server-retained phone resolution (2026-10-17)

The internal `resolve_clinic_and_caller` tool input is now a strict empty object `{}`, superseding its optional model-visible `phoneNumber`. Numbers are captured deterministically from caller speech, retained in session state and confirmed after completed readback; the resolver uses that state exclusively. Extra/null phone arguments remain rejected, not coerced. A server-planned enabled call performs caller binding after a valid confirmation. The output remains clinic details plus `callerResolved` and `phoneNeedsConfirmation`; no model-selectable patient identity is returned. Existing HTTP/service inputs are unchanged.

Verified model context now includes phone-captured/confirmed/caller-resolved booleans and the current next field, without adding phone digits to that context. Providers can declare a completion-token budget before request/context fitting. `incomplete_output` identifies nonempty text or structured output stopped by the completion limit; it cannot authorize an action and does not trigger tool replay. Active phone/draft storage, TTL, booking locks, durable request keys and notification contracts remain unchanged. No schema migration or HTTP/Bruno change.

## Phase 17 multilingual numeric interpretation (2026-10-17)

No database, HTTP, frontend or tool-input changes. The private interpreter input supports `expectedField: ampm` for a pending clock choice and an optional `numberHint: {value, quote, sourceTurn}`. The interpreter discards supplied hints and derives its own only from a recognized current whole age expression in 0–120. Hints are not persisted as new patient fields and do not grant identity/action authorization. Canonical age candidates retain their existing value/evidence/sourceTurn shape.

Age validation compares the whole recognized expression, including `twenty8`/`টুৱেণ্টি8`/`ट्वेंटी8`, with the proposed value. An isolated digit is not treated as the entire value when a known tens word precedes it. Decimals, contradictory numeric evidence and recognized disagreements remain invalid. Unsupported full-word proposals remain model-interpreted candidates requiring readback; no numeric lexicon proves universal understanding.

The local calendar planner distinguishes conflicting clock alternatives from AM/PM ambiguity. It may normalize known multilingual clock words into canonical ASCII times, but only availability-service records supply dates/slot IDs. Repeated identical hours are not additional selections. The clock interpretation changes no timezone, token allocation, slot capacity, confirmation, tenant permission or booking-idempotency contract.

## Phase 17 model name-reference contract (2026-10-17)

The tool-free clinic interpreter's private model-output `name` is now strict `{ quote: string, sourceTurn: positive integer } | null`, with a 200-character quote limit. A quote must occur verbatim in the current utterance or one of the existing bounded pending source turns. The server derives the canonical name by source slicing, whitespace trimming and removing terminal `?`, `？`, `!`, `।`; the resulting name remains 2–100 characters. It does not translate, respell, normalize initials or invent characters. Only provide-details/correct-details intents may supply a name. Extra fields, unknown source references and invented spellings are invalid.

Canonical active-session candidates remain `{value, evidence, sourceTurn}`; existing snapshots, TTL, injected normalized-interpreter contracts, clinic services and tool/HTTP inputs do not change. The optional private interpreter input `expectedField` comes from session workflow state, never model/browser authorization. Older pending evidence cannot replace a newer name or resolve a disputed name. Capturing a name does not confirm phone identity or authorize an action. No database migration, endpoint, frontend contract or Bruno change is introduced.

## Phase 17 unchanged-phone clarification semantics (2026-10-17)

No schema, migration, tool-input, HTTP or DataChannel contract changes. `phoneReadbackTurn`/`phoneReadbackCompleted` continue to identify the number readback, rather than every short question about that number. An unclear reply or speech-recovery event can ask a short correct-or-change question while retaining completed playback for the unchanged active candidate. This does not set `phoneConfirmed`. If the original readback was not completed, full playback is still required. Rejection, restoration and replacement continue to revoke eligibility and caller/action access as before. Booking/cancellation draft authorization is unchanged.

## Phase 17 readiness and safe intake diagnostics (2026-10-17)

No database or HTTP changes. The existing `voice_status` DataChannel envelope adds optional category `listening_ready`; worker delivery targets the relevant participant. It establishes local VAD/recognizer-reader readiness only and grants no action permission. The active-session state and TTL remain unchanged.

The existing booking tool's prepare mode may bind the already-confirmed phone through `getOrCreatePatient` when not yet bound, after validating actual patient details and returned slot selection. It still returns a draft, not a booked appointment; confirm is unchanged. Internal `interpretation_completed` diagnostics distinguish evidence/name/age/selection validation, schema/JSON/SDK and provider failures without exposing values. Exact known doctor names/aliases with Assamese possessive `ৰ` retain scoped lookup and ambiguity behavior.

## Phase 17 intake-state reliability (2026-10-17)

No database or HTTP contract changes. The clinic's private active-session `intake` state extends existing exact-evidence name/age candidates with `unresolvedName`, field `revision`, bounded `nonProgress`, and `lastQuestion` (field, turn, approved text). `unresolvedAge` and two bounded pending source utterances remain. These values use the existing session store/TTL, not new patient or appointment columns.

The clinic interpreter adds evidence-linked `disputedFields` and optional `choice` (`date`, `slotId`, current-utterance evidence). Null candidate fields preserve values; explicit disputes prevent use until a new current correction. Older pending evidence can fill a missing field but cannot resolve a disputed one. Choices must refer to returned options for the currently selected doctor/date. The next-field enum also supports doctor/date/time guidance. Candidate capture can occur before selecting a slot, but it does not confirm a patient identity, booking or cancellation. Existing action drafts, knowledge checks, service contracts and idempotency remain authoritative.

Valid-but-empty extraction is recorded as no progress rather than proof of capture. The existing optional response source remains `model`, `verified_tool` or `recovery`; no frontend schema change or Bruno request is required. Model view compaction retains candidates while reducing optional conversational material.

## Phase 17 offered-choice and selected-doctor contracts (2026-10-17)

Availability voice inputs are strict `{ doctorId?: UUID, offset?: number }` for dates and `{ doctorId?: UUID, date: ISODate, offset?: number }` for times. Omitted identity binds to the session's selected doctor; supplied conflicting identity returns `DOCTOR_SELECTION_MISMATCH` before a service query. No selection/known candidate returns `DOCTOR_SELECTION_REQUIRED`. These are internal tool-contract changes, not HTTP endpoints. Existing services still receive an explicit trusted/scoped doctor ID and apply all tenant/active/availability checks.

Clinic dialogue snapshots add `offeredDates` (the current three-date page), `dateOffset` and nullable `lastReadFailure: { toolName, code, turnId, date }`, where date is the attempted ISO date or null, not proof of availability. Date projections expose at most three entries plus full count and continuation; canonical results remain complete. Model tools are a stage-relevant subset of the agent's existing allowlist, never an expansion of permissions. Existing handlers still enforce prerequisites even if a model requests an inappropriate action.

Completed active-session action records include their execution turn for the caller privacy boundary. Model context gets only a small current-caller outcome summary and booking-state label; retained prior-caller records remain internal reconciliation data. Patient details, authorization records and full canonical results are not copied into this summary. No database schema/migration, new response endpoint or Bruno change is introduced.

## Phase 17 compact context and intake contracts (2026-10-17)

The complete active session, canonical tool envelopes, booking request identities and authorization records remain in the existing scoped Redis snapshot with its 30-minute TTL. Model context is a separately derived view: current utterance, up to four recent complete caller groups, selected validated facts and optional untrusted older notes. Notes have covered turn/source references; they are neither business facts nor action authorization. A caller change clears the earlier model-facing view. No table, migration, HTTP endpoint or Bruno change is introduced.

`ToolDefinition<Input, Output>` may declare a `projectOutput` and a Zod `modelOutputSchema` together. The executor validates/stores the canonical result first, records the projected JSON result by invocation ID, and replays that same compact result to the SDK. A failed projection does not invalidate a committed successful operation. Doctor/date/time read tools accept optional non-negative bounded `offset`; model pages contain at most five doctors/dates or eight times, total count and continuation information. Doctor ambiguity comes from all scoped service matches before paging. Existing tenant and action permissions are unchanged.

The clinic session also validates patient `name` and `age` candidates with source utterance/turn evidence, the next expected field and unresolved corrections. Name spelling is preserved; integer age is 0–120. Literal numeric evidence must agree with its proposed value. Spoken age words can remain an unconfirmed candidate until clarified. These candidates do not replace the separately confirmed phone, action readback or booking-service result. Selective structured intake interpretation has no tools and cannot book/cancel. A provider failure preserves accepted caller speech and captured state.

The worker's existing optional diagnostic message may now include `failureCategory` and `providerTtftMs`; neither is permission or patient data. A recovery/readback without a streamed provider token omits provider TTFT. Context byte counts and usage estimates are logged operationally, without message content. Provider HTTP 413, 429, authentication, network, timeout and protocol failures produce safe distinct categories rather than a false speech-recognition apology.

## Phase 17 confirmation and recovery additions (2026-10-16)

No database migration or HTTP contract changes. Existing clinic tables and eight business-tool contracts remain unchanged. No Bruno updates are required.

Internal clinic state adds bounded `phoneCandidates` (`id`, deterministic ten-digit `digits`), `activeCandidateId`, `previousCandidateId`, `phoneReadbackTurn`, `phoneReadbackCompleted`, `pendingAction` confirmation metadata and `completedActions`. Candidate/draft references are server-issued, scoped to one active session and are never browser authority. These private snapshots use the existing Redis lifetime and are not sent wholesale to the frontend or ordinary business-model context.

The clinic interpreter's strict result is `{ intent, targetId, evidence, replacementText }`; all fields are required, with nullable target/replacement. Evidence and replacement must be exact current-utterance excerpts. Unknown targets, invalid output and timeout are unclear. A decision is a proposed transition, not a tool result or a booking confirmation.

Optional neutral engine interfaces support asynchronous `onTurn` preparation with immutable history and AbortSignal, a prepared reply, `processRecovery(reason)`, `onRecovery`, `notifyPlaybackResult` and `onPlaybackResult`. Existing synchronous behaviors remain compatible. Recovery history has an assistant entry and no fabricated user entry.

The existing DataChannel accepts optional `inputMode: conversation | english-digits`, `confirmationStage: none | phone | action | confirmed`, `recoveryCategory: speech_unclear | no_transcript | no_input | provider_failure`. A separate `voice_status` event can report recognition recovery/conflict/failure, playback failure and listening-mode changes. These fields contain no candidate IDs or hidden appointment data and grant no permissions. Recovery turns use empty `userText`, which the sandbox hides rather than labeling as caller speech.


## Phase 17 bilingual reference-data additions (2026-10-16)

Migration `0003_chief_purple_man.sql` adds nullable `clinic_doctors.name_en`, nullable `name_as` (both varchar 255) and `search_aliases` (varchar 255 array, non-null/default empty). Contact names, doctor IDs and appointment FKs remain intact; patient names are not translated. Existing doctor list/match results retain legacy fields and add optional `nameEn`, `nameAs`, `searchAliases`; match results also include specialization. Lookup normalizes both legacy/reviewed names and aliases, preserving all matches and tenant scope. English spellings are operator-reviewed, not generated during calls. An internal transactional manifest importer binds organization plus doctor IDs, defaults to dry-run and returns a missing-English-name readiness report; it is not a tool or HTTP endpoint.

Clinic voice `list_doctors` now accepts strict `{ specialty?: string }` and returns `{ outcome, doctors, alternatives, resultCount }`; `find_doctor` retains strict `{ name }` and returns the same structured result. Read outcomes include `listed`, `matched`, `ambiguous`, `not_found`, `inactive`. Specialty filtering compares stored specializations; the clinic planner's small reviewed vocabulary recognizes the reported gastroenterology/cardiology requests without diagnosing symptoms. Zero matches may include actual active alternatives. A successful envelope means execution succeeded, not that a doctor was found. Date/time tools keep existing fields and add read outcome/count and derived calendar objects (`date`, English `weekday`, `labelEn`, `timezone`). Empty availability is `no_availability`. Booking/cancellation outcome contracts and service locking/idempotency remain unchanged.

The existing worker DataChannel adds optional `replySource: model | verified_tool | recovery`, `selectedDoctor` public metadata and per-tool `resultCount`; it extends outcome labels. Legacy optional diagnostic fields remain accepted. No HTTP endpoint, request/response shape, login or Bruno request changes are needed. Phase 16 API work remains outstanding.

## 1. Core Entities

```text
User
  |
OrganizationMembership
  |
Organization
  |
Agent
  |
BusinessConfig
  |
EnabledTools

Organization
  |
Doctors / Staff
  |
Schedules
  |
Appointments

Organization
  |
Calls
  |
Conversations
  |
Messages / ToolEvents
```

## 2. Initial Tables

### users
- id
- name
- email
- password_hash / auth reference
- status
- created_at
- updated_at

### organizations
- id
- name
- business_type
- status
- timezone
- created_at
- updated_at

### organization_members
- id
- organization_id
- user_id
- role
- created_at

### agents
- id
- organization_id
- name
- business_type
- status
- greeting
- system_prompt
- languages
- created_at
- updated_at

### agent_tools
- id
- agent_id
- tool_key
- enabled
- config_json

### business_configs
- id
- organization_id
- config_json
- created_at
- updated_at

### Implemented clinic tables — Phase 16 service adoption

These replace the earlier provisional doctors/schedules/patients/appointments outline. They are adapted from the existing WhatsApp appointment platform's actual Drizzle models and capacity-based booking services. The voice repository owns an independent database; it does not share or synchronize the original product's records. Provenance, complete module classification and original hashes are in `CLINIC_SERVICE_ADOPTION.md`.

| Table | Important fields and constraints |
|---|---|
| `clinic_people` | `id`, `organization_id`, `phone_number`, `role` (`patient`, `doctor`, `receptionist`), nullable `name`, `language_preference`; unique organization/phone. These are contacts, separate from login `users`. |
| `clinic_doctors` | `id`, `organization_id`, `person_id`, `specialization`, `consultation_duration_minutes` (default 15), `is_active`; one profile per clinic person. |
| `clinic_slots` | `id`, `organization_id`, `doctor_id`, `slot_date`, `day_of_week`, `start_time`, `end_time`, `status`, `max_patients` (default 30); unique doctor/date/start time. Concrete rows, not a second recurring-schedules table. |
| `clinic_blocked_dates` | `id`, `organization_id`, `doctor_id`, `blocked_date`, `reason`, `notes`; unique doctor/date. |
| `clinic_appointments` | `id`, `organization_id`, `doctor_id`, `patient_id` (clinic person), `slot_id`, `token_number`, `appointment_date`, `appointment_time`, `patient_name`, required `patient_age`, optional `complaint`, `status`, `cancel_reason`, `reminder_sent`, `source`, nullable `call_id`; unique doctor/date/token. Phase 17 adds nullable `request_key` / `request_fingerprint` and unique organization/request identity. |
| `clinic_settings` | `organization_id` primary key, `reminders_enabled`, `notifications_enabled` (both default true). Organization name, status and IANA timezone stay in `organizations`. |

Organization-scoped composite foreign keys prevent cross-clinic doctor/person, slot/doctor and appointment/patient/doctor/slot relationships. Capacity, consultation duration and tokens must be positive; age is 0–120 and a slot end must follow its start. The adopted source role model intentionally allows one phone contact per organization, not separate duplicate patient and staff identities.

Appointment statuses retain the source values: `booked`, `completed`, `cancelled`, `noshow`. Slot statuses are `available`, `booked` (capacity reached), `blocked`, `cancelled`. Multiple appointments may share a slot up to its capacity; a unique slot/appointment constraint would break the source behavior.

Source is server-owned `voice`, `whatsapp` or `manual` metadata. Supporting a source value does not enable its transport. `call_id` is an optional UUID correlation, with no calls table or foreign key yet. Patient names/ages are appointment snapshots; collecting them never invents a patient age or completes a booking by itself. Clinic tables reuse existing common ID/timestamp fields. Appointment date/time are clinic-local wall-clock values; responses include the clinic timezone and notification jobs use ISO UTC instants.

An absent clinic-settings row uses the source defaults until configured. Real reminder workers must recheck appointment status, `reminder_sent` and current settings at delivery time. This milestone contains scheduling contracts and a test recorder, not delivery workers.

### calls
- id
- organization_id
- agent_id
- direction
- caller_number
- started_at
- ended_at
- status
- outcome
- transfer_reason

### conversations
- id
- call_id
- organization_id
- language
- started_at
- ended_at

### messages
- id
- conversation_id
- role
- content
- timestamp

### tool_events
- id
- call_id
- tool_name
- arguments_json
- result_json
- status
- latency_ms
- created_at

## 3. IDs

Prefer UUIDs for public identifiers.

Never expose sequential internal database IDs when they create unnecessary enumeration risk.

## 4. Appointment Integrity

The booking operation must validate:
1. organization owns doctor
2. doctor is active
3. slot belongs to the organization and selected doctor
4. slot is in the future
5. slot is available, its date is not blocked, and booked appointment count is below `max_patients`
6. patient belongs to organization or is created
7. transaction completes successfully

Concurrency rules:
- PostgreSQL is the authoritative integrity boundary
- use a DB uniqueness/exclusion constraint where the schema permits it
- execute booking in a transaction
- preserve the source doctor/day `pg_advisory_xact_lock(hashtext(...))`, followed by slot `FOR UPDATE`
- allocate the next doctor/date token while holding that lock, including cancelled/completed records in the maximum
- derive date/time from the locked slot; model/caller arguments cannot override them
- booking, cancellation, generation and date blocking use the same doctor/day lock; blocking and unblocking are transactional
- Redis may coordinate distributed work but must not be the sole protection against double booking

Only then return:

```json
{
  "success": true,
  "data": {
    "appointmentId": "...",
    "status": "booked",
    "notifications": {
      "reminder": "unconfigured",
      "doctorAlert": "unconfigured"
    }
  }
}
```

### Internal clinic service contracts

`createClinicServices(identity, dependencies)` binds an immutable copy of trusted server context to injected Drizzle access, transaction hooks, Winston-compatible logging, clock and optional notification scheduler. `identity` contains organization ID, source, optional UUID call correlation and optional verified patient ID. This internal factory is not an authentication endpoint: future HTTP/voice adapters must authorize organization and patient access before binding it. A phone lookup alone does not prove ownership.

Every operation validates a strict Zod object and returns the standard success/error envelope. Successful data is validated against JSON-only output schemas. Inputs cannot supply organization, source, call context, an existing ORM user, or booking date/time.

| Operation | Operation input | Successful data |
|---|---|---|
| `listActiveDoctors` | `{}` | Doctor IDs, stored names and nullable specializations |
| `findDoctorsByName` | `{ namePart }` | All literal partial-name matches, including active flags; ambiguity is retained |
| `listAvailableDates` | `{ doctorId, maxDates? }` | Distinct clinic-local dates with future bookable capacity; default 7 dates |
| `listAvailableSlots` | `{ doctorId, date }` | Slot IDs/date/start/end/capacity/remaining capacity |
| `getOrCreatePatient` | `{ phoneNumber }` | Scoped patient ID, supplied digits and patient role |
| `createAppointmentFromBooking` | `{ doctorId, patientId, slotId, patientName, patientAge, complaint? }` | Appointment/doctor/patient/slot IDs, token, stored date/time, timezone, `booked` status and scheduling outcomes |
| `listUpcomingAppointmentsForPatient` | `{ patientId }` | Appointment/doctor IDs, stored doctor name, token, date/time/timezone |
| `cancelAppointment` | `{ appointmentId, reason }` | Appointment ID, `cancelled` status and `alreadyCancelled`; requires a bound verified patient ID |
| `generateSlots` | `{ doctorId, weekdays, startTime, endTime, durationMinutes, horizonDays, maxPatients? }` | Count of newly generated concrete rows; operator context only |
| `blockDoctorDate` | `{ doctorId, date, reason?, notes? }` | Blocked-date ID and affected slot/cancelled appointment counts; operator context only |
| `unblockDoctorDate` | `{ doctorId, blockedDateId }` | Date and reopened slot count; operator context only |

When a patient ID is bound, lookup/booking/list operations cannot select a different patient. Cancellation derives its slot from the appointment and never reopens blocked or cancelled slots. Unbound identities represent trusted internal operator/service callers; a future adapter must enforce staff permissions before using that access.

Phone input accepts 10–15 explicitly supplied digits with an optional leading `+`, which is removed to match the source storage convention. It never adds a country code or repairs digits; future channel adapters must establish a consistent canonical phone format. Dates must be real calendar dates. Generation uses clinic-local days, a 1–90 day horizon, positive duration/capacity and no trailing partial interval. Ambiguous/nonexistent DST appointment times require clarification instead of guessing.

Scheduling outcomes are `scheduled`, `disabled`, `skipped_window`, `unconfigured` or `failed`. A booking remains successful if scheduling fails after commit. There is no automatic booking retry, durable request idempotency, outbox or actual notification delivery in this milestone. Cross-turn retries must be addressed before live tools can perform business actions.

Safe clinic failures include `INVALID_CLINIC_INPUT`, `CLINIC_NOT_FOUND`, `CLINIC_UNAVAILABLE`, `INVALID_CLINIC_TIMEZONE`, `INVALID_CLINIC_TIME`, `DOCTOR_NOT_FOUND`, `DOCTOR_INACTIVE`, `PATIENT_NOT_FOUND`, `PATIENT_ROLE_CONFLICT`, `PATIENT_SCOPE_REQUIRED`, `CLINIC_ACCESS_DENIED`, `SLOT_UNAVAILABLE`, `APPOINTMENT_NOT_FOUND`, `APPOINTMENT_NOT_CANCELLABLE`, `DATE_ALREADY_BLOCKED`, `BLOCKED_DATE_NOT_FOUND` and `CLINIC_OPERATION_FAILED`. Unexpected exceptions expose no original message, stack or query parameters.

Phase 16 added no clinic HTTP endpoints or tools. Phase 17 now adds the internal voice tools below; Phase 16's HTTP/API and rescheduling acceptance remains outstanding.

## 5. Tool Contract

Every tool must define:

```ts
type ToolDefinition<Input, Output> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>; // strict object enforced by defineTool
  outputSchema: z.ZodType<Output>;
  execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
};
```

`ToolContext` must contain trusted server-side context such as:
- organizationId
- agentId
- sessionId
- callId
- conversationId
- turnId
- invocationId
- signal (AbortSignal)

The LLM must not supply trusted tenant identity.

Likewise, a browser-supplied `organizationId` is not trusted identity. Resolve and verify organization membership server-side before business services execute.

Phase 15 implements this contract in `backend/src/components/agent/tools/`. `defineTool` captures typed handlers, enforces a strict root object, rejects reserved context arguments, and freezes the generated model schema. `ToolRegistry` accepts validated definitions, rejects duplicate names, and advertises only the agent's `enabledTools` list (empty by default). Providers receive function schemas and model arguments; trusted identity is carried separately in SDK run context and checked against the bound executor.

`ToolExecutor` validates arguments before execution and successful data against the output schema and JSON serialization contract. It serializes invocations, allows four attempts per turn by default, and applies a five-second timeout. Matching invocation IDs and arguments reuse the result within a run; conflicting reuse is rejected. Handlers are never automatically retried. Timeout aborts the handler signal, discards late results and stops additional handlers in that run. Cancellation aborts the run without recovery speech.

`get_server_time` is the only supplied tool: input `{}`, injected clock, output `{ timestamp: <ISO UTC timestamp>, timezone: "UTC" }`. The offline harness generates ephemeral call/conversation IDs; these do not represent persisted records. No database tables, tool-event persistence or API endpoints were added. Future business tools must call tenant-enforcing services; the LLM, provider adapters and engine never receive PostgreSQL access.

Provider strict schema mode is advertised only for schemas that fit its closed-object/all-properties-required contract. Optional Zod fields use non-strict provider mode while the server still rejects unexpected root fields and validates every value. Successful output must remain JSON-serializable after Zod transformations.

### Phase 17 clinic tools and trusted identity

The eight enabled clinic tools and exact inputs/outcomes are documented in `CLINIC_VOICE_TOOLS.md`; implementation is under `components/clinic/voice/`. `resolveClinic({})` is a small added service facade operation over the existing clinic guard, returning stored name/timezone and the current clinic-local clock. Other tool queries and mutations reuse the existing services.

The service identity additionally accepts optional **server-owned** UUID `requestKey` and `slotExpectation: { date, startTime, timezone }`. Neither is an operation/model argument. The existing booking transaction checks the expected slot under locking and rejects changed date/time/timezone. Matching request key/fingerprint returns the stored appointment; conflicting input returns `BOOKING_REQUEST_CONFLICT`. SHA-256 fingerprints cover doctor/patient/slot/name/age/complaint; request keys are generated per confirmed server draft, not taken from SDK invocation IDs or caller arguments.

Successful booking tool data discriminates `outcome: confirmation_required | booked | unavailable`. A draft carries its opaque `draftId`; only `booked` carries a confirmed service appointment/token. `unavailable` carries freshly queried dates/times/timezone and never causes automatic booking. Cancellation discriminates a draft from `cancelled`. Generic tool errors retain the standard safe envelope.

Patients need no account. Confirmed spoken phone binds a contact for booking; it does not authenticate the person. Older appointment access requires token/date knowledge and optional doctor disambiguation; internal results are filtered before model exposure. Three failed checks lock further proof attempts for that session. Cancellation accepts only server-granted appointment IDs plus a separately confirmed draft. A phone correction clears prior grants/drafts. Cross-session abuse controls/strong verification remain future hardening.

Booking retries do not repeat notifications. A database idempotent replay returns notification outcome `not_repeated`, indicating no new scheduling attempt; it does not assert how the original jobs were delivered. Existing fresh-booking outcomes remain unchanged. Live scheduling adapters are still unconfigured.

The token HTTP response retains its existing fields, but `roomName` is now unique and organization-scoped even when a label was supplied. Participant JWT metadata is `{ runtimeBindingId }` only. Its one-use Redis record contains server-generated identities and resolved profile, expires in 15 minutes, and is consumed by the worker after room/participant validation. Explicit unconfigured agent IDs return `AGENT_NOT_AVAILABLE` (403); the default with no profile has no tools. Bruno and token tests reflect these changes. No clinic CRUD HTTP endpoints are introduced.

## 6. Tool Result

Tool results should be explicit:

```json
{
  "success": true,
  "data": {
    "available": true,
    "slotId": "..."
  }
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "The requested slot is unavailable."
  }
}
```

Execution errors use safe public messages and stable codes: `INVALID_TOOL_INPUT`, `INVALID_TOOL_CALL`, `INVALID_TOOL_CONTEXT`, `TOOL_NOT_FOUND`, `TOOL_NOT_ALLOWED`, `TOOL_LIMIT_EXCEEDED`, `CONFLICTING_TOOL_CALL`, `TOOL_TIMEOUT`, `TOOL_RUN_STOPPED`, `INVALID_TOOL_OUTPUT` and `TOOL_EXECUTION_FAILED`. Exception text, stacks and provider payloads are never included. Explicit handler failure messages must be safe public text; they are validated but are not a substitute for careful service error mapping.

Validated invocation/result pairs live only in active session snapshots and are replayed as function-call/tool-result messages. Interrupted or superseded pairs are excluded. Per-run caching does not provide durable idempotency across turns, crashes or sessions; future transactional business tools must provide that at the service boundary.

## 7. API Contract Rules

- Every response uses the standard envelope.
- Errors use stable machine-readable codes.
- Pagination is required for large lists.
- Dates are serialized consistently.
- Timezone handling is explicit.
- Validation errors return field-level information where appropriate.
- Every endpoint must have a corresponding, runnable request in the repository's Bruno collection (`backend/bruno-collection/`).

## 8. Pagination

Recommended:

```text
?page=1&pageSize=20
```

Response:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

## 9. API Contract Change Rule

If backend and frontend disagree:
1. update this document
2. update backend
3. update frontend
4. test the complete flow

Do not silently change an API response shape in only one side.


## API Error and Response Standard

The reference Conexus backend has a centralized `errorHandler` and error classes, but legacy success responses vary. fileciteturn3file1

For this project:
- reuse/adapt the reference error classes and handler
- inspect the actual reference source for the common response helper/class
- use one standard response envelope for every new endpoint

Success:
```json
{
  "success": true,
  "data": {}
}
```

Error:
```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message"
  }
}
```

No controller may invent a third response format.
