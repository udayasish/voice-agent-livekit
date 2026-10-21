import { fixtureInterpreter } from "./helpers/confirmation-interpreter.js";
import { fixtureIntakeInterpreter } from "./helpers/intake-interpreter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { ClinicVoiceSession } from "../src/components/clinic/voice/session.js";
import { importDoctorMetadata, doctorMetadataReadiness } from "../src/components/clinic/services/doctor-metadata.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import { RecordingClinicScheduler } from "../src/components/clinic/notifications/recording-scheduler.js";
import { bytes } from "../src/components/agent/providers/llm/context-budget.js";
import { chatMessages } from "../src/components/agent/providers/llm/chat-protocol.js";
import { spokenDate, spokenTime } from "../src/components/clinic/voice/calendar.js";
import type { IntakeInput } from "../src/components/clinic/voice/intake.js";
import { z } from "zod";
import { LLMFailure } from "../src/components/agent/providers/llm/failure.js";
import { createClinicFixture, insertFixtureSlot, openClinicTestDatabase, removeClinicFixtures, schema, eq, type ClinicFixture } from "./clinic-test-db.js";

let database: Awaited<ReturnType<typeof openClinicTestDatabase>>;
const organizations: string[] = [];
before(async () => { database = await openClinicTestDatabase(); });
after(async () => { if (database) { try { await removeClinicFixtures(database.db, organizations); } finally { await database.pool.end(); } } });
async function fixture(options: Parameters<typeof createClinicFixture>[1] = {}) {
  const f = await createClinicFixture(database.db, options); organizations.push(f.organization.id);
  await importDoctorMetadata({ organizationId: f.organization.id, doctors: [{ doctorId: f.doctor.id, nameEn: "Dr. Baruah", nameAs: "ডাঃ বৰুৱা", searchAliases: ["Baruah", "Boruah", "বৰুৱা"] }] }, f.deps, false);
  return f;
}

test("confirmed phone binds through a server-planned empty resolver and advances past phone requests", async () => {
  const f = await fixture();
  const provider = new ScriptedProvider(() => [{ type: "text", delta: "Please provide your ten-digit phone number. Is that correct?" }, { type: "done" }]);
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { deps: f.deps, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], interpreter: fixtureInterpreter });
  try {
    const readback = await session.processUserUtterance("7002059544"); await session.notifyPlaybackResult(readback.turnId, true);
    const result = await session.processUserUtterance("yes");
    const state = session.getSnapshot().conversation.businessState;
    assert.equal(state.phoneConfirmed, true); assert.ok(state.patientId); assert.equal(state.collectingPhone, false);
    assert.doesNotMatch(result.text, /phone|নম্বৰ/u);
    const calls = session.getSnapshot().conversation.toolHistory.filter(c => c.turnId === result.turnId);
    assert.equal(calls.length, 1); assert.equal(calls[0]?.name, "resolve_clinic_and_caller");
    assert.equal(calls[0]?.arguments, "{}"); assert.equal(calls[0]?.result.success, true);
    assert.match(provider.options[0]?.systemPrompt ?? "", /"callerResolved":true/u);
  } finally { await session.close(); }
});
async function sessionFor(f: ClinicFixture, mode: "empty" | "error" | "irrelevant" | "natural" | "sdk" = "empty", enabledTools: string[] = [...clinicToolNames]) {
  const provider = new ScriptedProvider(() => {
    if (mode === "error") throw new Error("Private provider payload must not appear in logs");
    if (mode === "sdk") return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "not_enabled", arguments: "{}" } }, { type: "done" }];
    return mode === "empty" ? [{ type: "done" }] : [{ type: "text", delta: mode === "natural" ? "ডাঃ বৰুৱাক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?" : "Please say it again." }, { type: "done" }];
  });
  const events: unknown[] = [];
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools, deps: f.deps, logger: { event: (...args) => { events.push(args); } } });
  const process = session.processUserUtterance.bind(session);
  session.processUserUtterance = async (...args: Parameters<typeof process>) => { const result = await process(...args); await session.notifyPlaybackResult(result.turnId, true); return result; };
  return { session, provider, events };
}

