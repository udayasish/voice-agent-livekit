# Assamese AI Voice Agent Platform — Data Model & API Contract

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
| `clinic_appointments` | `id`, `organization_id`, `doctor_id`, `patient_id` (clinic person), `slot_id`, `token_number`, `appointment_date`, `appointment_time`, `patient_name`, required `patient_age`, optional `complaint`, `status`, `cancel_reason`, `reminder_sent`, `source`, nullable `call_id`; unique doctor/date/token. |
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

No clinic HTTP endpoints or tools are implemented here. Overall Phase 16's API and rescheduling acceptance remains outstanding.

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
