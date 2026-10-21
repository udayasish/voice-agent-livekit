# Clinic staff API collection

Every Phase 16 endpoint has a request in Doctors, Schedules, Patients or Appointments. Requests use the existing host/accessToken/organizationId variables. There is no patient login or real message delivery.

## Ordered acceptance

Run only the **Acceptance** folder in sequence against a synthetic local clinic. It creates unique doctor/patient phones, generates future slots, captures IDs/versions, books, tests failures, reschedules, verifies capacity, cancels and blocks/unblocks. Fresh requests generate a new UUID key; replay requests intentionally retain the original key and expected version.

Required environment variables: host, adminEmail, adminPassword, otherOrganizationId (an organization the owner cannot access), memberAccessToken (a member of the test clinic). Login Staff captures the owner accessToken and organizationId. Configure synthetic staff/memberships locally; no UUID copying is needed when using the automated acceptance harness. Run with the Bruno CLI developer sandbox so its bundled uuid module is available. Do not run the whole Clinic folder as an ordered flow: resource/failure folders are reference requests and their preconditions vary.

Failure Cases contains individually runnable examples. Full-slot/block/deactivation/conflicting-key cases require the booking to remain active; stale-version requires the move to have completed. Cross-doctor move requires the other-doctor setup in Acceptance. Member and foreign-organization examples require the variables above.

The acceptance leaves only synthetic clinic records. It performs no physical appointment deletion. `test:clinic:bruno` runs the actual requests in an isolated temporary test fixture and cleans up its own records/sessions.

## Run

From backend/bruno-collection, use the installed Bruno CLI:

```powershell
bru run Clinic/Acceptance --env Local --sandbox=developer --disable-cookies
```

For an isolated automated run, set CLINIC_TEST_DATABASE_URL to a guarded local voice_agent_clinic_test database, CLINIC_TEST_REDIS_URL to local Redis database 15, and BRUNO_CLI_PATH to the installed CLI executable JavaScript entry point; then run `npm run test:clinic:bruno` from backend.
