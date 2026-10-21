import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { inArray } from "drizzle-orm";
import { openClinicTestDatabase, createClinicFixture, insertFixtureSlot, removeClinicFixtures, schema, and, eq } from "./clinic-test-db.js";
import { createStaffClinicServices } from "../src/components/clinic/services/staff.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import type { ClinicResult } from "../src/components/clinic/index.js";
import type { ClinicDependencies } from "../src/components/clinic/services/runtime.js";

let database: Awaited<ReturnType<typeof openClinicTestDatabase>>;
const organizations: string[] = []; const actors: string[] = [];
before(async () => { database = await openClinicTestDatabase(); });
after(async () => {
  if (!database) return;
  try { await removeClinicFixtures(database.db, organizations); if (actors.length) await database.db.delete(schema.users).where(inArray(schema.users.id, actors)); }
  finally { await database.pool.end(); }
});
function data<T>(r: ClinicResult<T>): T { if (!r.success) assert.fail(r.error.code); return r.data; }
function fails(r: ClinicResult<unknown>, code: string) { assert.equal(r.success, false); if (!r.success) assert.equal(r.error.code, code); }
async function setup(extra: Partial<ClinicDependencies> = {}) {
  const f = await createClinicFixture(database.db); organizations.push(f.organization.id);
  const [actor] = await database.db.insert(schema.users).values({ name: "Synthetic Staff", email: `${randomUUID()}@test.invalid` }).returning();
  if (!actor) throw new Error("Actor missing"); actors.push(actor.id);
  const deps = { ...f.deps, ...extra };
  const service = (role: "owner" | "admin" | "member" = "owner") => createStaffClinicServices({ organizationId: f.organization.id, actorId: actor.id, role }, deps);
  const p = data(await f.services().getOrCreatePatient({ phoneNumber: "7000000001" }));
  const a = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const b = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15", maxPatients: 1 });
  const c = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-16", maxPatients: 1 });
  const booking = { doctorId: f.doctor.id, patientId: p.id, slotId: a.id, patientName: "Synthetic Patient", patientAge: 0 };
  const booked = data(await service().book(randomUUID(), booking));
  return { f, actor, deps, service, p, a, b, c, booked, booking };
}