test("reported full Assamese doctor request matches and patient introductions never become doctor searches", async () => {
  const f = await fixture();
  const provider = new ScriptedProvider(() => [{ type: "text", delta: "ডাঃ বৰুৱা উপলব্ধ আছে। দয়া কৰি আপোনাৰ নাম ক'ব।" }, { type: "done" }]);
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, intakeInterpreter: async input => ({ intent: "provide_details",
      name: { value: "উদয়চিছ বৰা", evidence: "উদয়চিছ বৰা", sourceTurn: input.turnId }, age: null,
      nextField: "age", reply: "আপোনাৰ বয়স কিমান?" }),
      callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps });
  try {
    const matched = await session.processUserUtterance("মই ডঃ বৰুৱাক দেখাব বিচাৰিছোঁ।");
    assert.equal(matched.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    assert.equal(matched.businessState.dialogue.latest?.outcome, "matched");
    assert.match(matched.text, /তাৰিখ/u);
    const missing = await session.processUserUtterance("ডঃ পাণ্ডে");
    assert.equal(missing.businessState.dialogue.selectedDoctor, null);
    assert.match(missing.text, /পোৱা নগ'ল/u);
    assert.doesNotMatch(missing.text, /আপোনাৰ নাম/u);
    const before = session.getState().toolHistory.length;
    const patient = await session.processUserUtterance("মোৰ নাম উদয়চিছ বৰা।");
    assert.equal(patient.businessState.intake.name?.value, "উদয়চিছ বৰা");
    assert.equal(session.getState().toolHistory.length, before);
    const retry = await session.processUserUtterance("মই ডঃ বৰুৱাক দেখাব বিচাৰো।");
    assert.equal(retry.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    assert.equal(retry.businessState.intake.name?.value, "উদয়চিছ বৰা");
    assert.match(retry.text, /তাৰিখ/u);
  } finally { await session.close(); }
});

test("reported day/date conversation uses selected identity, concise dates and available times", async () => {
  const f = await fixture({ now: "2026-10-17T00:00:00Z" });
  for (const date of ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]) await insertFixtureSlot(database.db, f, { slotDate: date });
  const { session, provider } = await sessionFor(f);
  try {
    await session.processUserUtterance("ডঃ বৰুৱা");
    const dates = await session.processUserUtterance("কিমান ডে'ত কোনটো কোনটো কোনটো ডে'ত এভেইলেবল আছে?");
    assert.equal(session.getState().toolHistory.at(-1)?.name, "get_available_dates");
    assert.equal(dates.businessState.dialogue.offeredDates.length, 3); assert.doesNotMatch(dates.text, /২১/);
    const times = await session.processUserUtterance("হয় দেওবাৰ ওঠৰ অক্টোবৰ।");
    assert.equal(session.getState().toolHistory.at(-1)?.name, "get_available_times");
    assert.equal(times.businessState.dialogue.selectedDate, "2026-10-18");
    assert.equal(times.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    assert.equal(times.businessState.lastReadFailure, null); assert.notEqual(times.failureCategory, "request_limit");
    assert.ok(provider.options.every(options => (options.tools?.length ?? 0) <= 1));
  } finally { await session.close(); }
});

test("mixed-language time and age answers preserve Assamese replies and real offered slot identities", async () => {
  const f = await fixture({ now: "2026-10-17T00:00:00Z" });
  const slot = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-18", startTime: "09:30", endTime: "09:45" });
  for (const text of ["nine thirty", "नौ तीस", "ন ত্ৰিশ", "নাইন থাৰ্টি"]) {
    const provider = new ScriptedProvider(messages => {
      if (!messages[0]?.content.startsWith('{"text"')) return [{ type: "done" }];
      const input = JSON.parse(messages[0].content) as IntakeInput;
      return [{ type: "text", delta: JSON.stringify({ intent: "provide_details",
        name: input.text === "উদয়চিছ বড়া" ? { quote: input.text, sourceTurn: input.turnId } : null,
        age: input.text === "টুৱেণ্টি8" ? { value: 28, evidence: input.text, sourceTurn: input.turnId } : null,
        nextField: input.text === "উদয়চিছ বড়া" ? "age" : "phone", reply: input.text === "উদয়চিছ বড়া" ? "আপোনাৰ বয়স কিমান?" : "আপোনাৰ ফোন নম্বৰটো কওক।" }) }];
    });
    const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
      { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps });
    try {
      await session.processUserUtterance("ডঃ বৰুৱা"); await session.processUserUtterance("কাইলৈ");
      const chosen = await session.processUserUtterance(text);
      assert.equal(chosen.businessState.dialogue.selectedSlotId, slot.id, text);
      assert.equal(session.getState().language, "as");
      await session.processUserUtterance("উদয়চিছ বড়া");
      const age = await session.processUserUtterance("টুৱেণ্টি8");
      assert.equal(age.businessState.intake.age?.value, 28); assert.equal(age.businessState.intake.name?.value, "উদয়চিছ বড়া");
      assert.equal(age.replySource, "model"); assert.equal(age.text, "আপোনাৰ ফোন নম্বৰটো কওক।");
      assert.equal(age.businessState.completedActions.length, 0);
    } finally { await session.close(); }
  }
});

