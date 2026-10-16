import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { sql } from "drizzle-orm";
import { createClinicServices, type ClinicResult, type ClinicServices } from "../src/components/clinic/index.js";
import { createTransactionWithHooks } from "../src/lib/db/transaction-with-hooks.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import type { ClinicNotificationJob } from "../src/components/clinic/notifications/types.js";
import { openClinicTestDatabase, createClinicFixture, insertFixtureSlot, removeClinicFixtures, testLogger, schema, and, eq, type ClinicFixture } from "./clinic-test-db.js";

let database: Awaited<ReturnType<typeof openClinicTestDatabase>>;
const organizationIds: string[] = [];
before(async () => { database = await openClinicTestDatabase(); });
after(async () => {
  if (!database) return;
  try { await removeClinicFixtures(database.db, organizationIds); }
  finally { await database.pool.end(); }
});

function data<T>(result: ClinicResult<T>): T {
  assert.equal(result.success, true, result.success ? undefined : result.error.code);
  if (!result.success) throw new Error("Expected successful fixture operation");
  return result.data;
}
function failure(result: ClinicResult<unknown>, code: string): void {
  assert.equal(result.success, false);
  if (result.success) throw new Error("Expected failure");
  assert.equal(result.error.code, code);
  assert.deepEqual(Object.keys(result.error).sort(), ["code", "message"]);
}
async function fixture(options: Parameters<typeof createClinicFixture>[1] = {}) {
  const value = await createClinicFixture(database.db, options);
  organizationIds.push(value.organization.id);
  return value;
}
async function patient(f: ClinicFixture, phoneNumber = "7002059544") {
  return data(await f.services().getOrCreatePatient({ phoneNumber }));
}
async function booking(f: ClinicFixture, slot: typeof schema.clinicSlots.$inferSelect, patientId: string, services: ClinicServices = f.services()) {
  return services.createAppointmentFromBooking({ doctorId: f.doctor.id, slotId: slot.id, patientId, patientName: "Synthetic Patient", patientAge: 24 });
}
async function appointmentsFor(f: ClinicFixture) {
  return database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id));
}

test("migration is additive and clinic contacts remain separate from login accounts", async () => {
  const tables = await database.pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const name of ["users", "organizations", "organization_members", "clinic_people", "clinic_doctors", "clinic_slots", "clinic_blocked_dates", "clinic_appointments", "clinic_settings"]) assert.ok(names.has(name));
  for (const name of ["tenants", "patients", "doctors", "slots", "appointments", "doctor_schedules", "conversation_state"]) assert.equal(names.has(name), false);
});

test("active doctor listing and ambiguous partial-name lookup preserve all matches", async () => {
  const f = await fixture();
  for (const [index, active] of [true, false].entries()) {
    const [person] = await database.db.insert(schema.clinicPeople).values({ organizationId: f.organization.id, phoneNumber: `900000000${index + 2}`, role: "doctor", name: `Basu ${index}` }).returning();
    await database.db.insert(schema.clinicDoctors).values({ organizationId: f.organization.id, personId: person!.id, isActive: active });
  }
  assert.equal(data(await f.services().listActiveDoctors()).length, 2);
  const matches = data(await f.services().findDoctorsByName({ namePart: "basu" }));
  assert.equal(matches.length, 3);
  assert.equal(matches.filter((match) => match.isActive).length, 2);
  assert.deepEqual(data(await f.services().findDoctorsByName({ namePart: "%" })), []);
});

test("patient lookup/creation is race-safe and rejects existing staff contacts", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 16 }, () => f.services().getOrCreatePatient({ phoneNumber: "+7002059544" })));
  assert.equal(new Set(results.map((result) => data(result).id)).size, 1);
  assert.equal(data(results[0]!).phoneNumber, "7002059544");
  const rows = await database.db.select().from(schema.clinicPeople).where(and(eq(schema.clinicPeople.organizationId, f.organization.id), eq(schema.clinicPeople.role, "patient")));
  assert.equal(rows.length, 1);
  failure(await f.services().getOrCreatePatient({ phoneNumber: f.person.phoneNumber }), "PATIENT_ROLE_CONFLICT");
});

