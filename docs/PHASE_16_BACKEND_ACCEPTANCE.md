# Phase 16 — Staff clinic API and rescheduling contract

This implements the user-approved remaining Phase 16 scope. Staff HTTP APIs use the existing login and `x-organization-id` UUID membership check. All organization roles can read and manage appointments; only owner/admin manage doctors and concrete schedules. Patients retain the existing voice path; no public patient authentication or new voice tool is added.

## Routes (prefix `/api/v1`)

| Method | Path | Input |
|---|---|---|
| GET/POST | `/doctors` | List: page/pageSize/search/active. Create: phoneNumber/name/specialization/consultationDurationMinutes/nameEn/nameAs/searchAliases. |
| GET/PATCH | `/doctors/:doctorId` | Profile update; `isActive` controls deactivation. No physical deletion. |
| GET | `/doctors/:doctorId/slots` | from/to (inclusive, at most 90 days), page/pageSize. |
| POST | `/doctors/:doctorId/slots/generate` | weekdays/startTime/endTime/durationMinutes/horizonDays/maxPatients. |
| PATCH | `/doctors/:doctorId/slots/:slotId` | maxPatients or status=cancelled. Times/dates immutable. |
| GET | `/doctors/:doctorId/available-dates` | maxDates (1–90). |
| GET | `/doctors/:doctorId/available-times` | date. |
| GET/POST | `/doctors/:doctorId/blocked-dates` | List: from/to/page/pageSize. Create: date/reason/notes. |
| DELETE | `/doctors/:doctorId/blocked-dates/:blockedDateId` | Empty body. |
| POST | `/patients/resolve` | phoneNumber, explicit 10–15 digits with optional leading +. |
| GET/POST | `/appointments` | List: from/to/page/pageSize/doctorId/patientId/status. Create: existing booking fields. |
| GET/PATCH | `/appointments/:appointmentId` | PATCH: strict action cancel/reschedule, expectedVersion, reason; reschedule also targetSlotId. |

All mutation inputs are strict. All responses use the existing success/data or success/error envelope. Pagination uses items + page/pageSize/total/totalPages (default 20, maximum 100). Dates are YYYY-MM-DD and times HH:mm with clinic timezone. Availability returns `{dates, timezone}` or `{slots, timezone}`. Date-range lists default to clinic today through 29 days later. Errors map to 400 validation, 401 login, 403 access, 404 scoped missing resource, 409 state/version/capacity conflict, 500 unexpected failure. POST doctors/bookings returns 201 (booking replay 200); other operations return 200.

## Integrity

Date blocking rejects any booked appointment on the date instead of bulk cancellation. Deactivation rejects future booked appointments. Slot generation rejects overlapping/conflicting definitions; identical rows are skipped. Capacity cannot fall below booked count, and occupied slots cannot be cancelled. Cancelled/blocked slots cannot be reopened by PATCH.

Booking/cancel/reschedule require a UUID Idempotency-Key header. Appointment updates use a version guard. Same successful request never mutates or schedules twice; different input or a subsequently changed appointment returns conflict. A same-doctor reschedule preserves appointment/patient/source/call identity, keeps same-date tokens, allocates a new token on date change, and records history atomically. No-op, past or non-booked moves fail without changing the original booking.

Persistent doctor/date counters backfill maximum existing tokens including cancelled rows, never decrease, and are shared by voice/manual booking and rescheduling. Add appointment version=1, scoped mutation receipts (no patient payload) and move history. Pause API/worker writes when applying the migration; deploy the new allocator before resuming. Do not apply migrations to the main database from test scripts.

Lock order: clinic SHARE, optional request advisory lock, doctor SHARE (UPDATE for profile edits), sorted doctor/date advisory locks, sorted slot UPDATE locks, appointment UPDATE + version/state recheck. Initial scoped reads only discover lock keys; locked state is rechecked. A changed source slot fails closed rather than acquiring additional locks out of order.