test("early patient details, contextual date/time and corrected draft produce one confirmed booking", async () => {
  const f = await fixture({ now: "2026-10-17T00:00:00Z" });
  const slot = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-20", startTime: "09:30", endTime: "09:45" });
  let phase: "read" | "prepare" | "wait" | "confirm" = "read";
  let session: Awaited<ReturnType<typeof ClinicVoiceSession.create>>;
  const provider = new ScriptedProvider(messages => {
    const inputText = messages[0]?.content ?? "";
    if (inputText.startsWith('{"text"')) {
      const input = JSON.parse(inputText) as IntakeInput;
      const common = { name: null, age: null, nextField: "ready", reply: "বিৱৰণ লৈ বুকিঙৰ আগতে পৰীক্ষা কৰিব পাৰোঁ।" };
      if (input.text.includes("উদয়চিছ")) return [{ type: "text", delta: JSON.stringify({ ...common, intent: "provide_details", name: { quote: "উদয়চিছ বৰা", sourceTurn: input.turnId }, age: { value: 20, evidence: "২০", sourceTurn: input.turnId } }) }];
      if (input.text.includes("বয়স")) { const age = input.text.includes("২৮") ? 28 : 27; return [{ type: "text", delta: JSON.stringify({ ...common, intent: "correct_details", age: { value: age, evidence: age === 28 ? "২৮" : "২৭", sourceTurn: input.turnId } }) }]; }
      if (input.text === "মঙলবাৰ") return [{ type: "text", delta: JSON.stringify({ ...common, intent: "provide_details", nextField: "time", choice: { date: slot.slotDate, slotId: null, evidence: input.text } }) }];
      if (input.text === "নাইন ঠার্তি") return [{ type: "text", delta: JSON.stringify({ ...common, intent: "provide_details", choice: { date: null, slotId: slot.id, evidence: input.text } }) }];
      return [{ type: "text", delta: JSON.stringify({ ...common, intent: "other" }) }];
    }
    if (phase === "prepare") {
      phase = "wait"; const state = session.getSnapshot().conversation.businessState;
      return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "book_appointment", arguments: JSON.stringify({ mode: "prepare", doctorId: f.doctor.id, slotId: slot.id,
        patientName: state.intake.name?.value, patientAge: state.intake.age?.value }) } }];
    }
    if (phase === "confirm") { phase = "wait"; return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "book_appointment", arguments: JSON.stringify({ mode: "confirm", draftId: session.getSnapshot().conversation.businessState.pendingDraftId }) } }]; }
    return [{ type: "done" }];
  });
  session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() }, {
    enabledTools: [...clinicToolNames], callId: randomUUID(), conversationId: randomUUID(), deps: f.deps,
    interpreter: async input => ({ intent: input.draft && input.text.includes("বয়স") ? "correct_action" : "confirm",
      targetId: input.draft?.id ?? input.activeCandidateId, evidence: input.text, replacementText: null }),
  });
  const turn = async (text: string) => { const reply = await session.processUserUtterance(text); await session.notifyPlaybackResult(reply.turnId, true); return reply; };
  try {
    await turn("7002059544"); await turn("হয় শুদ্ধ");
    await turn("মোৰ নাম উদয়চিছ বৰা বয়স ২০"); await turn("নহয় মোৰ বয়স ২৭");
    await turn("ডঃ বৰুৱা"); await turn("available dates");
    await turn("মঙলবাৰ");
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedDate, slot.slotDate);
    const selected = await turn("নাইন ঠার্তি");
    assert.equal(selected.businessState.dialogue.selectedSlotId, slot.id);
    assert.equal(selected.businessState.intake.name?.value, "উদয়চিছ বৰা"); assert.equal(selected.businessState.intake.age?.value, 27);
    assert.doesNotMatch(selected.text, /নামটো কওক|বয়স কিমান/u);
    const refreshed = await turn("09:30");
    assert.equal(refreshed.replySource, "verified_tool"); assert.doesNotMatch(refreshed.text, /ৰোগীৰ.*নাম|বয়স.*কওক/u);
    assert.ok(session.getSnapshot().conversation.businessState.patientId);
    // The confirmed caller was already bound; prepare reuses that server binding.
    // The provider deliberately emits no prepare call for this turn.
    await turn("Please book");
    assert.ok(session.getSnapshot().conversation.businessState.patientId);
    const oldDraft = session.getSnapshot().conversation.businessState.pendingDraftId; assert.ok(oldDraft);
    phase = "prepare"; await turn("নহয় মোৰ বয়স ২৮");
    const newDraft = session.getSnapshot().conversation.businessState.pendingDraftId;
    assert.ok(newDraft); assert.notEqual(newDraft, oldDraft);
    assert.equal(session.getSnapshot().conversation.businessState.intake.age?.value, 28);
    assert.equal((await f.services().listUpcomingAppointmentsForPatient({ patientId: session.getSnapshot().conversation.businessState.patientId! })).success, true);
    assert.equal(session.getSnapshot().conversation.businessState.completedActions.length, 0);
    phase = "confirm"; const booked = await turn("হয় বুক কৰক");
    assert.match(booked.text, /টোকেন নম্বৰ 1/u);
    const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id));
    assert.equal(rows.length, 1); assert.equal(rows[0]?.patientAge, 28); assert.equal(rows[0]?.patientName, "উদয়চিছ বৰা");
  } finally { await session.close(); }
});