test("unknown, suspended, non-clinic and invalid-timezone organizations fail safely", async () => {
  const f = await fixture();
  failure(await createClinicServices({ organizationId: randomUUID(), source: "voice" }, f.deps).listActiveDoctors(), "CLINIC_NOT_FOUND");
  await database.db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, f.organization.id));
  failure(await f.services().listActiveDoctors(), "CLINIC_UNAVAILABLE");
  await database.db.update(schema.organizations).set({ status: "active", businessType: "hotel" }).where(eq(schema.organizations.id, f.organization.id));
  failure(await f.services().getOrCreatePatient({ phoneNumber: "7002059544" }), "CLINIC_UNAVAILABLE");
  await database.db.update(schema.organizations).set({ businessType: "clinic", timezone: "invalid/timezone" }).where(eq(schema.organizations.id, f.organization.id));
  failure(await f.services().listActiveDoctors(), "INVALID_CLINIC_TIMEZONE");
});

test("every service enforces organization scope and rejects related IDs from another clinic", async () => {
  const a = await fixture();
  const b = await fixture();
  const aPatient = await patient(a);
  const bPatient = await patient(b);
  assert.notEqual(aPatient.id, bPatient.id);
  const aSlot = await insertFixtureSlot(database.db, a);
  const bSlot = await insertFixtureSlot(database.db, b);
  failure(await a.services().listActiveDoctors({ organizationId: b.organization.id } as never), "INVALID_CLINIC_INPUT");
  failure(await a.services().listAvailableDates({ doctorId: b.doctor.id }), "DOCTOR_NOT_FOUND");
  failure(await a.services().listAvailableSlots({ doctorId: b.doctor.id, date: bSlot.slotDate }), "DOCTOR_NOT_FOUND");
  failure(await a.services().createAppointmentFromBooking({ doctorId: b.doctor.id, slotId: bSlot.id, patientId: aPatient.id, patientName: "Synthetic Patient", patientAge: 20 }), "DOCTOR_NOT_FOUND");
  failure(await booking(a, bSlot, aPatient.id), "SLOT_UNAVAILABLE");
  failure(await booking(a, aSlot, bPatient.id), "PATIENT_NOT_FOUND");
  failure(await a.services().listUpcomingAppointmentsForPatient({ patientId: bPatient.id }), "PATIENT_NOT_FOUND");
  failure(await a.services().generateSlots({ doctorId: b.doctor.id, weekdays: ["thursday"], startTime: "09:00", endTime: "10:00", durationMinutes: 15, horizonDays: 7 }), "DOCTOR_NOT_FOUND");
  failure(await a.services().blockDoctorDate({ doctorId: b.doctor.id, date: bSlot.slotDate }), "DOCTOR_NOT_FOUND");
  const blocked = data(await b.services().blockDoctorDate({ doctorId: b.doctor.id, date: bSlot.slotDate }));
  failure(await a.services().unblockDoctorDate({ doctorId: a.doctor.id, blockedDateId: blocked.blockedDateId }), "BLOCKED_DATE_NOT_FOUND");
  const aBooking = data(await booking(a, aSlot, aPatient.id));
  failure(await b.services({ patientId: bPatient.id }).cancelAppointment({ appointmentId: aBooking.appointmentId, reason: "Changed plans" }), "APPOINTMENT_NOT_FOUND");
  assert.equal((await appointmentsFor(a))[0]?.status, "booked");
});

