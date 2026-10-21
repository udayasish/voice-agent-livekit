import { fixtureInterpreter } from "./helpers/confirmation-interpreter.js";
import { createConfirmationInterpreter, type ConfirmationInput, type ConfirmationInterpreter } from "../src/components/clinic/voice/interpreter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { z } from "zod";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { ClinicVoiceRuntime } from "../src/components/clinic/voice/runtime.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import { createTransactionWithHooks } from "../src/lib/db/transaction-with-hooks.js";
import { createStaffClinicServices } from "../src/components/clinic/services/staff.js";
import { inArray } from "drizzle-orm";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import type { LLMMessage } from "../src/components/agent/providers/llm/types.js";
import { createClinicFixture, insertFixtureSlot, openClinicTestDatabase, removeClinicFixtures, schema, eq, type ClinicFixture } from "./clinic-test-db.js";

let database: Awaited<ReturnType<typeof openClinicTestDatabase>>;
const organizations: string[] = [];
const staffActors: string[] = [];
before(async () => { database = await openClinicTestDatabase(); });
after(async () => { if (database) { try { await removeClinicFixtures(database.db, organizations); if (staffActors.length) await database.db.delete(schema.users).where(inArray(schema.users.id, staffActors)); } finally { await database.pool.end(); } } });
async function fixture() { const f = await createClinicFixture(database.db); organizations.push(f.organization.id); return f; }
type Step = { name: string; input: object | (() => object) };
class Driver {
  readonly runtime;
  readonly session;
  private steps: Step[] = [];
  private readonly provider;
  readonly callId = randomUUID();
  readonly limits = { timeoutMs: 5000 };
  emptyAnswer = false;
  constructor(readonly f: ClinicFixture, deps = f.deps, interpret: ConfirmationInterpreter = fixtureInterpreter) {
    const context = { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() };
    this.runtime = new ClinicVoiceRuntime(context, this.callId, randomUUID(), deps, "Asia/Kolkata", interpret);
    this.provider = new ScriptedProvider((_messages: LLMMessage[], count: number) => {
      const step = this.steps.shift();
      return step ? [{ type: "tool_call", toolCall: { id: `invoke_${count}`, name: step.name, arguments: JSON.stringify(typeof step.input === "function" ? step.input() : step.input) } }, { type: "done" }]
        : this.emptyAnswer ? [{ type: "done" }] : [{ type: "text", delta: `Ready for your next question ${count}.` }, { type: "done" }];
    });
    this.session = new AgentSession({ agentId: "clinic", name: "Reception", businessName: f.organization.name,
      instructions: "Use enabled clinic tools.", languages: ["as", "hi", "en"], defaultLanguage: "en", enabledTools: [...clinicToolNames] }, context,
    this.provider, this.runtime.behavior, { tools: { registry: this.runtime.registry, callId: this.callId, conversationId: this.runtime.conversationId, limits: this.limits } });
  }
  async turn(text: string, ...steps: Step[]) {
    this.steps = steps; const result = await this.session.processUserUtterance(text);
    await this.session.notifyPlaybackResult(result.turnId, true); return result;
  }
  async call(name: string, input: object, text = "Please help") {
    const result = await this.turn(text, { name, input });
    return this.session.getState().toolHistory.filter(c => c.turnId === result.turnId).at(-1)?.result
      ?? { success: false as const, error: { code: "CONFIRMATION_REQUIRED", message: "No business tool executed on this turn." } };
  }
  async caller(phone = "7002059544") {
    await this.call("resolve_clinic_and_caller", {}, phone);
    const result = await this.call("resolve_clinic_and_caller", {}, "হয় শুদ্ধ, নম্বৰটো শুদ্ধ।");
    assert.equal(result.success, true); assert.equal(this.runtime.snapshot().phoneConfirmed, true);
    assert.ok(this.runtime.snapshot().patientId);
  }
  async prepare(doctorId: string, slotId: string) {
    await this.call("list_doctors", {});
    await this.call("get_available_times", { doctorId, date: "2026-10-15" });
    const prepared = await this.call("book_appointment", { mode: "prepare", doctorId, slotId, patientName: "Synthetic Patient", patientAge: 24 });
    assert.equal(prepared.success, true);
    return this.runtime.snapshot().pendingDraftId!;
  }
}
const bookingData = z.object({ outcome: z.literal("booked"), appointment: z.object({ appointmentId: z.string(), tokenNumber: z.number(), appointmentDate: z.string(), doctorId: z.string(), notifications: z.object({ reminder: z.string(), doctorAlert: z.string() }) }) });
function unwrap<T>(result: { success: true; data: T } | { success: false; error: { code: string } }): T {
  if (!result.success) assert.fail(result.error.code); return result.data;
}
test("real SDK executes all eight tools, books/token/checks/cancels with Assamese confirmation and no login", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  const scheduler = new RecordingClinicScheduler();
  const d = new Driver(f, { ...f.deps, scheduler });
  try {
    await d.caller();
    const matches = z.object({ doctors: z.array(z.unknown()), outcome: z.literal("matched") }).parse(unwrap(await d.call("find_doctor", { name: "Dr. Asha Basu" }))); assert.equal(matches.doctors.length, 1);
    const dates = unwrap(await d.call("get_available_dates", { doctorId: f.doctor.id })); assert.deepEqual(z.object({ dates: z.array(z.string()) }).parse(dates).dates, [slot.slotDate]);
    const draftId = await d.prepare(f.doctor.id, slot.id);
    const result = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId }, "হয় শুদ্ধ।")));
    assert.equal(result.appointment.tokenNumber, 1);
    assert.match(d.session.getState().lastAssistantUtterance!, /টোকেন|Token/);
    const upcoming = z.array(z.object({ appointmentId: z.string() })).parse(unwrap(await d.call("check_my_appointments", {})));
    assert.equal(upcoming[0]!.appointmentId, result.appointment.appointmentId);
    await d.call("cancel_appointment", { mode: "prepare", appointmentId: result.appointment.appointmentId, reason: "Caller changed plans" });
    const cancelDraft = d.runtime.snapshot().pendingDraftId!;
    const cancellation = unwrap(await d.call("cancel_appointment", { mode: "confirm", draftId: cancelDraft }, "হয়।"));
    assert.equal(z.object({ outcome: z.string() }).parse(cancellation).outcome, "cancelled");
    assert.equal(z.array(z.unknown()).parse(unwrap(await d.call("check_my_appointments", {}))).length, 0);
    assert.equal(scheduler.snapshot().length, 2);
    const repeat = await d.call("cancel_appointment", { mode: "confirm", draftId: cancelDraft }); assert.equal(repeat.success, true);
    const row = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, result.appointment.appointmentId));
    assert.equal(row[0]!.source, "voice"); assert.equal(row[0]!.callId, d.callId); assert.equal(row[0]!.status, "cancelled");
  } finally { await d.session.close(); }
});