test("model-supplied conflicting doctor ID fails before clinic queries and recovery keeps the task", async () => {
  const f = await fixture(); let conflict = true, session: Awaited<ReturnType<typeof ClinicVoiceSession.create>>;
  let estimatedInput = 1000;
  let slotQueries = 0;
  const originalInfo = f.deps.logger.info.bind(f.deps.logger);
  f.deps.logger.info = (message, metadata) => { if (message === "Clinic operation started" && metadata?.["operation"] === "listAvailableSlots") slotQueries++; originalInfo(message, metadata); };
  const provider = new ScriptedProvider(messages => {
    const current = [...messages].reverse().find(m => m.role === "user")?.content;
    const done = { type: "done" as const, usage: { promptTokens: Math.ceil(estimatedInput * 1.05), completionTokens: 20 } };
    if (current === "continue" && conflict) { conflict = false; return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "get_available_times", arguments: JSON.stringify({ doctorId: randomUUID(), date: "2026-10-18" }) } }, done]; }
    return [{ type: "text", delta: current === "Why did it fail?" ? "The time lookup failed; Dr. Baruah is still selected. Shall I check the times again?" : "ডাঃ বৰুৱাক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?" }, done];
  });
  session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps,
      logger: { event: (event, _context, metadata) => { if (event === "context_prepared" && typeof metadata?.["estimatedInputTokens"] === "number") estimatedInput = metadata["estimatedInputTokens"]; } } });
  try {
    await session.processUserUtterance("ডঃ বৰুৱা");
    const failed = await session.processUserUtterance("continue");
    assert.notEqual(failed.failureCategory, "request_limit");
    const outcome = session.getState().toolHistory.at(-1)?.result;
    assert.equal(outcome?.success, false); if (outcome && !outcome.success) assert.equal(outcome.error.code, "DOCTOR_SELECTION_MISMATCH");
    assert.equal(slotQueries, 0);
    assert.equal(failed.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    const recovery = await session.processUserUtterance("Why did it fail?");
    assert.equal(recovery.replySource, "model"); assert.match(recovery.text, /still selected/);
    assert.equal(recovery.businessState.lastReadFailure?.code, "DOCTOR_SELECTION_MISMATCH");
    assert.equal(recovery.businessState.lastReadFailure?.date, "2026-10-18");
    const modelInput = provider.inputs.at(-1)!; assert.ok(modelInput.some(m => m.role === "user" && m.content === "continue"));
    assert.ok((provider.options.at(-1)?.tools?.length ?? 8) < 8);
  } finally { await session.close(); }
});

