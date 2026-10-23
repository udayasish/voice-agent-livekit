# Agent API — quick guide

Open `backend/bruno-collection/` in Bruno. Select Local and run **Auth / Login** first. It captures accessToken and organizationId.

Run the numbered Agents requests:

1. **Configuration Options** — see permissions and available tools.
2. **Create Agent** — save a synthetic agent with no actions; UUID/version are captured automatically.
3. **List Agents** and **Get Agent** — inspect saved settings.
4. **Enable Appointment Actions** — saves all eight clinic tools with expectedVersion. Equivalent to choosing Allowed actions and Save Agent.
5. **Update Greeting** — saves speech text and starting language.
6. **Create Test Token** — verifies token issuance; does not start audio or make a booking.
7. **Deactivate Agent** — sets isActive=false for the synthetic agent. Skip until after dashboard voice testing if desired.

Use the Clinic folder for doctor/slot/patient/appointment HTTP requests. Voice booking uses the enabled tools during a real call.

## Settings explained

- **appointmentsEnabled**: server-owned clinic eligibility. Agent PATCH cannot enable it. Clinic setup must exist first.
- **enabledTools**: explicit agent permissions. New agents start empty. Booking requires its prerequisite tools; request 05 includes all eight clinic tools.
- **expectedVersion**: prevents overwriting another editor. Reload detail and review after a 409.
- **isActive**: controls new sessions. There is no agent DELETE endpoint.
- **Hospital name**: stored in organizations.name. Agent name and greeting do not rename it. Organization routes currently support reads only; rename API/form is not implemented.
- **Greeting language**: Assamese (as), Hindi (hi) or English (en). Select it and set defaultLanguage accordingly. Write the greeting in that language. Text is spoken as saved without translation; matching TTS voice and live speech verification are required.

These requests cover all five implemented agent routes and saved-agent token issuance. They contain status/envelope assertions; they do not establish full Phase 18 acceptance. Mutations change real records in the selected environment. Use synthetic local agents.