test("booking derives stored date/time and records only server-owned source/call metadata", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const callId = randomUUID();
  const input = { doctorId: f.doctor.id, slotId: slot.id, patientId: p.id, patientName: "Synthetic Patient", patientAge: 0 };
  failure(await f.services().createAppointmentFromBooking({ ...input, source: "whatsapp", appointmentDate: "2099-01-01" } as never), "INVALID_CLINIC_INPUT");
  failure(await f.services().createAppointmentFromBooking({ ...input, patientAge: undefined } as never), "INVALID_CLINIC_INPUT");
  const result = data(await f.services({ source: "voice", callId }).createAppointmentFromBooking(input));
  assert.equal(result.appointmentDate, slot.slotDate);
  assert.equal(result.appointmentTime, slot.startTime);
  const [stored] = await appointmentsFor(f);
  assert.equal(stored?.source, "voice");
  assert.equal(stored?.callId, callId);
  assert.equal(stored?.patientAge, 0);
  assert.equal(stored?.complaint, null);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("inactive doctors, blocked/cancelled slots and past times cannot be booked", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  await database.db.update(schema.clinicDoctors).set({ isActive: false }).where(eq(schema.clinicDoctors.id, f.doctor.id));
  failure(await booking(f, slot, p.id), "DOCTOR_INACTIVE");
  await database.db.update(schema.clinicDoctors).set({ isActive: true }).where(eq(schema.clinicDoctors.id, f.doctor.id));
  for (const status of ["blocked", "cancelled"] as const) {
    await database.db.update(schema.clinicSlots).set({ status }).where(eq(schema.clinicSlots.id, slot.id));
    failure(await booking(f, slot, p.id), "SLOT_UNAVAILABLE");
  }
  const past = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-12" });
  failure(await booking(f, past, p.id), "SLOT_UNAVAILABLE");
  assert.equal((await appointmentsFor(f)).length, 0);
});

test("concurrent booking of the last capacity succeeds exactly once", async () => {
  const f = await fixture();
  const slot = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const patients = await Promise.all(Array.from({ length: 16 }, (_, index) => patient(f, String(7000000000 + index))));
  const results = await Promise.all(patients.map((p) => booking(f, slot, p.id)));
  assert.equal(results.filter((result) => result.success).length, 1);
  for (const result of results.filter((result) => !result.success)) failure(result, "SLOT_UNAVAILABLE");
  assert.equal((await appointmentsFor(f)).length, 1);
  const [storedSlot] = await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id));
  assert.equal(storedSlot?.status, "booked");
});

test("tokens remain unique and sequential across simultaneous bookings in different slots", async () => {
  const f = await fixture();
  const first = await insertFixtureSlot(database.db, f, { maxPatients: 20 });
  const second = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15", maxPatients: 20 });
  const patients = await Promise.all(Array.from({ length: 16 }, (_, index) => patient(f, String(7000000000 + index))));
  const results = await Promise.all(patients.map((p, index) => booking(f, index % 2 ? first : second, p.id)));
  assert.deepEqual(results.map((result) => data(result).tokenNumber).sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.equal(data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: first.slotDate }))[0]?.remainingCapacity, 12);
});