test("availability defaults to the selected doctor and rate recovery distinguishes this call's booking status", async () => {
  const f = await fixture({ now: "2026-10-17T00:00:00Z" }); await insertFixtureSlot(database.db, f, { slotDate: "2026-10-18" });
  let attempted = false;
  const provider = new ScriptedProvider(messages => {
    const user = [...messages].reverse().find(m => m.role === "user")?.content;
    if (user === "continue" && !attempted) { attempted = true; return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "get_available_times", arguments: '{"date":"2026-10-18"}' } }, { type: "done" }]; }
    if (user === "Has my booking been made?") throw new LLMFailure("rate_limit", 429, 5000);
    return [{ type: "text", delta: "ডাঃ বৰুৱাক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?" }, { type: "done" }];
  });
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps });
  try {
    await session.processUserUtterance("ডঃ বৰুৱা"); const times = await session.processUserUtterance("continue");
    assert.equal(times.businessState.dialogue.selectedDate, "2026-10-18"); assert.equal(times.businessState.lastReadFailure, null);
    assert.equal(session.getState().toolHistory.at(-1)?.result.success, true);
    const limited = await session.processUserUtterance("Has my booking been made?");
    assert.equal(limited.failureCategory, "rate_limit"); assert.match(limited.text, /নতুন বুকিং নিশ্চিত হোৱা নাই/);
    assert.equal(limited.businessState.completedActions.length, 0);
  } finally { await session.close(); }
});
test("migration and reviewed metadata preserve identities, source names, tenant isolation and atomic dry-run/import", async () => {
  const f = await fixture(), other = await fixture();
  const slot = await insertFixtureSlot(database.db, f);
  const p = await f.services().getOrCreatePatient({ phoneNumber: "7002059544" }); assert.equal(p.success, true); if (!p.success) return;
  const booking = await f.services().createAppointmentFromBooking({ doctorId: f.doctor.id, slotId: slot.id, patientId: p.data.id, patientName: "অপৰিবৰ্তিত নাম", patientAge: 25 }); assert.equal(booking.success, true);
  const manifest = { organizationId: f.organization.id, doctors: [{ doctorId: f.doctor.id, nameEn: "Dr. Reviewed", nameAs: "ডাঃ বৰুৱা", searchAliases: ["Reviewed"] }] };
  await importDoctorMetadata(manifest, f.deps); // default dry-run
  assert.equal((await database.db.select().from(schema.clinicDoctors).where(eq(schema.clinicDoctors.id, f.doctor.id)))[0]?.nameEn, "Dr. Baruah");
  await assert.rejects(importDoctorMetadata({ ...manifest, doctors: [...manifest.doctors, { ...manifest.doctors[0], doctorId: other.doctor.id }] }, f.deps, false));
  assert.equal((await database.db.select().from(schema.clinicDoctors).where(eq(schema.clinicDoctors.id, f.doctor.id)))[0]?.nameEn, "Dr. Baruah");
  await importDoctorMetadata(manifest, f.deps, false); await importDoctorMetadata(manifest, f.deps, false);
  const appointments = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, f.organization.id));
  assert.equal(appointments.length, 1); assert.equal(appointments[0]?.doctorId, f.doctor.id); assert.equal(appointments[0]?.patientName, "অপৰিবৰ্তিত নাম");
  assert.equal((await database.db.select().from(schema.clinicPeople).where(eq(schema.clinicPeople.id, f.person.id)))[0]?.name, "Asha Basu");
  assert.deepEqual(await doctorMetadataReadiness(f.organization.id, f.deps), { total: 1, missingEnglishNames: [] });
  await database.db.update(schema.clinicDoctors).set({ nameEn: null }).where(eq(schema.clinicDoctors.id, f.doctor.id));
  assert.deepEqual((await doctorMetadataReadiness(f.organization.id, f.deps)).missingEnglishNames, [f.doctor.id]);
});
test("Assamese, English and reviewed alias lookups resolve the same ID; ambiguity and inactive status remain explicit", async () => {
  const f = await fixture(), other = await fixture();
  for (const namePart of ["ডঃ বৰুৱা", "Dr. Baruah", "Dr. Boruah", " Asha  Basu ", "Boruah", "বৰুৱা", "বৰুৱাৰ", "বৰুৱাক"]) {
    const result = await f.services().findDoctorsByName({ namePart }); assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data.map(d => d.id), [f.doctor.id]);
  }
  await database.db.update(schema.clinicDoctors).set({ searchAliases: ["Boruah"] }).where(eq(schema.clinicDoctors.id, other.doctor.id));
  assert.equal((await f.services().findDoctorsByName({ namePart: "Boruah" })).success, true);
  const [person] = await database.db.insert(schema.clinicPeople).values({ organizationId: f.organization.id, name: "Second doctor", phoneNumber: "9000000002", role: "doctor" }).returning();
  const [second] = await database.db.insert(schema.clinicDoctors).values({ organizationId: f.organization.id, personId: person!.id, searchAliases: ["Boruah"] }).returning();
  const { session } = await sessionFor(f);
  try {
    const reply = await session.processUserUtterance("Dr. Boruah");
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedDoctor, null); assert.match(reply.text, /একাধিক/u);
    await database.db.update(schema.clinicDoctors).set({ isActive: false }).where(eq(schema.clinicDoctors.id, second!.id));
    await database.db.update(schema.clinicDoctors).set({ isActive: false }).where(eq(schema.clinicDoctors.id, f.doctor.id));
    await session.processUserUtterance("Dr. Boruah");
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.latest?.outcome, "inactive");
  } finally { await session.close(); }
});
test("reported conversation lists doctors, handles missing/specialist names, selects Baruah and continues calendar requests", async () => {
  const f = await fixture(); await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15" });
  const { session, provider } = await sessionFor(f);
  try {
    for (const text of ["কোন ডক্টৰ এভেইলেবল আছে?", "এভেইলেবল কোন কোন আছে?"]) {
      const reply = await session.processUserUtterance(text); assert.match(reply.text, /বৰুৱা/u); assert.equal(reply.replySource, "verified_tool");
      assert.equal(session.getSnapshot().conversation.toolHistory.at(-1)?.name, "list_doctors");
    }
    const specialty = await session.processUserUtterance("গেছৰ'ল'জি"); assert.match(specialty.text, /পোৱা নগ'ল/u); assert.match(specialty.text, /বৰুৱা/u);
    await session.processUserUtterance("ডঃ পাণ্ডে"); assert.equal(session.getSnapshot().conversation.businessState.dialogue.latest?.outcome, "not_found");
    const matched = await session.processUserUtterance("ডঃ বৰুৱা"); assert.match(matched.text, /বৰুৱা/u); assert.match(matched.text, /তাৰিখ/u);
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    assert.equal(session.getSlots().doctor, "ডাঃ বৰুৱা");
    const alias = await session.processUserUtterance("Dr. Boruah"); assert.match(alias.text, /বৰুৱা/u); assert.equal(session.getState().language, "as");
    const dates = await session.processUserUtterance("কোন তাৰিখ উপলব্ধ?"); assert.match(dates.text, /উপলব্ধ/u);
    const times = await session.processUserUtterance("মোক পৰহিলে ৰাতিপুৱা দহ বজাত লাগে"); assert.equal(times.businessState.dialogue.selectedDate, "2026-10-15");
    assert.ok(times.businessState.dialogue.selectedSlotId);
    const last = session.getSnapshot().conversation.toolHistory.at(-1)!; assert.equal(last.name, "get_available_times");
    assert.equal(provider.inputs.length, session.getHistory().filter(m => m.role === "user").length);
  } finally { await session.close(); }
});
for (const mode of ["empty", "error", "irrelevant", "sdk"] as const) test(`verified lookup survives ${mode} generation without repeating execution or misleading speech`, async () => {
  const f = await fixture(); const { session, provider, events } = await sessionFor(f, mode);
  try {
    const reply = await session.processUserUtterance("ডঃ বৰুৱা");
    assert.equal(reply.replySource, "verified_tool"); assert.match(reply.text, /বৰুৱা/u); assert.doesNotMatch(reply.text, /আকৌ.*কওক|আকৌ.*ক'ব/u);
    assert.equal(session.getSnapshot().conversation.toolHistory.length, 1); assert.equal(provider.inputs.length, 1);
    assert.equal(session.getHistory().at(-1)?.content, reply.text);
    assert.equal(JSON.stringify(events).includes("Private provider payload"), false);
  } finally { await session.close(); }
});
test("natural grounded wording is preserved; disabled planned reads never call a tool", async () => {
  const f = await fixture(), natural = await sessionFor(f, "natural"), disabled = await sessionFor(f, "empty", ["find_doctor"]);
  try {
    const reply = await natural.session.processUserUtterance("ডঃ বৰুৱা"); assert.equal(reply.replySource, "model"); assert.equal(reply.text, "ডাঃ বৰুৱাক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?");
    const denied = await disabled.session.processUserUtterance("Which doctors are available?");
    assert.match(denied.text, /সক্ৰিয় কৰা হোৱা নাই/u); assert.equal(disabled.session.getSnapshot().conversation.toolHistory.length, 0);
    assert.ok(disabled.provider.options.every(options => !options.tools?.length));
  } finally { await natural.session.close(); await disabled.session.close(); }
});

test("interrupted read replies retain known doctor selection but cannot commit stale speech after supersession", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const provider = new ScriptedProvider(() => [{ type: "done" }]);
  provider.generate = async function* () {
    if (first) { first = false; entered(); await held; }
    yield { type: "done" };
  };
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps });
  try {
    const firstTurn = session.processUserUtterance("ডঃ বৰুৱা");
    await waiting;
    const second = await session.processUserUtterance("কোন তাৰিখ উপলব্ধ?");
    assert.equal(second.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    release(); await assert.rejects(firstTurn);
    assert.equal(session.getHistory().filter(m => m.role === "assistant").length, 1);
    await session.notifyInterruption(second.turnId);
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    assert.equal(session.getHistory().at(-1)?.interrupted, true);
  } finally { release(); await session.close(); }
});

