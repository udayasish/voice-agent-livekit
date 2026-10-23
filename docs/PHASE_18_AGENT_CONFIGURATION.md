# Phase 18 — Agent configuration

Implementation contract approved 22 October 2026. Phase 18 remains IN PROGRESS until recorded acceptance, including actual spoken greeting playback, passes. Phase 17's outstanding live acceptance remains separate.

## API

All routes require staff authentication, a UUID x-organization-id header validated before membership lookup, and an active organization. Owner/admin can create or update; all members can read/test. New routes: GET/POST /api/v1/agents, GET /api/v1/agents/options, GET/PATCH /api/v1/agents/:agentId. No DELETE or separate tools mutation. Success/error use existing envelopes. Lists use items + pagination(page,pageSize,total,totalPages), defaults 1/20, maximum 100, createdAt DESC/id DESC. Search is literal case-insensitive name search; active is true/false. Detail accepts UUID or scoped legacy alias; PATCH requires UUID, expectedVersion and at least one editable field. Nested values replace whole objects. No-op saves retain version. Create returns 201; reads/updates 200. Validation 400, authentication 401, permissions 403, scoped missing 404, stale/inactive/closed 409, unexpected failure 500.

Editable fields: name, isActive, instructions, greeting, languages(as/hi/en), defaultLanguage, enabledTools, workingHours, humanContact. Module, appointmentsEnabled, contextLimits, organization and actor are server controlled. Name 1–100 code points; instructions <=1000 code points/2000 UTF-8 bytes; greeting <=300 code points/900 bytes; all editable text <=3072 bytes. Default language must be selected. Invalid control characters and unexpected fields are rejected.

Working hours use {mode:always_open} or {mode:weekly,days:{monday:[],...,sunday:[]}}, each interval {start,end}. Organization timezone; inclusive start/exclusive end, maximum four intervals/day, no overlap, 24:00 only as end. Overnight intervals must be split. Empty days are closed. Actual instant-to-local evaluation makes both repeated DST occurrences follow the same wall-clock schedule. Hours never modify doctor availability.

Human contact is {mode:disabled} or {mode:contact_only,label,phoneNumber}; label 1–100 characters, explicit + and 8–15 digits. Offer on request; do not claim actual transfer or staff availability.

## Persistence and runtime

One agents table stores configuration atomically, UUID identity, scoped unique legacyKey, version, actor IDs and timestamps. No duplicate clinic tables, agent_tools table or business_configs table. JSON profiles are explicit import input only. Import is dry-run by default, transactional on apply, skips existing aliases without overwriting edits, and preserves effective permissions. Missing default rejects token issuance rather than creating an implicit fallback.

POST /api/v1/livekit/token keeps its response, but resolves saved configuration and issues a schema/version-bound one-use Redis record (900 seconds). Worker admission rechecks membership, organization, agent version/status and hours under row locks. Old bindings after an edit fail; admitted calls keep their snapshot. No JSON fallback. Fixed clinic safety rules and executor permissions cannot be changed through instructions.

Clinic tool dependencies: availability requires list_doctors or find_doctor; booking requires resolver, list/find doctor and dates/times; lookup requires resolver and doctor discovery; cancellation requires lookup. Invalid combinations are rejected, never silently expanded. Generic agents have no clinic tools.

Greeting uses existing TTS/audio/interruption infrastructure once, after admission and listening readiness; no fake caller turn. Interrupted/failed greeting never authorizes an action or automatically repeats. Languages are per-session preferences, not provider or quality approval.

## Dashboard and acceptance

Only Dashboard and Agents navigation; testing is nested. Placeholder calls/conversations/clinic/phone/analytics/organization/settings routes redirect home. Remove fake metrics and provider/health claims. Central API services, RHF/Zod, local request state, version-conflict recovery and authenticated organization selection. No LiveKit in ordinary configuration pages. Preserve cookie refresh fix.

Acceptance: isolated real Express/auth/PostgreSQL/Redis, migration/import, roles/tenants, version/admission races, configured SDK behavior, greeting interruption/failure, Bruno, browser create/save/reload/test and real microphone greeting. Default tests use no paid providers or messages. Never apply test migrations to the application database or flush development Redis.

Rollout: backup database/profile, pause issuance, drain active calls, expire old bindings, migrate/import, deploy compatible API+worker, verify aliases/configuration, resume. No stale JSON rollback that re-enables tools. See PROGRESS.md for actual verification and remaining rollout/manual requirements.