test("patient-bound cancellation is repeatable, reopens capacity and preserves token history", async () => {
  const f = await fixture();
  const p = await patient(f);
  const other = await patient(f, "7002059545");
  const slot = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const booked = data(await booking(f, slot, p.id));
  failure(await f.services().cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" }), "PATIENT_SCOPE_REQUIRED");
  failure(await f.services({ patientId: other.id }).cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" }), "APPOINTMENT_NOT_FOUND");
  const services = f.services({ patientId: p.id });
  assert.equal(data(await services.cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" })).alreadyCancelled, false);
  assert.equal(data(await services.cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed again" })).alreadyCancelled, true);
  assert.equal(data(await booking(f, slot, other.id)).tokenNumber, 2);
  failure(await services.createAppointmentFromBooking({ doctorId: f.doctor.id, slotId: slot.id, patientId: other.id, patientName: "Synthetic Patient", patientAge: 20 }), "CLINIC_ACCESS_DENIED");
  failure(await services.listUpcomingAppointmentsForPatient({ patientId: other.id }), "CLINIC_ACCESS_DENIED");
  failure(await services.getOrCreatePatient({ phoneNumber: "7002059545" }), "CLINIC_ACCESS_DENIED");
  failure(await services.blockDoctorDate({ doctorId: f.doctor.id, date: slot.slotDate }), "CLINIC_ACCESS_DENIED");
});

test("completed appointments cannot cancel, and cancellation never reopens blocked or terminal slots", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const booked = data(await booking(f, slot, p.id));
  await database.db.update(schema.clinicAppointments).set({ status: "completed" }).where(eq(schema.clinicAppointments.id, booked.appointmentId));
  failure(await f.services({ patientId: p.id }).cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" }), "APPOINTMENT_NOT_CANCELLABLE");
  await database.db.update(schema.clinicAppointments).set({ status: "booked" }).where(eq(schema.clinicAppointments.id, booked.appointmentId));
  for (const status of ["blocked", "cancelled"] as const) {
    await database.db.update(schema.clinicAppointments).set({ status: "booked" }).where(eq(schema.clinicAppointments.id, booked.appointmentId));
    await database.db.update(schema.clinicSlots).set({ status }).where(eq(schema.clinicSlots.id, slot.id));
    data(await f.services({ patientId: p.id }).cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" }));
    const [stored] = await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id));
    assert.equal(stored?.status, status);
  }
});

test("date blocking atomically cancels bookings; repeated cancellation keeps blocked slots blocked", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const terminal = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15", status: "cancelled" });
  const booked = data(await booking(f, slot, p.id));
  const blocked = data(await f.services().blockDoctorDate({ doctorId: f.doctor.id, date: slot.slotDate }));
  assert.equal(blocked.affectedSlots, 1);
  assert.equal(blocked.cancelledAppointments, 1);
  failure(await f.services().blockDoctorDate({ doctorId: f.doctor.id, date: slot.slotDate }), "DATE_ALREADY_BLOCKED");
  assert.deepEqual(data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: slot.slotDate })), []);
  assert.equal(data(await f.services({ patientId: p.id }).cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" })).alreadyCancelled, true);
  assert.equal((await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id)))[0]?.status, "blocked");
  assert.equal(data(await f.services().unblockDoctorDate({ doctorId: f.doctor.id, blockedDateId: blocked.blockedDateId })).reopenedSlots, 1);
  assert.equal((await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, terminal.id)))[0]?.status, "cancelled");
  assert.equal(data(await booking(f, slot, p.id)).tokenNumber, 2);
});

test("simultaneous booking and date blocking leave no active appointment on a blocked date", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const [booked, blocked] = await Promise.all([booking(f, slot, p.id), f.services().blockDoctorDate({ doctorId: f.doctor.id, date: slot.slotDate })]);
  data(blocked);
  if (!booked.success) failure(booked, "SLOT_UNAVAILABLE");
  assert.equal((await appointmentsFor(f)).filter((appointment) => appointment.status === "booked").length, 0);
  assert.equal((await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id)))[0]?.status, "blocked");
});

test("booking/cancellation race preserves capacity without deadlock or automatic handler retries", async () => {
  const f = await fixture();
  const first = await patient(f);
  const second = await patient(f, "7002059545");
  const slot = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const booked = data(await booking(f, slot, first.id));
  const [cancelled, replacement] = await Promise.all([
    f.services({ patientId: first.id }).cancelAppointment({ appointmentId: booked.appointmentId, reason: "Changed plans" }), booking(f, slot, second.id),
  ]);
  data(cancelled);
  if (!replacement.success) failure(replacement, "SLOT_UNAVAILABLE");
  assert.ok((await appointmentsFor(f)).filter((appointment) => appointment.status === "booked").length <= 1);
  if (!replacement.success) assert.equal(data(await booking(f, slot, second.id)).tokenNumber, 2);
});