test("resolver preserves partial phone guidance and English digits complete the existing capture", async () => {
  const f = await fixture(), d = new Driver(f);
  try {
    await d.call("resolve_clinic_and_caller", {}, "হেল্ল'");
    const partial = await d.turn("7 double 0 2 0", { name: "resolve_clinic_and_caller", input: {} });
    assert.match(partial.text, /5 digits|5টা/u);
    assert.equal(d.runtime.snapshot().collectingPhone, true);
    await d.turn("5 9 5 double 4", { name: "resolve_clinic_and_caller", input: {} });
    assert.equal(d.runtime.snapshot().slots.phoneNumber, "7002059544");
    assert.equal(d.runtime.snapshot().collectingPhone, false);
    assert.equal(d.runtime.snapshot().phoneConfirmed, false);
    await d.call("resolve_clinic_and_caller", {}, "হয় শুদ্ধ।");
    assert.equal(d.runtime.snapshot().phoneConfirmed, true);
    assert.ok(d.runtime.snapshot().patientId);
  } finally { await d.session.close(); }
});
test("timeout after database commit reconciles the same draft; empty model output still speaks the verified token", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  let release!: () => void; let entered!: () => void;
  const committed = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const base = createTransactionWithHooks(database.db, f.deps.logger);
  let hold = false;
  const scheduler = new RecordingClinicScheduler();
  const d = new Driver(f, { ...f.deps, scheduler, transaction: async fn => { const result = await base(fn); if (hold) { entered(); await held; } return result; } });
  try {
    await d.caller(); const id = await d.prepare(f.doctor.id, slot.id); hold = true; d.limits.timeoutMs = 150;
    const pending = d.call("book_appointment", { mode: "confirm", draftId: id }, "yes");
    await committed;
    const timedOut = await pending; assert.equal(timedOut.success, false);
    if (!timedOut.success) assert.equal(timedOut.error.code, "TOOL_TIMEOUT");
    release(); hold = false; d.limits.timeoutMs = 5000; d.emptyAnswer = true;
    const retry = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: id }, "check the result")));
    assert.equal(retry.appointment.tokenNumber, 1);
    assert.match(d.session.getState().lastAssistantUtterance!, /Token 1|টোকেন নম্বৰ 1/u);
    assert.equal(scheduler.snapshot().length, 2);
    assert.equal((await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id))).length, 1);
  } finally { release(); await d.session.close(); }
});
test("phone corrections and cross-tenant IDs cannot reuse a prepared booking or cancellation grant", async () => {
  const f = await fixture(), other = await fixture();
  const slot = await insertFixtureSlot(database.db, f), foreign = await insertFixtureSlot(database.db, other); const d = new Driver(f);
  try {
    await d.caller();
    await d.call("list_doctors", {});
    assert.equal((await d.call("get_available_dates", { doctorId: other.doctor.id })).success, false);
    assert.equal((await d.call("get_available_times", { doctorId: f.doctor.id, date: foreign.slotDate })).success, true);
    assert.equal((await d.call("book_appointment", { mode: "prepare", doctorId: other.doctor.id, slotId: foreign.id, patientName: "Synthetic Patient", patientAge: 24 })).success, false);
    const id = await d.prepare(f.doctor.id, slot.id);
    await d.caller("8002059544");
    assert.equal((await d.call("book_appointment", { mode: "confirm", draftId: id }, "yes")).success, false);
    assert.equal(d.runtime.snapshot().pendingDraftId, null);
  } finally { await d.session.close(); }
});
test("prepare/unclear/negative/interrupted confirmation cannot book; same-turn model confirmation cannot authorize", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f); const d = new Driver(f);
  try {
    await d.caller(); const id = await d.prepare(f.doctor.id, slot.id);
    for (const text of ["maybe", "হয় নহয়", "yes tomorrow"]) {
      const result = await d.call("book_appointment", { mode: "confirm", draftId: id }, text); assert.equal(result.success, false);
    }
    await d.session.notifyInterruption(d.session.getSnapshot().session.turnCount);
    assert.equal((await d.call("book_appointment", { mode: "confirm", draftId: id }, "yes")).success, false);
    const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id)); assert.equal(rows.length, 0);
    await d.turn("Prepare again", { name: "book_appointment", input: { mode: "prepare", doctorId: f.doctor.id, slotId: slot.id, patientName: "Synthetic Patient", patientAge: 24 } },
      { name: "book_appointment", input: () => ({ mode: "confirm", draftId: d.runtime.snapshot().pendingDraftId }) });
    assert.equal(d.session.getState().toolHistory.at(-1)!.result.success, false);
  } finally { await d.session.close(); }
});
test("existing appointments need phone plus token/date and cannot disclose another booking; failures lock after three attempts", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f); const a = new Driver(f), b = new Driver(f);
  try {
    await a.caller(); const id = await a.prepare(f.doctor.id, slot.id);
    const booking = bookingData.parse(unwrap(await a.call("book_appointment", { mode: "confirm", draftId: id }, "yes"))).appointment;
    await b.caller(); assert.deepEqual(unwrap(await b.call("check_my_appointments", {})), []);
    assert.equal((await b.call("cancel_appointment", { mode: "prepare", appointmentId: booking.appointmentId, reason: "cancel" })).success, false);
    assert.equal((await b.call("check_my_appointments", { tokenNumber: 999, date: booking.appointmentDate })).success, false);
    const verified = z.array(z.object({ appointmentId: z.string() })).parse(unwrap(await b.call("check_my_appointments", { tokenNumber: booking.tokenNumber, date: booking.appointmentDate })));
    assert.equal(verified[0]!.appointmentId, booking.appointmentId);
    await b.caller("8002059544"); assert.deepEqual(unwrap(await b.call("check_my_appointments", {})), []);
    for (let n = 0; n < 3; n++) assert.equal((await b.call("check_my_appointments", { tokenNumber: booking.tokenNumber, date: booking.appointmentDate })).success, false);
    assert.equal(b.runtime.snapshot().authorizedAppointments.length, 0);
  } finally { await a.session.close(); await b.session.close(); }
});
test("two voice callers compete for last capacity; loser gets refreshed alternatives without an automatic booking", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f, { maxPatients: 1 });
  const alternate = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15", maxPatients: 1 });
  const a = new Driver(f), b = new Driver(f);
  try {
    await a.caller(); await b.caller("8002059544");
    const ai = await a.prepare(f.doctor.id, slot.id), bi = await b.prepare(f.doctor.id, slot.id);
    const results = await Promise.all([a.call("book_appointment", { mode: "confirm", draftId: ai }, "yes"), b.call("book_appointment", { mode: "confirm", draftId: bi }, "yes")]);
    const outcomes = results.map(r => z.object({ outcome: z.string() }).parse(unwrap(r)).outcome).sort(); assert.deepEqual(outcomes, ["booked", "unavailable"]);
    const loser = results.find(r => r.success && z.object({ outcome: z.string() }).parse(r.data).outcome === "unavailable")!;
    const alternatives = z.object({ times: z.array(z.object({ id: z.string() })) }).parse(unwrap(loser)); assert.equal(alternatives.times[0]!.id, alternate.id);
    const losingDriver = results[0]!.success && z.object({ outcome: z.string() }).parse(results[0]!.data).outcome === "unavailable" ? a : b;
    const lostDraft = losingDriver.runtime.snapshot().pendingDraftId!;
    const replay = await losingDriver.call("book_appointment", { mode: "confirm", draftId: lostDraft }, "yes");
    assert.equal(replay.success, false);
    const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id)); assert.equal(rows.length, 1);
  } finally { await a.session.close(); await b.session.close(); }
});
test("capacity allows two successful callers with increasing tokens; repeated drafts and service request keys do not duplicate jobs", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f, { maxPatients: 2 });
  const scheduler = new RecordingClinicScheduler(); const a = new Driver(f, { ...f.deps, scheduler }), b = new Driver(f, { ...f.deps, scheduler });
  try {
    await a.caller(); await b.caller("8002059544"); const ai = await a.prepare(f.doctor.id, slot.id), bi = await b.prepare(f.doctor.id, slot.id);
    const results = await Promise.all([a.call("book_appointment", { mode: "confirm", draftId: ai }, "yes"), b.call("book_appointment", { mode: "confirm", draftId: bi }, "yes")]);
    assert.deepEqual(results.map(r => bookingData.parse(unwrap(r)).appointment.tokenNumber).sort(), [1, 2]);
    await a.call("book_appointment", { mode: "confirm", draftId: ai });
    await a.call("book_appointment", { mode: "prepare", doctorId: f.doctor.id, slotId: slot.id, patientName: "Synthetic Patient", patientAge: 24 });
    assert.equal(scheduler.snapshot().length, 4);
    const existing = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.requestKey, ai));
    const request = f.services({ source: "voice", requestKey: ai });
    const input = { doctorId: f.doctor.id, slotId: slot.id, patientId: existing[0]!.patientId, patientName: "Synthetic Patient", patientAge: 24 };
    const replay = unwrap(await request.createAppointmentFromBooking(input));
    assert.equal(replay.appointmentId, existing[0]!.id);
    assert.equal(replay.notifications.reminder, "not_repeated");
    const conflict = await request.createAppointmentFromBooking({ ...input, patientAge: 25 }); assert.equal(conflict.success, false);
    assert.equal(scheduler.snapshot().length, 4);
  } finally { await a.session.close(); await b.session.close(); }
});
test("interruption after commit keeps one durable booking and replay returns it without new jobs", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  let release!: () => void; let entered!: () => void;
  const committed = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const base = createTransactionWithHooks(database.db, f.deps.logger);
  let hold = false;
  const d = new Driver(f, { ...f.deps, transaction: async fn => { const result = await base(fn); if (hold) { entered(); await held; } return result; } });
  try {
    await d.caller(); const id = await d.prepare(f.doctor.id, slot.id); hold = true;
    const pending = d.call("book_appointment", { mode: "confirm", draftId: id }, "yes");
    await committed; await d.session.notifyInterruption(d.session.getSnapshot().session.turnCount); release();
    await assert.rejects(pending);
    hold = false;
    const retry = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: id }, "please check")));
    const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id));
    assert.equal(rows.length, 1); assert.equal(rows[0]!.id, retry.appointment.appointmentId);
  } finally { release(); await d.session.close(); }
});
test("spoken name ambiguity is retained, missing details rejected, and a changed slot cannot bypass the spoken readback", async () => {
  const f = await fixture(); const slot = await insertFixtureSlot(database.db, f); const d = new Driver(f);
  try {
    const [person] = await database.db.insert(schema.clinicPeople).values({ organizationId: f.organization.id, phoneNumber: "9000000072", role: "doctor", name: "Another Basu" }).returning();
    await database.db.insert(schema.clinicDoctors).values({ organizationId: f.organization.id, personId: person!.id });
    await d.caller();
    const matches = z.object({ doctors: z.array(z.object({ id: z.string() })) }).parse(unwrap(await d.call("find_doctor", { name: "Dr. Basu" }))).doctors;
    assert.equal(matches.length, 2);
    assert.equal(z.object({ outcome: z.string() }).parse(unwrap(await d.call("find_doctor", { name: "Unknown doctor" }))).outcome, "not_found");
    await d.call("list_doctors", {}); await d.call("get_available_times", { doctorId: f.doctor.id, date: slot.slotDate });
    assert.equal((await d.call("book_appointment", { mode: "prepare", doctorId: f.doctor.id, slotId: slot.id })).success, false);
    const id = await d.prepare(f.doctor.id, slot.id);
    await database.db.update(schema.clinicSlots).set({ startTime: "09:30", endTime: "09:45" }).where(eq(schema.clinicSlots.id, slot.id));
    const result = unwrap(await d.call("book_appointment", { mode: "confirm", draftId: id }, "yes"));
    assert.equal(z.object({ outcome: z.string() }).parse(result).outcome, "unavailable");
    assert.equal((await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id))).length, 0);
    const next = await d.prepare(f.doctor.id, slot.id); assert.notEqual(id, next);
  } finally { await d.session.close(); }
});
test("concurrent first execution of one request key creates one appointment and schedules once", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f, { maxPatients: 30 });
  const patient = unwrap(await f.services().getOrCreatePatient({ phoneNumber: "7002059544" }));
  const scheduler = new RecordingClinicScheduler(), requestKey = randomUUID();
  const service = f.services({ requestKey, patientId: patient.id }, { scheduler });
  const input = { doctorId: f.doctor.id, slotId: slot.id, patientId: patient.id, patientName: "Synthetic Patient", patientAge: 24 };
  const results = await Promise.all(Array.from({ length: 8 }, () => service.createAppointmentFromBooking(input)));
  assert.equal(new Set(results.map(result => unwrap(result).appointmentId)).size, 1);
  assert.ok(results.every(result => unwrap(result).tokenNumber === 1));
  assert.equal(scheduler.snapshot().length, 2);
  const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id)); assert.equal(rows.length, 1);
});
test("a newer voice turn supersedes an in-flight committed action without a stale reply or duplicate booking", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  let release!: () => void; let entered!: () => void;
  const committed = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
  const base = createTransactionWithHooks(database.db, f.deps.logger); let hold = false;
  const d = new Driver(f, { ...f.deps, transaction: async fn => { const result = await base(fn); if (hold) { entered(); await held; } return result; } });
  try {
    await d.caller(); const id = await d.prepare(f.doctor.id, slot.id); hold = true;
    const pending = d.call("book_appointment", { mode: "confirm", draftId: id }, "yes");
    await committed; const oldTurn = d.session.getSnapshot().session.turnCount;
    const latest = await d.turn("Are you there?"); assert.ok(latest.turnId > oldTurn);
    release(); await assert.rejects(pending); hold = false;
    assert.equal(d.session.getHistory().some(message => message.role === "assistant" && message.turnId === oldTurn), false);
    const retry = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: id }, "please check")));
    assert.equal(retry.appointment.tokenNumber, 1);
    assert.equal((await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id))).length, 1);
  } finally { release(); await d.session.close(); }
});


