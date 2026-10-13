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

### doctors
- id
- organization_id
- name
- specialization
- phone
- status

### doctor_schedules
- id
- doctor_id
- day_of_week
- start_time
- end_time
- slot_duration_minutes

### patients
- id
- organization_id
- name
- phone
- metadata_json

### appointments
- id
- organization_id
- doctor_id
- patient_id
- scheduled_start
- scheduled_end
- status
- source
- call_id
- created_at
- updated_at

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
3. slot belongs to doctor's schedule
4. slot is in the future
5. slot is not already booked
6. patient belongs to organization or is created
7. transaction completes successfully

Concurrency rules:
- PostgreSQL is the authoritative integrity boundary
- use a DB uniqueness/exclusion constraint where the schema permits it
- execute booking in a transaction
- use row-level locking when required
- Redis may coordinate distributed work but must not be the sole protection against double booking

Only then return:

```json
{
  "success": true,
  "data": {
    "appointmentId": "...",
    "status": "confirmed"
  }
}
```

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