test("insert failure rolls back appointment, capacity update, token and post-commit scheduling", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const scheduler = new RecordingClinicScheduler();
  // Test-only DDL cannot be expressed as Drizzle table operations. It affects this dedicated DB only.
  await database.pool.query(`CREATE OR REPLACE FUNCTION clinic_test_reject_booking() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('clinic.test.reject', true) = 'true' THEN RAISE EXCEPTION 'private synthetic failure'; END IF; RETURN NEW; END $$`);
  await database.pool.query("CREATE TRIGGER clinic_test_reject_booking BEFORE INSERT ON clinic_appointments FOR EACH ROW EXECUTE FUNCTION clinic_test_reject_booking()");
  try {
    const transaction = createTransactionWithHooks(database.db, testLogger);
    const services = f.services({}, { scheduler, transaction: (fn) => transaction(async (tx) => {
      await tx.execute(sql`select set_config('clinic.test.reject', 'true', true)`);
      return fn(tx);
    }) });
    failure(await booking(f, slot, p.id, services), "CLINIC_OPERATION_FAILED");
    assert.equal((await appointmentsFor(f)).length, 0);
    assert.equal((await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id)))[0]?.status, "available");
    assert.equal(scheduler.snapshot().length, 0);
  } finally {
    await database.pool.query("DROP TRIGGER clinic_test_reject_booking ON clinic_appointments");
    await database.pool.query("DROP FUNCTION clinic_test_reject_booking()");
  }
  assert.equal(data(await booking(f, slot, p.id)).tokenNumber, 1);
});

test("blocking failure rolls back the blocked date, slot changes and appointment cancellation", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  data(await booking(f, slot, p.id));
  await database.pool.query(`CREATE OR REPLACE FUNCTION clinic_test_reject_block() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('clinic.test.reject_block', true) = 'true' THEN RAISE EXCEPTION 'private synthetic failure'; END IF; RETURN NEW; END $$`);
  await database.pool.query("CREATE TRIGGER clinic_test_reject_block BEFORE UPDATE ON clinic_appointments FOR EACH ROW EXECUTE FUNCTION clinic_test_reject_block()");
  try {
    const transaction = createTransactionWithHooks(database.db, testLogger);
    const services = f.services({}, { transaction: (fn) => transaction(async (tx) => {
      await tx.execute(sql`select set_config('clinic.test.reject_block', 'true', true)`);
      return fn(tx);
    }) });
    failure(await services.blockDoctorDate({ doctorId: f.doctor.id, date: slot.slotDate }), "CLINIC_OPERATION_FAILED");
    assert.equal((await database.db.select().from(schema.clinicBlockedDates).where(eq(schema.clinicBlockedDates.organizationId, f.organization.id))).length, 0);
    assert.equal((await database.db.select().from(schema.clinicSlots).where(eq(schema.clinicSlots.id, slot.id)))[0]?.status, "available");
    assert.equal((await appointmentsFor(f))[0]?.status, "booked");
  } finally {
    await database.pool.query("DROP TRIGGER clinic_test_reject_block ON clinic_appointments");
    await database.pool.query("DROP FUNCTION clinic_test_reject_block()");
  }
});

test("reminder and doctor alert scheduling observe a committed appointment and contain identifiers only", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const jobs: ClinicNotificationJob[] = [];
  const scheduler = { schedule: async (job: ClinicNotificationJob) => {
    const committed = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, job.appointmentId));
    assert.equal(committed.length, 1);
    jobs.push(job);
  } };
  const booked = data(await booking(f, slot, p.id, f.services({}, { scheduler })));
  assert.deepEqual(booked.notifications, { reminder: "scheduled", doctorAlert: "scheduled" });
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((job) => job.kind === "appointment-reminder")?.runAt, "2026-10-14T03:30:00.000Z");
  assert.equal(jobs.find((job) => job.kind === "doctor-booking-alert")?.runAt, f.now().toISOString());
  for (const job of jobs) assert.deepEqual(Object.keys(job).sort(), ["appointmentId", "jobId", "kind", "organizationId", "runAt"]);
});

test("scheduler failure keeps the booking successful, reports failure and never books twice", async () => {
  const f = await fixture();
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f);
  const events: Record<string, unknown>[] = [];
  const logger = { info: (_message: string, metadata: Record<string, unknown>) => events.push(metadata), warn: (_message: string, metadata: Record<string, unknown>) => events.push(metadata), error: (_message: string, metadata: Record<string, unknown>) => events.push(metadata) };
  let attempts = 0;
  const scheduler = { schedule: async () => { attempts++; throw new Error("credential synthetic patient 7002059544"); } };
  const booked = data(await booking(f, slot, p.id, f.services({}, { scheduler, logger })));
  assert.deepEqual(booked.notifications, { reminder: "failed", doctorAlert: "failed" });
  assert.equal(attempts, 2);
  assert.equal((await appointmentsFor(f)).length, 1);
  assert.doesNotMatch(JSON.stringify(events), /credential|7002059544|synthetic patient|stack/);
});