test("contextual action correction invalidates the old draft; rejection never cancels a committed booking", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  const interpreter = createConfirmationInterpreter(new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as ConfirmationInput;
    const intent = input.text === "Change the date" ? "correct_action" : input.text === "No, keep my appointment" ? "reject" : "confirm";
    return [{ type: "text", delta: JSON.stringify({ intent, targetId: input.draft?.id ?? input.activeCandidateId, evidence: input.text, replacementText: null }) }];
  }));
  const d = new Driver(f, f.deps, interpreter);
  try {
    await d.caller(); const old = await d.prepare(f.doctor.id, slot.id);
    const before = d.session.getSnapshot().conversation.toolHistory.length;
    await d.turn("Change the date", { name: "book_appointment", input: { mode: "confirm", draftId: old } });
    assert.equal(d.runtime.snapshot().pendingDraftId, null);
    assert.equal(d.session.getSnapshot().conversation.toolHistory.length, before);
    assert.equal((await d.call("book_appointment", { mode: "confirm", draftId: old }, "yes")).success, false);
    const next = await d.prepare(f.doctor.id, slot.id); assert.notEqual(next, old);
    const booking = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: next }, "yes"))).appointment;
    await d.call("cancel_appointment", { mode: "prepare", appointmentId: booking.appointmentId, reason: "Caller requested cancellation" });
    const cancel = d.runtime.snapshot().pendingDraftId!;
    await d.turn("No, keep my appointment", { name: "cancel_appointment", input: { mode: "confirm", draftId: cancel } });
    assert.equal(d.runtime.snapshot().pendingDraftId, null);
    assert.equal((await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, booking.appointmentId)))[0]?.status, "booked");
    assert.equal(d.runtime.snapshot().completedActions.length, 1);
    await d.caller("8002059544");
    const facts = z.object({ bookingState: z.string() }).parse(JSON.parse(d.runtime.behavior.verifiedContext!(d.runtime.snapshot())));
    assert.equal(facts.bookingState, "not_booked_for_current_caller");
    assert.equal(d.runtime.snapshot().completedActions.length, 1);
  } finally { await d.session.close(); }
});