Notification jobs carry the appointment version and versioned job ID. Moves reset reminderSent and schedule after commit; replay does not schedule. Missing delivery remains unconfigured. Future workers must compare job version/status/settings before delivery. No queue or real messaging is introduced.

Upcoming service results add an optional version for backward-compatible injected fixtures. Actual database reads return it, and newly created voice bookings retain version 1. A voice cancellation binds the read-back appointment version and date/time in trusted service context; staff movement invalidates that old readback. Voice tool arguments, engine orchestration and frontend contracts do not change.

## Acceptance

Use guarded local clinic test databases and isolated Redis sessions. Exercise real Express/auth routes and database operations, role/tenant failures, migration backfill, rollback, token retention/nonreuse, idempotency, stale requests and booking/move/block/deactivation races. Each route has a runnable Bruno request under `backend/bruno-collection/Clinic`, including an ordered synthetic acceptance flow and failure requests. Phase 17 remains in progress independently of Phase 16 acceptance.

## Verified implementation — 21 October 2026

- 17 authenticated route/method combinations, each with Bruno requests; cancellation and rescheduling share a strict PATCH action union.
- 63 `.bru` files: 18 resource examples, 10 failure examples and 35 ordered acceptance requests. Actual Bruno CLI 4.2.1 acceptance passed 35/35 requests and 73/73 assertions.
- Existing clinic DB 24/24, new staff DB 20/20, dialogue DB 18/18 and voice DB 15/15 (including stale cancellation after staff movement). Populated pre-migration upgrade/backfill 1/1; fresh migrations also exercised by database/API tests.
- Real HTTP/login acceptance 7/7; existing authentication 6/6 and LiveKit token checks 8/8; offline engine/tools/clinic/confirmation/context/TTS/listening/voice-loop/barge-in run 255/255; frontend diagnostics 6/6.
- Backend build/typecheck, strict engine/clinic test typechecks and frontend typecheck passed. No new application dependency or test framework, Git command, paid provider call, real message or main-database migration.

The ordinary Windows PostgreSQL forward at 5433 timed out despite healthy container status. Tests used disposable PostgreSQL/Redis containers on separate loopback ports, no mounted application volumes, and guarded `voice_agent_clinic_test_*` databases. Redis acceptance used database 15. Existing development containers were not stopped.

## Run locally

Use local PostgreSQL/Redis and these optional test settings (credentials below are placeholders):

```powershell
$env:CLINIC_TEST_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/voice_agent_clinic_test_phase16'
$env:CLINIC_TEST_REDIS_URL='redis://127.0.0.1:REDIS_PORT/15'
npm --prefix backend run test:clinic:staff
npm --prefix backend run test:clinic:http
npm --prefix backend run test:clinic:migration
```

Bruno: set `BRUNO_CLI_PATH` to the installed `@usebruno/cli/bin/bru.js` and run `npm --prefix backend run test:clinic:bruno`. It creates synthetic staff/clinic records, starts the real API on a free loopback port, runs the actual collection and cleans up its own records/sessions. It needs no development API or manual UUID copying. The collection root no longer overrides `host` with a pre-request localhost value, so selected test environments work.

## Application rollout

Migration `0004_clinic_staff_rescheduling.sql` has **not** been applied to the main development or production database. Before running the updated API/worker against an existing application database:

1. Stop API and voice-worker writes during a maintenance window.
2. Back up the target database and confirm the intended connection without printing credentials.
3. Run `npm --prefix backend run db:migrate` with the intended backend environment.
4. Deploy/rebuild and restart both API and worker with the new shared allocator.
5. Verify reads and a synthetic booking/move/cancellation before resuming callers.

Do not run old writers alongside the new counter allocator. Downgrade requires a separately reviewed data migration; do not automatically drop history/counters. Existing appointments are preserved, cancelled tokens contribute to backfill and counters remain monotonic.

The backend milestone is accepted locally. Dashboard wiring, real notification delivery, voice rescheduling tools and Phase 17 microphone/provider acceptance remain separate work.