test("relative dates use clinic-local day near UTC midnight and cannot invent availability", async () => {
  const f = await fixture({ now: "2026-10-13T20:00:00Z", timezone: "Asia/Kolkata" });
  const slot = await insertFixtureSlot(database.db, f, { slotDate: "2026-10-15", startTime: "10:00", endTime: "10:15" });
  const { session } = await sessionFor(f);
  try {
    await session.processUserUtterance("ডঃ বৰুৱা");
    const reply = await session.processUserUtterance("কাইলৈ ৰাতিপুৱা দহ বজাত");
    assert.equal(reply.businessState.dialogue.selectedDate, "2026-10-15"); assert.equal(reply.businessState.dialogue.selectedSlotId, slot.id);
    const unavailable = await session.processUserUtterance("2026-10-16 at 10 am");
    assert.equal(unavailable.businessState.dialogue.latest?.outcome, "no_availability"); assert.equal(unavailable.businessState.dialogue.selectedSlotId, null);
    assert.match(unavailable.text, /পোৱা নগ'ল/u);
  } finally { await session.close(); }
});

test("updated browser-session adapter completes alias/date/phone/draft/booking/token/lookup/cancellation with source scheduling", async () => {
  const f = await fixture(), slot = await insertFixtureSlot(database.db, f, { startTime: "10:00", endTime: "10:15" });
  const scheduler = new RecordingClinicScheduler();
  let steps: Array<{ name: string; input: object }> = [];
  const provider = new ScriptedProvider((_messages, index) => {
    const step = steps.shift();
    return step ? [{ type: "tool_call", toolCall: { id: `step_${index}`, name: step.name, arguments: JSON.stringify(step.input) } }, { type: "done" }] : [{ type: "done" }];
  });
  const session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, intakeInterpreter: fixtureIntakeInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: { ...f.deps, scheduler } });
  const turn = async (text: string, ...next: typeof steps) => { steps = next; const response = await session.processUserUtterance(text); await session.notifyPlaybackResult(response.turnId, true); return response; };
  const result = () => {
    const r = session.getSnapshot().conversation.toolHistory.at(-1)!.result; if (!r.success) assert.fail(r.error.code); return r.data;
  };
  try {
    await turn("Which doctors are available?");
    await turn("Dr. Boruah"); assert.equal(session.getSlots().doctor, "ডাঃ বৰুৱা");
    await turn("পৰহিলে ৰাতিপুৱা দহ বজাত"); assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedSlotId, slot.id);
    await turn("7002059544", { name: "resolve_clinic_and_caller", input: {} });
    await turn("হয় শুদ্ধ।", { name: "resolve_clinic_and_caller", input: {} });
    assert.ok(session.getSnapshot().conversation.businessState.patientId);
    await turn("নাম Synthetic Patient, বয়স 24", { name: "book_appointment", input: { mode: "prepare", doctorId: f.doctor.id, slotId: slot.id, patientName: "Synthetic Patient", patientAge: 24 } });
    const draftId = session.getSnapshot().conversation.businessState.pendingDraftId!;
    const booked = await turn("হয় বুক কৰক।", { name: "book_appointment", input: { mode: "confirm", draftId } });
    assert.match(booked.text, /টোকেন নম্বৰ 1/u);
    const booking = z.object({ outcome: z.literal("booked"), appointment: z.object({ appointmentId: z.string(), tokenNumber: z.number() }) }).parse(result());
    assert.equal(booking.appointment.tokenNumber, 1); assert.equal(scheduler.snapshot().length, 2);
    await turn("Check my appointment", { name: "check_my_appointments", input: {} });
    assert.equal(z.array(z.object({ appointmentId: z.string() })).parse(result())[0]?.appointmentId, booking.appointment.appointmentId);
    await turn("Cancel my appointment", { name: "cancel_appointment", input: { mode: "prepare", appointmentId: booking.appointment.appointmentId, reason: "Synthetic test complete" } });
    const cancelDraft = session.getSnapshot().conversation.businessState.pendingDraftId!;
    await turn("হয় বাতিল কৰক।", { name: "cancel_appointment", input: { mode: "confirm", draftId: cancelDraft } });
    assert.equal(z.object({ outcome: z.string() }).parse(result()).outcome, "cancelled");
    assert.equal((await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.id, booking.appointment.appointmentId)))[0]?.status, "cancelled");
  } finally { await session.close(); }
});