test("restoring even the same phone revokes patient grants and a pending cancellation until fresh confirmation", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f);
  const interpreter: ConfirmationInterpreter = async (input, signal) => input.text === "Keep the previous number" ? {
    intent: "restore_previous", targetId: input.activeCandidateId, evidence: input.text, replacementText: null,
  } : fixtureInterpreter(input, signal);
  const d = new Driver(f, f.deps, interpreter);
  try {
    await d.caller(); const id = await d.prepare(f.doctor.id, slot.id);
    const booking = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: id }, "yes"))).appointment;
    await d.call("cancel_appointment", { mode: "prepare", appointmentId: booking.appointmentId, reason: "Caller asks" });
    await d.turn("Keep the previous number");
    assert.equal(d.runtime.snapshot().slots.phoneNumber, "7002059544"); assert.equal(d.runtime.snapshot().phoneConfirmed, false);
    assert.equal(d.runtime.snapshot().patientId, null); assert.deepEqual(d.runtime.snapshot().authorizedAppointments, []);
    assert.equal(d.runtime.snapshot().pendingDraftId, null); assert.equal(d.runtime.snapshot().completedActions.length, 1);
    await d.call("resolve_clinic_and_caller", {}, "হয় শুদ্ধ।");
    assert.deepEqual(unwrap(await d.call("check_my_appointments", {})), []);
  } finally { await d.session.close(); }
});