test("missing schedulers, disabled settings and short reminder windows have distinct outcomes", async () => {
  const f = await fixture();
  const p = await patient(f);
  const long = await insertFixtureSlot(database.db, f);
  assert.deepEqual(data(await booking(f, long, p.id)).notifications, { reminder: "unconfigured", doctorAlert: "unconfigured" });
  const scheduler = new RecordingClinicScheduler();
  const services = f.services({}, { scheduler });
  await database.db.update(schema.clinicSettings).set({ remindersEnabled: false, notificationsEnabled: false }).where(eq(schema.clinicSettings.organizationId, f.organization.id));
  assert.deepEqual(data(await booking(f, long, p.id, services)).notifications, { reminder: "disabled", doctorAlert: "disabled" });
  assert.equal(scheduler.snapshot().length, 0);
  await database.db.update(schema.clinicSettings).set({ remindersEnabled: true, notificationsEnabled: true }).where(eq(schema.clinicSettings.organizationId, f.organization.id));
  const short = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-13", startTime: "07:00", endTime: "07:15" });
  assert.deepEqual(data(await booking(f, short, p.id, services)).notifications, { reminder: "skipped_window", doctorAlert: "scheduled" });
  assert.equal(scheduler.snapshot().length, 1);
});

test("slot generation is repeatable, keeps source capacity and omits partial trailing intervals", async () => {
  const f = await fixture();
  const input = { doctorId: f.doctor.id, weekdays: ["tuesday"] as const, startTime: "09:00", endTime: "09:55", durationMinutes: 20, horizonDays: 1 };
  const mutable = { ...input, weekdays: [...input.weekdays] };
  assert.equal(data(await f.services().generateSlots(mutable)).createdCount, 2);
  assert.equal(data(await f.services().generateSlots(mutable)).createdCount, 0);
  const slots = data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: "2026-10-13" }));
  assert.equal(slots.length, 2);
  assert.equal(slots[0]?.maxPatients, 30);
  assert.equal(slots[1]?.endTime, "09:40:00");
  const blocked = data(await f.services().blockDoctorDate({ doctorId: f.doctor.id, date: "2026-10-13" }));
  data(await f.services().generateSlots({ ...mutable, startTime: "10:00", endTime: "10:40" }));
  assert.deepEqual(data(await f.services().listAvailableDates({ doctorId: f.doctor.id })), []);
  assert.equal(data(await f.services().unblockDoctorDate({ doctorId: f.doctor.id, blockedDateId: blocked.blockedDateId })).reopenedSlots, 4);
});

test("availability, generation and upcoming appointments use the clinic-local day, not UTC", async () => {
  const f = await fixture({ timezone: "America/Los_Angeles", now: "2026-10-13T02:00:00Z" });
  const p = await patient(f);
  const slot = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-12", startTime: "20:00", endTime: "20:15" });
  await insertFixtureSlot(database.db, f, { slotDate: "2026-10-12", startTime: "18:00", endTime: "18:15" });
  assert.deepEqual(data(await f.services().listAvailableDates({ doctorId: f.doctor.id })), ["2026-10-12"]);
  assert.equal(data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: slot.slotDate })).length, 1);
  const booked = data(await booking(f, slot, p.id));
  assert.equal(data(await f.services().listUpcomingAppointmentsForPatient({ patientId: p.id }))[0]?.appointmentId, booked.appointmentId);
  const generated = data(await f.services().generateSlots({ doctorId: f.doctor.id, weekdays: ["monday"], startTime: "21:00", endTime: "21:30", durationMinutes: 15, horizonDays: 1 }));
  assert.equal(generated.createdCount, 2);
  const dates = await database.db.select({ date: schema.clinicSlots.slotDate }).from(schema.clinicSlots).where(eq(schema.clinicSlots.organizationId, f.organization.id));
  assert.ok(dates.every((row) => row.date === "2026-10-12"));
  f.setNow("2026-10-13T03:00:00Z");
  assert.deepEqual(data(await f.services().listUpcomingAppointmentsForPatient({ patientId: p.id })), []);
});