test("reported Assamese intake with twelve slots stays below half the old reconstructed request size", async () => {
  const f = await fixture({ now: "2026-10-16T00:00:00Z" });
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const minutes = 9 * 60 + i * 15;
    slots.push(await insertFixtureSlot(database.db, f, { slotDate: "2026-10-17", startTime: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
      endTime: `${Math.floor((minutes + 15) / 60)}:${String((minutes + 15) % 60).padStart(2, "0")}`, maxPatients: 5 }));
  }
  const selected = slots[4]!;
  let phase = "conversation", session: Awaited<ReturnType<typeof ClinicVoiceSession.create>>;
  const provider = new ScriptedProvider(messages => {
    const user = [...messages].reverse().find(m => m.role === "user")!.content;
    if (user.startsWith('{"text"')) {
      const input = JSON.parse(user) as IntakeInput;
      return [{ type: "text", delta: JSON.stringify({ intent: "provide_details", name: { quote: "উদয় আশীষ বৰা", sourceTurn: input.turnId },
        age: { value: 28, evidence: "২৮", sourceTurn: input.turnId }, nextField: "phone", reply: "ধন্যবাদ। আপোনাৰ ফোন নম্বৰটো ইংৰাজীত কওক।" }) }, { type: "done" }];
    }
    if (phase === "phone") {
      phase = "readback";
      return [{ type: "done" }];
    }
    if (phase === "confirm") {
      phase = "booked";
      return [{ type: "tool_call", toolCall: { id: randomUUID(), name: "book_appointment", arguments: JSON.stringify({ mode: "confirm", draftId: session.getSnapshot().conversation.businessState.pendingDraftId }) } }, { type: "done" }];
    }
    if (phase === "readback" || phase === "booked") return [{ type: "done" }];
    const tool = [...messages].reverse().find(m => m.role === "tool");
    let text = "আপুনি কোনজন চিকিৎসক বিচাৰে?";
    if (tool?.content.includes('"matched"') || tool?.content.includes('"listed"')) text = "ডাঃ বৰুৱাক পালোঁ। আপুনি কোন তাৰিখে যাব বিচাৰে?";
    if (tool?.content.includes('"times_available"')) text = `${spokenDate("2026-10-17", "as")}ত ${spokenTime("10:00", "as")} উপলব্ধ। ৰোগীৰ নামটো কওক।`;
    return [{ type: "text", delta: text }, { type: "done" }];
  });
  session = await ClinicVoiceSession.create(provider, { organizationId: f.organization.id, agentId: "clinic", sessionId: randomUUID() },
    { interpreter: fixtureInterpreter, callId: randomUUID(), conversationId: randomUUID(), enabledTools: [...clinicToolNames], deps: f.deps });
  const turn = async (text: string) => { const result = await session.processUserUtterance(text); await session.notifyPlaybackResult(result.turnId, true); return result; };
  try {
    await turn("হেল্ল'"); await turn("মোক কাইলৈ বুকিং লাগে।");
    await turn("বৰুৱা।"); assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedDoctor?.id, f.doctor.id);
    await turn("কাইলৈ উপলব্ধ সময় কওক");
    const time = await turn("ৰাতিপুৱা দহ বজাত"); assert.equal(time.replySource, "model");
    assert.equal(session.getSnapshot().conversation.businessState.dialogue.selectedSlotId, selected.id);
    const intake = await turn("মোৰ নাম উদয় আশীষ বৰা আৰু বয়স ২৮।"); assert.equal(intake.replySource, "model");
    assert.equal(intake.businessState.intake.age?.value, 28); assert.equal(intake.businessState.intake.name?.value, "উদয় আশীষ বৰা");
    await turn("7 double 0 2 0 5 9 5 double 4"); phase = "phone";
    await turn("হয় শুদ্ধ।"); assert.ok(session.getSnapshot().conversation.businessState.patientId);
    await turn("Please book"); assert.ok(session.getSnapshot().conversation.businessState.pendingDraftId);
    phase = "confirm";
    const booked = await turn("হয় বুক কৰক।"); assert.match(booked.text, /টোকেন নম্বৰ 1/u);
    assert.equal(session.getVoiceDiagnostics().confirmationStage, "confirmed");
    let maximum = 0;
    for (let i = 0; i < provider.inputs.length; i++) {
      const options = provider.options[i]!;
      const wire = { model: "qwen/qwen3.8-27b", messages: chatMessages(provider.inputs[i]!, options.systemPrompt), max_completion_tokens: options.maxTokens,
        ...(options.tools?.length ? { tools: options.tools.map(tool => ({ type: "function", function: tool })) } : {}), stream: true };
      maximum = Math.max(maximum, bytes(wire));
    }
    assert.ok(maximum <= 20928 / 2, `Reconstructed maximum ${maximum} bytes exceeds the 50% reduction target`);
    console.log(JSON.stringify({ contextRegression: "twelve-slot-intake", maxReconstructedRequestBytes: maximum, oldReconstructedBaselineBytes: 20928 }));
  } finally { await session.close(); }
});