test("staff rescheduling invalidates an earlier voice cancellation readback", async () => {
  const f = await fixture();
  const slot = await insertFixtureSlot(database.db, f);
  const target = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15" });
  const [actor] = await database.db.insert(schema.users).values({ name: "Synthetic Staff", email: `${randomUUID()}@test.invalid` }).returning();
  assert.ok(actor); staffActors.push(actor.id);
  const d = new Driver(f);
  try {
    await d.caller();
    const bookingDraft = await d.prepare(f.doctor.id, slot.id);
    const booked = bookingData.parse(unwrap(await d.call("book_appointment", { mode: "confirm", draftId: bookingDraft }, "হয় শুদ্ধ।")));
    await d.call("cancel_appointment", { mode: "prepare", appointmentId: booked.appointment.appointmentId, reason: "Caller cancellation" });
    const cancellationDraft = d.runtime.snapshot().pendingDraftId!;
    const staff = createStaffClinicServices({ organizationId: f.organization.id, actorId: actor.id, role: "owner" }, f.deps);
    const moved = await staff.mutate(booked.appointment.appointmentId, randomUUID(), { action: "reschedule", expectedVersion: 1, targetSlotId: target.id, reason: "Staff move" });
    assert.equal(moved.success, true);
    const cancellation = await d.call("cancel_appointment", { mode: "confirm", draftId: cancellationDraft }, "হয়।");
    assert.equal(cancellation.success, false);
    if (!cancellation.success) assert.equal(cancellation.error.code, "APPOINTMENT_VERSION_CONFLICT");
    const [row] = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, booked.appointment.appointmentId));
    assert.equal(row?.status, "booked"); assert.equal(row?.slotId, target.id); assert.equal(row?.version, 2);
  } finally { await d.session.close(); }
});