test("availability verifies blocked dates and actual occupancy even when slot status is stale", async () => {
  const f = await fixture();
  const p = await patient(f);
  const full = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  data(await booking(f, full, p.id));
  await database.db.update(schema.clinicSlots).set({ status: "available" }).where(eq(schema.clinicSlots.id, full.id));
  assert.deepEqual(data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: full.slotDate })), []);
  failure(await booking(f, full, p.id), "SLOT_UNAVAILABLE");
  const blockedSlot = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-16" });
  await database.db.insert(schema.clinicBlockedDates).values({ organizationId: f.organization.id, doctorId: f.doctor.id, blockedDate: blockedSlot.slotDate });
  assert.deepEqual(data(await f.services().listAvailableSlots({ doctorId: f.doctor.id, date: blockedSlot.slotDate })), []);
  failure(await booking(f, blockedSlot, p.id), "SLOT_UNAVAILABLE");
});

test("database constraints reject cross-tenant relationships and invalid capacity", async () => {
  const a = await fixture();
  const b = await fixture();
  const p = await patient(a);
  const bSlot = await insertFixtureSlot(database.db, b);
  const [unlinkedDoctorContact] = await database.db.insert(schema.clinicPeople).values({ organizationId: b.organization.id, role: "doctor", phoneNumber: "9000000009", name: "Synthetic Doctor" }).returning();
  await assert.rejects(database.db.insert(schema.clinicDoctors).values({ organizationId: a.organization.id, personId: unlinkedDoctorContact!.id }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23503");
  await assert.rejects(database.db.insert(schema.clinicSlots).values({ organizationId: a.organization.id, doctorId: a.doctor.id, slotDate: "2026-10-15", dayOfWeek: "thursday", startTime: "09:00", endTime: "09:15", maxPatients: 0 }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514");
  await assert.rejects(database.db.insert(schema.clinicAppointments).values({ organizationId: a.organization.id, doctorId: a.doctor.id, patientId: p.id, slotId: bSlot.id, tokenNumber: 1, appointmentDate: bSlot.slotDate, appointmentTime: bSlot.startTime, patientName: "Synthetic Patient", patientAge: 20, source: "manual" }), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23503");
});

test("source-derived business scenarios behave identically for WhatsApp, voice and manual adapters", async () => {
  const expected = JSON.parse(readFileSync(new URL("./fixtures/clinic-business-characterization.json", import.meta.url), "utf8")) as {
    slotCapacity: number; acceptedTokens: number[]; tokenAfterCancellation: number; patientAge: number; complaint: null;
  };
  for (const source of ["whatsapp", "voice", "manual"] as const) {
    const f = await fixture();
    const p = await patient(f);
    const slot = await insertFixtureSlot(database.db, f, { maxPatients: expected.slotCapacity });
    const services = f.services({ source });
    const input = { doctorId: f.doctor.id, slotId: slot.id, patientId: p.id, patientName: "Synthetic Patient", patientAge: expected.patientAge, complaint: expected.complaint };
    const first = data(await services.createAppointmentFromBooking(input));
    const second = data(await services.createAppointmentFromBooking(input));
    assert.deepEqual([first.tokenNumber, second.tokenNumber], expected.acceptedTokens);
    failure(await services.createAppointmentFromBooking(input), "SLOT_UNAVAILABLE");
    data(await f.services({ source, patientId: p.id }).cancelAppointment({ appointmentId: first.appointmentId, reason: "Changed plans" }));
    assert.equal(data(await services.createAppointmentFromBooking(input)).tokenNumber, expected.tokenAfterCancellation);
    const stored = await appointmentsFor(f);
    assert.ok(stored.every((appointment) => appointment.source === source && appointment.complaint === null && appointment.patientAge === expected.patientAge));
  }
});
