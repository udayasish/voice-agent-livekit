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
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
};
```

`ToolContext` must contain trusted server-side context such as:
- organizationId
- agentId
- callId
- conversationId

The LLM must not supply trusted tenant identity.

Likewise, a browser-supplied `organizationId` is not trusted identity. Resolve and verify organization membership server-side before business services execute.

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

## 7. API Contract Rules

- Every response uses the standard envelope.
- Errors use stable machine-readable codes.
- Pagination is required for large lists.
- Dates are serialized consistently.
- Timezone handling is explicit.
- Validation errors return field-level information where appropriate.

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