test("staff reschedules atomically on the same date, preserves identity/token and records history", async () => {
  const h = await setup();
  const moved = data(await h.service("member").mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Later time" }));
  assert.equal(moved.appointmentId, h.booked.appointmentId); assert.equal(moved.patientId, h.p.id); assert.equal(moved.tokenNumber, h.booked.tokenNumber); assert.equal(moved.version, 2);
  const details = data(await h.service().getAppointment({ appointmentId: moved.appointmentId }));
  assert.equal(details.history.length, 1); assert.equal(details.history[0]?.previousSlotId, h.a.id);
  const slots = data(await h.service().listSlots(h.f.doctor.id, { from: "2026-10-15", to: "2026-10-16" }));
  assert.equal(slots.items.find(s => s.id === h.a.id)?.remainingCapacity, 1); assert.equal(slots.items.find(s => s.id === h.b.id)?.remainingCapacity, 0);
});
test("date changes allocate tokens without reusing the highest departed token", async () => {
  const h = await setup();
  const moved = data(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Next day" }));
  assert.equal(moved.appointmentDate, "2026-10-16"); assert.equal(moved.tokenNumber, 1);
  const next = data(await h.service().book(randomUUID(), h.booking)); assert.equal(next.tokenNumber, 2);
  const again = data(await h.service().mutate(moved.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 2, targetSlotId: h.b.id, reason: "Return" }));
  assert.equal(again.tokenNumber, 3); assert.equal(again.source, "manual"); assert.equal(again.callId, null);
});
test("mutation replay is durable, input-bound and stale receipts never describe a later state", async () => {
  const h = await setup(); const key = randomUUID(); const input = { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Later" };
  data(await h.service().mutate(h.booked.appointmentId, key, input));
  const replay = data(await h.service().mutate(h.booked.appointmentId, key, input)); assert.equal(replay.replayed, true); assert.equal(replay.notifications.reminder, "not_repeated");
  fails(await h.service().mutate(h.booked.appointmentId, key, { ...input, reason: "Changed" }), "MUTATION_REQUEST_CONFLICT");
  data(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "cancel", expectedVersion: 2, reason: "Cancel" }));
  fails(await h.service().mutate(h.booked.appointmentId, key, input), "MUTATION_REQUEST_CONFLICT");
});
test("booking replay after rescheduling fails rather than claiming the original slot", async () => {
  const h = await setup(); const key = randomUUID();
  const first = data(await h.service().book(key, { ...h.booking, slotId: h.b.id }));
  const replay = data(await h.service().book(key, { ...h.booking, slotId: h.b.id })); assert.equal(replay.replayed, true);
  data(await h.service().mutate(first.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Next" }));
  fails(await h.service().book(key, { ...h.booking, slotId: h.b.id }), "BOOKING_REQUEST_CONFLICT");
});
test("bad moves leave the original and history unchanged", async () => {
  const h = await setup(); const input = { action: "reschedule", expectedVersion: 1, reason: "Move" };
  fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { ...input, targetSlotId: h.a.id }), "RESCHEDULE_NO_CHANGE");
  fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { ...input, targetSlotId: randomUUID() }), "SLOT_NOT_FOUND");
  fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { ...input, targetSlotId: h.b.id, expectedVersion: 3 }), "APPOINTMENT_VERSION_CONFLICT");
  const other = await setup();
  fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { ...input, targetSlotId: other.b.id }), "SLOT_NOT_FOUND");
  const details = data(await h.service().getAppointment({ appointmentId: h.booked.appointmentId })); assert.equal(details.slotId, h.a.id); assert.equal(details.history.length, 0);
});
test("full blocked cancelled past and other-doctor destinations fail without releasing source", async () => {
  const h = await setup(); const move = (slotId: string) => h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, reason: "Move", targetSlotId: slotId });
  const secondDoctor = data(await h.service().createDoctor({ name: "Other Doctor", phoneNumber: "9000000099" }));
  const otherSlot = await insertFixtureSlot(database.db, h.f, { doctorId: secondDoctor.id, startTime: "11:00", endTime: "11:15" });
  fails(await move(otherSlot.id), "SAME_DOCTOR_REQUIRED");
  for (const status of ["blocked", "cancelled", "booked"] as const) { await database.db.update(schema.clinicSlots).set({ status }).where(eq(schema.clinicSlots.id, h.b.id)); fails(await move(h.b.id), "SLOT_UNAVAILABLE"); }
  await database.db.update(schema.clinicSlots).set({ status: "available" }).where(eq(schema.clinicSlots.id, h.b.id));
  data(await h.service().book(randomUUID(), { ...h.booking, slotId: h.b.id }));
  fails(await move(h.b.id), "SLOT_UNAVAILABLE");
  h.f.setNow("2026-10-15T04:00:00Z"); fails(await move(h.c.id), "APPOINTMENT_NOT_RESCHEDULABLE");
  assert.equal(data(await h.service().getAppointment({ appointmentId: h.booked.appointmentId })).slotId, h.a.id);
});
test("member can book/move/cancel but cannot manage doctors or schedules", async () => {
  const h = await setup();
  fails(await h.service("member").createDoctor({ name: "Another Doctor", phoneNumber: "9000000088" }), "CLINIC_ACCESS_DENIED");
  fails(await h.service("member").updateDoctor(h.f.doctor.id, { name: "Other" }), "CLINIC_ACCESS_DENIED");
  fails(await h.service("member").updateSlot(h.f.doctor.id, h.a.id, { maxPatients: 2 }), "CLINIC_ACCESS_DENIED");
  fails(await h.service("member").blockDate(h.f.doctor.id, { date: "2026-10-18" }), "CLINIC_ACCESS_DENIED");
  data(await h.service("member").mutate(h.booked.appointmentId, randomUUID(), { action: "cancel", expectedVersion: 1, reason: "Cancel" }));
  data(await h.service("member").book(randomUUID(), h.booking));
});
test("deactivation and blocking refuse bookings; cancellation releases the constraints", async () => {
  const h = await setup();
  fails(await h.service().updateDoctor(h.f.doctor.id, { isActive: false }), "DOCTOR_HAS_BOOKINGS");
  fails(await h.service().blockDate(h.f.doctor.id, { date: h.a.slotDate }), "DATE_HAS_BOOKINGS");
  data(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "cancel", expectedVersion: 1, reason: "Cancel" }));
  const blocked = data(await h.service().blockDate(h.f.doctor.id, { date: h.a.slotDate })); assert.equal(blocked.cancelledAppointments, 0);
  data(await h.service().unblockDate(h.f.doctor.id, blocked.blockedDateId));
  assert.equal(data(await h.service().updateDoctor(h.f.doctor.id, { isActive: false })).isActive, false);
});
test("doctor management is atomic, preserves contact roles and validates aliases", async () => {
  const h = await setup();
  fails(await h.service().createDoctor({ name: "Doctor Again", phoneNumber: "7000000001" }), "DOCTOR_PHONE_CONFLICT");
  fails(await h.service().createDoctor({ name: "New Doctor", phoneNumber: "9000000088", searchAliases: ["Name", " name "] }), "INVALID_CLINIC_INPUT");
  const d = data(await h.service().createDoctor({ name: "New Doctor", phoneNumber: "9000000088", nameEn: "New Doctor", nameAs: "ডাঃ নতুন", searchAliases: ["New"] }));
  const updated = data(await h.service().updateDoctor(d.id, { name: "Renamed Doctor" })); assert.equal(updated.name, "Renamed Doctor"); assert.deepEqual(updated.searchAliases, ["New"]);
  fails(await h.service().updateDoctor(d.id, { phoneNumber: "7000000001" }), "DOCTOR_PHONE_CONFLICT");
  const search = data(await h.service().listDoctors({ search: "renamed", pageSize: 1 })); assert.equal(search.pagination.total, 1);
});
test("generation conflicts roll back and schedule capacity cannot drop or reopen terminal slots", async () => {
  const h = await setup();
  fails(await h.service().updateSlot(h.f.doctor.id, h.a.id, { status: "cancelled" }), "SLOT_HAS_BOOKINGS");
  data(await h.service().updateSlot(h.f.doctor.id, h.a.id, { maxPatients: 2 }));
  data(await h.service().book(randomUUID(), h.booking));
  fails(await h.service().updateSlot(h.f.doctor.id, h.a.id, { maxPatients: 1 }), "SLOT_CONFLICT");
  data(await h.service().updateSlot(h.f.doctor.id, h.b.id, { status: "cancelled" }));
  fails(await h.service().updateSlot(h.f.doctor.id, h.b.id, { maxPatients: 3 }), "SLOT_CONFLICT");
  fails(await h.service().generateSlots(h.f.doctor.id, { weekdays: ["thursday"], startTime: "08:50", endTime: "09:20", durationMinutes: 15, horizonDays: 7, maxPatients: 1 }), "SLOT_CONFLICT");
  fails(await h.service().listSlots(h.f.doctor.id, { from: "2026-10-01", to: "2027-10-01" }), "INVALID_CLINIC_INPUT");
});
test("parallel moves and cancellation keep version, capacity and receipts consistent", async () => {
  const h = await setup();
  const results = await Promise.all([
    h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Move" }),
    h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "cancel", expectedVersion: 1, reason: "Cancel" }),
  ]);
  assert.equal(results.filter(r => r.success).length, 1);
  const a = data(await h.service().getAppointment({ appointmentId: h.booked.appointmentId })); assert.equal(a.version, 2);
  const rows = await database.db.select().from(schema.clinicMutationReceipts).where(eq(schema.clinicMutationReceipts.organizationId, h.f.organization.id)); assert.equal(rows.length, 1);
});
test("same-key simultaneous requests execute once", async () => {
  const h = await setup(); const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => h.service().mutate(h.booked.appointmentId, key, { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Move" })));
  assert.equal(results.filter(r => data(r).replayed === false).length, 1);
  assert.equal(data(await h.service().getAppointment({ appointmentId: h.booked.appointmentId })).history.length, 1);
});
test("booking versus move for last place produces exactly one winner", async () => {
  const h = await setup();
  const results = await Promise.all([h.service().book(randomUUID(), { ...h.booking, slotId: h.c.id }),
    h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Next day" })]);
  assert.equal(results.filter(r => r.success).length, 1);
  const rows = await database.db.select().from(schema.clinicAppointments).where(and(eq(schema.clinicAppointments.slotId, h.c.id), eq(schema.clinicAppointments.status, "booked"))); assert.equal(rows.length, 1);
});
test("opposing moves use sorted date locks and both fail safely on full destinations", async () => {
  const h = await setup(); const second = data(await h.service().book(randomUUID(), { ...h.booking, slotId: h.c.id }));
  const results = await Promise.all([
    h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Swap" }),
    h.service().mutate(second.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.a.id, reason: "Swap" }),
  ]); for (const r of results) fails(r, "SLOT_UNAVAILABLE");
});
test("booking versus deactivation never leaves a newly booked inactive doctor", async () => {
  const h = await setup(); data(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "cancel", expectedVersion: 1, reason: "Clear" }));
  const results = await Promise.all([h.service().book(randomUUID(), h.booking), h.service().updateDoctor(h.f.doctor.id, { isActive: false })]);
  assert.equal(results.filter(r => r.success).length, 1);
});
test("reschedule notification jobs carry version and only schedule after commit", async () => {
  const recorder = new RecordingClinicScheduler(); const h = await setup({ scheduler: recorder }); const before = recorder.snapshot().length;
  const key = randomUUID(); const input = { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Later" };
  data(await h.service().mutate(h.booked.appointmentId, key, input));
  const jobs = recorder.snapshot().slice(before); assert.equal(jobs.length, 2); assert.ok(jobs.every(j => j.appointmentVersion === 2 && j.jobId.includes("-v2-")));
  data(await h.service().mutate(h.booked.appointmentId, key, input)); assert.equal(recorder.snapshot().length, before + 2);
});
test("history insertion failure rolls back appointment, counter, capacity and receipts", async () => {
  const h = await setup();
  // Dedicated database only: force a real mid-transaction failure after appointment update.
  await database.pool.query("CREATE FUNCTION clinic_staff_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private failure'; END $$");
  await database.pool.query("CREATE TRIGGER clinic_staff_history_failure BEFORE INSERT ON clinic_reschedule_history FOR EACH ROW EXECUTE FUNCTION clinic_staff_reject_history()");
  try {
    fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Move" }), "CLINIC_OPERATION_FAILED");
    const a = data(await h.service().getAppointment({ appointmentId: h.booked.appointmentId })); assert.equal(a.version, 1); assert.equal(a.slotId, h.a.id);
    assert.equal((await database.db.select().from(schema.clinicMutationReceipts).where(eq(schema.clinicMutationReceipts.organizationId, h.f.organization.id))).length, 0);
    assert.equal((await database.db.select().from(schema.clinicTokenCounters).where(and(eq(schema.clinicTokenCounters.organizationId, h.f.organization.id), eq(schema.clinicTokenCounters.date, h.c.slotDate)))).length, 0);
  } finally { await database.pool.query("DROP TRIGGER clinic_staff_history_failure ON clinic_reschedule_history"); await database.pool.query("DROP FUNCTION clinic_staff_reject_history()"); }
});

test("failed reschedule scheduling does not undo the move or repeat work", async () => {
  let attempts = 0;
  const h = await setup({ scheduler: { async schedule() { attempts++; throw new Error("private provider detail"); } } });
  const prior = attempts; const key = randomUUID();
  const input = { action: "reschedule", expectedVersion: 1, targetSlotId: h.c.id, reason: "Move later" };
  const result = data(await h.service().mutate(h.booked.appointmentId, key, input));
  assert.equal(result.version, 2); assert.equal(result.slotId, h.c.id); assert.equal(result.notifications.reminder, "failed"); assert.equal(result.notifications.doctorAlert, "failed");
  assert.equal(attempts, prior + 2);
  data(await h.service().mutate(h.booked.appointmentId, key, input)); assert.equal(attempts, prior + 2);
});

test("staff logs retain operational actor metadata without patient input or private failures", async () => {
  const logs: unknown[] = [];
  const logger = { info: (message: string, metadata: Record<string, unknown>) => { logs.push({ message, metadata }); }, warn: (message: string, metadata: Record<string, unknown>) => { logs.push({ message, metadata }); }, error: (message: string, metadata: Record<string, unknown>) => { logs.push({ message, metadata }); } };
  const h = await setup({ logger });
  fails(await h.service().createDoctor({ name: "Private Doctor", phoneNumber: "7000000001" }), "DOCTOR_PHONE_CONFLICT");
  data(await h.service().mutate(h.booked.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Private medical reason" }));
  const text = JSON.stringify(logs); assert.ok(text.includes(h.actor.id));
  for (const sensitive of ["7000000001", "Private Doctor", "Synthetic Patient", "Private medical reason", "patientName", "phoneNumber"]) assert.equal(text.includes(sensitive), false);
});

test("non-booked appointment states and past destinations cannot move", async () => {
  const h = await setup();
  const input = { action: "reschedule", expectedVersion: 1, targetSlotId: h.b.id, reason: "Move" };
  for (const status of ["completed", "cancelled", "noshow"] as const) {
    await database.db.update(schema.clinicAppointments).set({ status }).where(eq(schema.clinicAppointments.id, h.booked.appointmentId));
    fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), input), "APPOINTMENT_NOT_RESCHEDULABLE");
  }
  await database.db.update(schema.clinicAppointments).set({ status: "booked" }).where(eq(schema.clinicAppointments.id, h.booked.appointmentId));
  const past = await insertFixtureSlot(database.db, h.f, { slotDate: "2026-10-12" });
  fails(await h.service().mutate(h.booked.appointmentId, randomUUID(), { ...input, targetSlotId: past.id }), "SLOT_UNAVAILABLE");
});
