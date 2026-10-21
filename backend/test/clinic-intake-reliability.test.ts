import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { ClinicVoiceRuntime } from "../src/components/clinic/voice/runtime.js";
import { applyIntakeDecision, compactIntakeInput, createIntakeInterpreter, emptyIntake, materializeIntakeDecision, validateIntakeDecision, type IntakeInterpreter, type IntakeInput } from "../src/components/clinic/voice/intake.js";
import { GroqLLMProvider } from "../src/components/agent/providers/llm/groq.js";
import { spokenNumber } from "../src/components/clinic/voice/spoken-numbers.js";
import { z } from "zod";
import { MemorySessionStore } from "../src/components/agent/engine/store.js";
import { bytes } from "../src/components/agent/providers/llm/context-budget.js";
import { conciseClinicSpeech } from "../src/components/clinic/voice/speech-style.js";
import { hasUnverifiedNumericDate, calendarRequest } from "../src/components/clinic/voice/calendar.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import type { Database } from "../src/lib/db/transaction-with-hooks.js";

function harness(interpret: IntakeInterpreter) {
  const context = { organizationId: randomUUID(), agentId: "clinic", sessionId: randomUUID() };
  const events: unknown[] = [];
  const runtime = new ClinicVoiceRuntime(context, randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("No DB operations in this test"); },
    logger: { info: (...args) => { events.push(args); }, warn() {}, error() {} } }, "Asia/Kolkata",
    async input => ({ intent: "confirm", targetId: input.activeCandidateId, evidence: input.text, replacementText: null }), interpret);
  const provider = new ScriptedProvider(() => [{ type: "text", delta: "Which doctor would you prefer?" }, { type: "done" }]);
  const store = new MemorySessionStore();
  const session = new AgentSession({ agentId: "clinic", name: "Clinic", businessName: "Clinic", instructions: "Help", languages: ["as", "en"], defaultLanguage: "en" }, context, provider, runtime.behavior, { store });
  return { runtime, provider, session, events, store, context };
}
const candidate = (value: string, turnId: number) => ({ value, evidence: value, sourceTurn: turnId });
const nothing = { intent: "other" as const, name: null, age: null, nextField: "ready" as const, reply: "Which doctor would you prefer?" };

test("early name and age persist before any doctor/date/slot selection, with one interpretation", async () => {
  let calls = 0;
  const h = harness(async input => { calls++; return { intent: "provide_details", name: candidate("উদয়চিছ বৰা", input.turnId),
    age: { value: 20, evidence: "twenty", sourceTurn: input.turnId }, nextField: "phone", reply: "What phone number should we use?" }; });
  try {
    const reply = await h.session.processUserUtterance("মোৰ নাম উদয়চিছ বৰা বয়স twenty");
    assert.equal(h.runtime.snapshot().intake.name?.value, "উদয়চিছ বৰা");
    assert.equal(h.runtime.snapshot().intake.age?.value, 20);
    assert.equal(reply.replySource, "model"); assert.equal(calls, 1); assert.equal(h.provider.inputs.length, 0);
    await h.session.notifyInterruption(reply.turnId);
    assert.equal(h.runtime.snapshot().intake.age?.value, 20);
    assert.equal(h.runtime.snapshot().pendingDraftId, null);
    assert.doesNotMatch(JSON.stringify(h.events), /উদয়চিছ|twenty/);
  } finally { await h.session.close(); }
});

test("explicit age rejection without replacement disputes the candidate; a later numeric correction resolves it", async () => {
  const h = harness(async input => input.turnId === 1 ? { intent: "provide_details", name: candidate("Udoy Bora", 1), age: { value: 20, evidence: "20", sourceTurn: 1 }, nextField: "phone", reply: "Phone please?" }
    : input.turnId === 2 ? { intent: "correct_details", name: null, age: null, disputedFields: ["age"], evidence: input.text, nextField: "age", reply: "What is the correct age? Please say the digits separately." }
    : { intent: "correct_details", name: null, age: { value: 27, evidence: "27", sourceTurn: input.turnId }, nextField: "phone", reply: "What phone number should we use?" });
  try {
    await h.session.processUserUtterance("My name is Udoy Bora age 20");
    // A request for phone must still allow the caller to correct an earlier age.
    await h.session.processUserUtterance("No, my age is not twenty");
    assert.equal(h.runtime.snapshot().intake.age?.value, 20);
    assert.equal(h.runtime.snapshot().intake.unresolvedAge, true);
    assert.equal(h.runtime.snapshot().intake.name?.value, "Udoy Bora");
    await h.session.processUserUtterance("My age is 27");
    assert.equal(h.runtime.snapshot().intake.age?.value, 27);
    assert.equal(h.runtime.snapshot().intake.unresolvedAge, false);
  } finally { await h.session.close(); }
});

test("no-progress extraction retains evidence and changes repeated clarification", async () => {
  const h = harness(async () => ({ intent: "provide_details", name: null, age: null, nextField: "name", reply: "Tell me your name." }));
  h.runtime.dialogue.state.question = "patient";
  try {
    const first = await h.session.processUserUtterance("Udoy Bora");
    const second = await h.session.processUserUtterance("Udoy Bora.");
    assert.notEqual(second.text, first.text);
    assert.equal(h.runtime.snapshot().intake.pending.length, 2);
    assert.equal(h.runtime.snapshot().intake.nonProgress, 2);
    assert.equal(h.runtime.snapshot().intake.name, null);
    assert.match(second.text, /spell|বানান/u);
  } finally { await h.session.close(); }
});

test("real SDK validates explicit disputes and rejects invented correction evidence", async () => {
  for (const evidence of ["not twenty", "not actually said"]) {
    const provider = new ScriptedProvider(() => [{ type: "text", delta: JSON.stringify({ intent: "correct_details", name: null, age: null,
      disputedFields: ["age"], evidence, nextField: "age", reply: "Please give the correct age in digits." }) }]);
    const result = await createIntakeInterpreter(provider)({ text: "My age is not twenty", turnId: 2, language: "en", state: emptyIntake(), phoneConfirmed: true }, new AbortController().signal);
    assert.equal(result !== null, evidence === "not twenty"); assert.equal(provider.inputs.length, 1);
  }
});

test("contextual option interpretation selects only offered dates/slots before speech", async () => {
  const doctorId = randomUUID(), slotId = randomUUID();
  const h = harness(async input => ({ ...nothing, intent: "provide_details", choice: { date: "2026-10-20", slotId: null, evidence: input.text }, nextField: "time", reply: "Which time would you prefer?" }));
  h.runtime.dialogue.state.selectedDoctor = { id: doctorId, name: "Dr. Baruah", isActive: true };
  h.runtime.dialogue.dates(1, ["2026-10-18", "2026-10-19", "2026-10-20"]);
  try {
    await h.session.processUserUtterance("মঙলবাৰ");
    assert.equal(h.runtime.snapshot().dialogue.selectedDate, "2026-10-20");
    assert.equal(h.runtime.snapshot().intake.name, null);
    // A model cannot select an unknown slot, even with valid utterance evidence.
    const invalid = harness(async input => ({ ...nothing, choice: { date: null, slotId, evidence: input.text }, nextField: "ready" }));
    invalid.runtime.dialogue.state.selectedDoctor = { id: doctorId, name: "Dr. Baruah", isActive: true };
    invalid.runtime.dialogue.state.question = "time";
    invalid.runtime.dialogue.state.selectedDate = "2026-10-20";
    invalid.runtime.dialogue.state.offeredSlots = [{ id: randomUUID(), slotDate: "2026-10-20", startTime: "09:00", endTime: "09:15", maxPatients: 30, remainingCapacity: 30 }];
    try { await invalid.session.processUserUtterance("নাইন ঠার্তি"); assert.equal(invalid.runtime.snapshot().dialogue.selectedSlotId, null); }
    finally { await invalid.session.close(); }
  } finally { await h.session.close(); }
});

test("the interpreter receives retained fields and bounded pending evidence after context compaction", async () => {
  const inputs: IntakeInput[] = [];
  const h = harness(async input => { inputs.push(input); return input.turnId === 1 ? { intent: "provide_details", name: candidate("Udoy Bora", 1),
    age: { value: 27, evidence: "27", sourceTurn: 1 }, nextField: "phone", reply: "What phone number should we use?" } : nothing; });
  try {
    await h.session.processUserUtterance("name Udoy Bora age 27");
    for (let i = 0; i < 10; i++) await h.session.processUserUtterance("Which doctor is available?");
    await h.session.processUserUtterance("I already gave my name and age");
    assert.equal(inputs.at(-1)?.state.name?.value, "Udoy Bora");
    assert.equal(inputs.at(-1)?.state.age?.value, 27);
    assert.ok((inputs.at(-1)?.history?.length ?? 0) <= 4);
  } finally { await h.session.close(); }
});

test("confirmed phone followed by early name/age capture and correction survives doctor selection", async () => {
  const h = harness(async input => ({ intent: input.turnId === 4 ? "correct_details" : "provide_details", name: input.turnId === 3 ? candidate("উদয়চিছ বৰা", 3) : null,
    age: { value: input.turnId === 3 ? 20 : 27, evidence: input.turnId === 3 ? "২০" : "২৭", sourceTurn: input.turnId }, nextField: "doctor", reply: "Which doctor would you prefer?" }));
  try {
    const phone = await h.session.processUserUtterance("7002059544"); await h.session.notifyPlaybackResult(phone.turnId, true);
    await h.session.processUserUtterance("হয় শুদ্ধ"); assert.equal(h.runtime.snapshot().phoneConfirmed, true);
    const callsBeforeIntake = h.provider.inputs.length;
    await h.session.processUserUtterance("মোৰ নাম উদয়চিছ বৰা বয়স ২০");
    await h.session.processUserUtterance("নহয় মোৰ বয়স ২৭");
    assert.equal(h.provider.inputs.length, callsBeforeIntake, "ordinary intake must not require a second generation");
    h.runtime.dialogue.select({ id: randomUUID(), name: "Dr. Baruah", isActive: true });
    assert.equal(h.runtime.snapshot().intake.name?.value, "উদয়চিছ বৰা"); assert.equal(h.runtime.snapshot().intake.age?.value, 27);
    assert.equal(h.runtime.snapshot().intake.unresolved, false);
    await h.session.reset(); assert.equal(h.runtime.snapshot().intake.name, null);
  } finally { await h.session.close(); }
});

test("real SDK resolves phonetic nine-thirty only to a returned slot", async () => {
  const slotId = randomUUID();
  const interpreter = createIntakeInterpreter(new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as IntakeInput;
    assert.ok(input.offered?.times.some(t => t.id === slotId && t.time === "09:30"));
    return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details", nextField: "name", choice: { date: null, slotId, evidence: "নাইন ঠার্তি" }, reply: "What is the patient's name?" }) }];
  }));
  const h = harness(interpreter);
  h.runtime.dialogue.state.selectedDoctor = { id: randomUUID(), name: "Dr. Baruah", isActive: true };
  h.runtime.dialogue.state.selectedDate = "2026-10-20"; h.runtime.dialogue.state.question = "time";
  h.runtime.dialogue.state.offeredSlots = [{ id: slotId, slotDate: "2026-10-20", startTime: "09:30:00", endTime: "09:45:00", maxPatients: 30, remainingCapacity: 30 }];
  try {
    const reply = await h.session.processUserUtterance("নাইন ঠার্তি");
    assert.equal(h.runtime.snapshot().dialogue.selectedSlotId, slotId); assert.equal(reply.businessState.slots.dateOrTime, "2026-10-20 09:30:00");
    assert.equal(reply.replySource, "model"); assert.equal(h.provider.inputs.length, 0);
  } finally { await h.session.close(); }
});

test("structured interpretation drops optional context whole and keeps current text and candidates", () => {
  const state = emptyIntake(); state.name = candidate("Udoy Bora", 1); state.age = { value: 27, evidence: "27", sourceTurn: 1 };
  state.pending = [{ turnId: 2, text: "আ".repeat(2000) }, { turnId: 3, text: "ব".repeat(2000) }];
  const input: IntakeInput = { state, text: "My age is 27", turnId: 8, language: "en", phoneConfirmed: true,
    history: Array.from({ length: 8 }, (_, index) => ({ role: "assistant", content: "আ".repeat(2000), turnId: index, interrupted: false })) };
  const compact = compactIntakeInput(input);
  assert.ok(bytes(compact) <= 3200); assert.equal(compact.text, input.text); assert.equal(compact.state.name?.value, "Udoy Bora");
  assert.equal(state.pending.length, 2); assert.equal(input.history?.length, 8);
});

test("provider failures keep intake and evidence instead of clearing them or blaming speech", async () => {
  let fail = false;
  const h = harness(async input => fail ? null : { ...nothing, intent: "provide_details", name: candidate("Udoy Bora", input.turnId), nextField: "age", reply: "How old is the patient?" });
  try {
    await h.session.processUserUtterance("My name is Udoy Bora"); fail = true;
    const reply = await h.session.processUserUtterance("My age is 27");
    assert.equal(h.runtime.snapshot().intake.name?.value, "Udoy Bora"); assert.equal(h.runtime.snapshot().intake.pending.length, 1);
    assert.equal(reply.replySource, "recovery"); assert.doesNotMatch(reply.text, /unclear|understand/iu);
  } finally { await h.session.close(); }
});

test("old pending evidence cannot resolve a rejected age; a current explicit correction is required", () => {
  const state = emptyIntake(); state.age = { value: 20, evidence: "20", sourceTurn: 1 }; state.unresolvedAge = true; state.unresolved = true;
  state.pending = [{ turnId: 1, text: "age 20" }];
  const input: IntakeInput = { state: structuredClone(state), text: "I said that earlier", turnId: 3, language: "en", phoneConfirmed: true };
  const decision = validateIntakeDecision({ ...nothing, intent: "correct_details", age: { value: 20, evidence: "20", sourceTurn: 1 } }, input);
  applyIntakeDecision(state, decision, input);
  assert.equal(state.unresolvedAge, true); assert.equal(state.age?.sourceTurn, 1);
});

test("candidate state persists in active snapshots and is cleared when caller phone changes or session closes", async () => {
  const h = harness(async input => ({ ...nothing, intent: "provide_details", name: candidate("Udoy Bora", input.turnId), age: { value: 27, evidence: "27", sourceTurn: input.turnId }, nextField: "doctor" }));
  try {
    const phone = await h.session.processUserUtterance("7002059544"); await h.session.notifyPlaybackResult(phone.turnId, true);
    await h.session.processUserUtterance("yes"); await h.session.processUserUtterance("name Udoy Bora age 27");
    const saved = await h.store.get(h.context);
    const stored = saved?.conversation.businessState as ReturnType<typeof h.runtime.snapshot>;
    assert.equal(stored.intake.age?.value, 27); assert.equal(stored.intake.name?.value, "Udoy Bora");
    await h.session.processUserUtterance("8002059544");
    assert.equal(h.runtime.snapshot().intake.name, null); assert.equal(h.runtime.snapshot().intake.age, null);
    assert.equal(h.runtime.snapshot().intake.lastQuestion?.field === "name", false);
  } finally { await h.session.close(); }
  assert.equal(await h.store.get(h.context), undefined);
});

test("individual age digits validate deterministically without treating decimals or conflicting numbers as 27", async () => {
  for (const evidence of ["2 7", "২ ৭", "२ ७", "2.7", "20 not 27"]) {
    const provider = new ScriptedProvider(() => [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "correct_details", age: { value: 27, evidence, sourceTurn: 1 }, nextField: "name" }) }]);
    const result = await createIntakeInterpreter(provider)({ text: `My age is ${evidence}`, turnId: 1, language: "en", state: emptyIntake(), phoneConfirmed: true }, new AbortController().signal);
    assert.equal(result?.age?.value === 27, !evidence.includes(".") && !evidence.includes("not"), evidence);
  }
});

test("an ambiguous date answer gets one contextual model clarification without changing patient state", async () => {
  const h = harness(async () => ({ ...nothing, intent: "unclear", nextField: "date", reply: "Would you prefer Tuesday or Wednesday?" }));
  h.runtime.dialogue.state.selectedDoctor = { id: randomUUID(), name: "Dr. Baruah", isActive: true };
  h.runtime.dialogue.dates(1, ["2026-10-20", "2026-10-21"]);
  try {
    const result = await h.session.processUserUtterance("Tuesday or Wednesday");
    assert.equal(result.text, "Would you prefer Tuesday or Wednesday?"); assert.equal(result.replySource, "model");
    assert.equal(h.provider.inputs.length, 0); assert.equal(h.runtime.snapshot().intake.unresolved, false);
    assert.equal(h.runtime.snapshot().dialogue.selectedDate, null);
  } finally { await h.session.close(); }
});

test("ordinary speech keeps complete short model sentences and never cuts a clock value", () => {
  assert.equal(conciseClinicSpeech("09:30 is available. Which time do you prefer? Here are more details.", () => "fallback").text, "09:30 is available. Which time do you prefer?");
  assert.equal(conciseClinicSpeech("Dr. Baruah is selected. Which date do you prefer? Extra details.", () => "fallback").text, "Dr. Baruah is selected. Which date do you prefer?");
  const verbose = `${"This explanation repeats unnecessary information ".repeat(10)}. Which date would you prefer?`;
  assert.equal(conciseClinicSpeech(verbose, () => "fallback").text, "Which date would you prefer?");
  assert.equal(conciseClinicSpeech("word ".repeat(40), () => "Which date?").fallback, true);
});

test("explicit invented May dates fail factuality checks while real October dates remain usable", () => {
  assert.equal(hasUnverifiedNumericDate("কোন দিন? ১২, ১৩ বা ১৪ মে", []), true);
  assert.equal(hasUnverifiedNumericDate("১৮ অক্টোবৰ", ["2026-10-18"]), false);
  assert.equal(hasUnverifiedNumericDate("2026-10-19", ["2026-10-18"]), true);
  assert.equal(hasUnverifiedNumericDate("How may I help?", []), false);
  assert.deepEqual(calendarRequest("দহা বজাত", "2026-10-17").times, ["10:00", "22:00"]);
});

test("ready state does not run intake extraction for ordinary help and booking commands plan prepare only", async () => {
  let intakeCalls = 0;
  const h = harness(async input => { intakeCalls++; return { ...nothing, intent: "provide_details", name: candidate("Udoy Bora", input.turnId), age: { value: 27, evidence: "27", sourceTurn: input.turnId }, nextField: "doctor" }; });
  const doctorId = randomUUID(), slotId = randomUUID();
  try {
    const phone = await h.session.processUserUtterance("7002059544"); await h.session.notifyPlaybackResult(phone.turnId, true);
    await h.session.processUserUtterance("yes"); await h.session.processUserUtterance("name Udoy Bora age 27");
    h.runtime.dialogue.select({ id: doctorId, name: "Dr. Baruah", isActive: true });
    h.runtime.dialogue.state.selectedDate = "2026-10-18"; h.runtime.dialogue.state.selectedSlotId = slotId; h.runtime.dialogue.state.question = "patient";
    h.runtime.dialogue.state.offeredSlots = [{ id: slotId, slotDate: "2026-10-18", startTime: "10:00", endTime: "10:15", maxPatients: 30, remainingCapacity: 30 }];
    const before = intakeCalls;
    await h.session.processUserUtterance("Please proceed"); assert.equal(intakeCalls, before);
    const plan = h.runtime.planTurn("বুক কৰি দিয়ক সেই বুক কৰি দিয়ক", ["book_appointment"]);
    assert.equal(plan?.name, "book_appointment"); assert.equal((plan?.arguments as { mode: string }).mode, "prepare");
    assert.equal(h.runtime.planTurn("Do not book it", ["book_appointment"]), undefined);
    assert.equal(h.runtime.snapshot().intake.nonProgress, 0);
  } finally { await h.session.close(); }
});

test("intake failure diagnostics distinguish evidence rejection from provider HTTP errors without payloads", async () => {
  const events: unknown[] = [];
  const provider = new ScriptedProvider(() => [{ type: "text", delta: JSON.stringify({ ...nothing, age: { value: 29, evidence: "28", sourceTurn: 1 } }) }]);
  await createIntakeInterpreter(provider, (...args) => { events.push(args); })({ text: "age 28", turnId: 1, state: emptyIntake(), language: "en", phoneConfirmed: false }, new AbortController().signal);
  assert.equal((events[0] as unknown[])[0], "age_mismatch"); assert.doesNotMatch(JSON.stringify(events), /age 28|evidence|payload/);
});

test("reported punctuation and Assamese spoken age can be retained without changing the supplied name", async () => {
  const provider = new ScriptedProvider(() => [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details",
    name: { quote: "উদয়চিছ, বৰ", sourceTurn: 1 },
    age: { value: 20, evidence: "টুৱেণ্টি", sourceTurn: 1 }, nextField: "phone", reply: "আপোনাৰ ফোন নম্বৰটো কওক।" }) }]);
  const h = harness(createIntakeInterpreter(provider));
  try {
    const reply = await h.session.processUserUtterance("মোৰ নাম উদয়চিছ, বৰ। বয়স হৈ গ'ল টুৱেণ্টি।");
    assert.equal(reply.businessState.intake.name?.value, "উদয়চিছ, বৰ");
    assert.equal(reply.businessState.intake.age?.value, 20);
    assert.equal(reply.replySource, "model"); assert.equal(provider.inputs.length, 1);
    assert.equal(h.provider.inputs.length, 0);
  } finally { await h.session.close(); }
});

test("a bare name after a spoken question retains exact evidence and uses the explicit Assamese reply instruction", async () => {
  const provider = new ScriptedProvider(() => [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details",
    name: { quote: "উদয়চিছ বড়া", sourceTurn: 2 }, nextField: "age", reply: "আপোনাৰ বয়স কিমান?" }) }]);
  const state = emptyIntake(); state.lastQuestion = { field: "name", turnId: 1, text: "আপোনাৰ সম্পূৰ্ণ নামটো কওক।" };
  const result = await createIntakeInterpreter(provider)({ text: "উদয়চিছ বড়া?", turnId: 2, language: "as", state, phoneConfirmed: false }, new AbortController().signal);
  assert.equal(result?.name?.value, "উদয়চিছ বড়া"); assert.equal(result?.nextField, "age");
  assert.match(provider.options[0]?.systemPrompt ?? "", /Reply in Assamese \(অসমীয়া; as\)/u);
  assert.match(provider.options[0]?.systemPrompt ?? "", /bare personal name.*is provide_details, not request_help/u);
  assert.match(provider.options[0]?.systemPrompt ?? "", /never.*type or write/u);
  assert.equal(provider.inputs.length, 1);
});

test("source-selected names preserve spelling, initials and internal punctuation without duplicate name generation", () => {
  for (const name of ["দেৱাশিছ বৰা", "উদয়চিছ বড়া", "Dr. A. K. Bora", "O'Neill-Jones", "নাম ২", "উদয়চিছ, বৰ"]) {
    const input: IntakeInput = { text: `মোৰ নাম ${name}?`, turnId: 4, language: "as", state: emptyIntake(), phoneConfirmed: false };
    const decision = materializeIntakeDecision({ ...nothing, intent: "provide_details", name: { quote: `${name}?`, sourceTurn: 4 }, nextField: "age" }, input);
    assert.deepEqual(decision.name, { value: name, evidence: name, sourceTurn: 4 });
  }
});

test("source selection rejects invented spellings, missing turns, unknown fields and help misclassified as a name", () => {
  const input: IntakeInput = { text: "উদয়চিছ বড়া?", turnId: 2, language: "as", state: emptyIntake(), phoneConfirmed: false };
  const proposal = { ...nothing, intent: "provide_details", name: { quote: "উদয়চিছ বড়া", sourceTurn: 2 } };
  for (const name of [{ quote: "উদয়চিছ বৰা", sourceTurn: 2 }, { quote: "উদয়চিছ বড়া", sourceTurn: 999 },
    { quote: "উদয়চিছ বড়া", sourceTurn: 2, value: "Different Name" }, { quote: "?", sourceTurn: 2 }]) {
    assert.throws(() => materializeIntakeDecision({ ...proposal, name }, input));
  }
  assert.throws(() => materializeIntakeDecision({ ...proposal, intent: "request_help" }, input));
  const state = emptyIntake(); state.pending = [{ text: "Earlier Name", turnId: 1 }];
  const selected = materializeIntakeDecision({ ...proposal, name: { quote: "Earlier Name", sourceTurn: 1 } }, { ...input, state });
  assert.equal(selected.name?.value, "Earlier Name");
  state.name = { value: "Current Name", evidence: "Current Name", sourceTurn: 2 }; state.unresolvedName = true;
  applyIntakeDecision(state, selected, { ...input, state });
  assert.equal(state.name.value, "Current Name"); assert.equal(state.unresolvedName, true);
});

test("real SDK and mocked Groq send the source-quote schema and retain the reported name", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  const provider = new GroqLLMProvider({ apiKey: "offline-name-test", baseURL: "http://name.test/v1", model: "qwen/qwen3.8-27b" });
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = z.object({ stream: z.literal(false), response_format: z.object({ type: z.literal("json_schema"),
        json_schema: z.object({ strict: z.literal(true), schema: z.object({ properties: z.object({ name: z.unknown() }) }) }) }) }).parse(JSON.parse(String(init?.body)));
      const nameSchema = JSON.stringify(body.response_format.json_schema.schema.properties.name);
      assert.match(nameSchema, /"quote"/u); assert.doesNotMatch(nameSchema, /"value"|"evidence"/u);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ ...nothing, intent: "provide_details",
        name: { quote: "দেৱাশিছ বৰা", sourceTurn: 1 }, nextField: "age", reply: "আপোনাৰ বয়স কিমান?" }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 100, total_tokens: 1300 } });
    };
    const result = await createIntakeInterpreter(provider)({ text: "দেৱাশিছ বৰা।", turnId: 1, expectedField: "name", language: "as", state: emptyIntake(), phoneConfirmed: false }, new AbortController().signal);
    assert.equal(result?.name?.value, "দেৱাশিছ বৰা"); assert.equal(result?.nextField, "age"); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("name intake recovers from the reported help-classification loop using the current source quote", async () => {
  const provider = new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as IntakeInput;
    if (input.turnId < 3) return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "request_help", nextField: "name", reply: "আপোনাৰ নামটো কওক।" }) }];
    if (input.turnId === 3) return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details", nextField: "age",
      name: { quote: "দেৱাশিছ বৰা", sourceTurn: input.turnId }, reply: "আপোনাৰ বয়স কিমান?" }) }];
    return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details", nextField: "phone",
      age: { value: 27, evidence: "27", sourceTurn: input.turnId }, reply: "আপোনাৰ ফোন নম্বৰটো কওক।" }) }];
  });
  const h = harness(createIntakeInterpreter(provider)); h.runtime.dialogue.state.question = "patient";
  try {
    await h.session.processUserUtterance("উদয়চিছ বড়া?");
    const retry = await h.session.processUserUtterance("উদয়চিছ বড়া?");
    assert.match(retry.text, /বানান/u); assert.equal(h.runtime.snapshot().intake.name, null);
    const name = await h.session.processUserUtterance("দেৱাশিছ বৰা।");
    assert.equal(name.businessState.intake.name?.value, "দেৱাশিছ বৰা");
    assert.equal(name.businessState.intake.name?.sourceTurn, 3); assert.equal(name.businessState.intake.nonProgress, 0);
    assert.equal(name.text, "আপোনাৰ বয়স কিমান?"); assert.equal(name.replySource, "model");
    const age = await h.session.processUserUtterance("27");
    assert.equal(age.businessState.intake.age?.value, 27); assert.equal(age.businessState.intake.name?.value, "দেৱাশিছ বৰা");
    assert.equal(age.text, "আপোনাৰ ফোন নম্বৰটো কওক।");
    assert.equal(provider.inputs.length, 4); assert.equal(h.provider.inputs.length, 0);
    assert.equal(h.session.getSnapshot().conversation.toolHistory.length, 0);
  } finally { await h.session.close(); }
});

test("age validation reads the whole mixed-language number rather than its last digit", () => {
  for (const evidence of ["twenty-eight", "twenty8", "টুৱেণ্টি8", "টুৱেণ্টি ৮", "ट्वेंटी8", "बीस eight", "अट्ठाईस", "আঠাইশ", "28", "২৮", "२८", "two eight", "দুই আঠ", "दो आठ", "twenty8 years old"]) {
    const input: IntakeInput = { text: evidence, turnId: 1, language: "as", state: emptyIntake(), phoneConfirmed: false };
    const decision = validateIntakeDecision({ ...nothing, intent: "provide_details", age: { value: 28, evidence, sourceTurn: 1 } }, input);
    assert.equal(decision.age?.value, 28, evidence);
    assert.throws(() => validateIntakeDecision({ ...decision, age: { value: 29, evidence, sourceTurn: 1 } }, input), /age_mismatch/u, evidence);
  }
  assert.deepEqual(spokenNumber("one hundred and twenty"), { kind: "value", value: 120 });
  for (const evidence of ["20 not 28", "2.8", "-28", "twenty twenty", "20 8"]) {
    assert.throws(() => validateIntakeDecision({ ...nothing, age: { value: 28, evidence, sourceTurn: 1 } },
      { text: evidence, turnId: 1, language: "as", state: emptyIntake(), phoneConfirmed: false }), /age_mismatch/u, evidence);
  }
});

test("reported mixed age progresses through one SDK interpretation while retaining name and Assamese reply language", async () => {
  const provider = new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as IntakeInput;
    if (input.text === "উদয়চিছ বড়া") return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details", name: { quote: input.text, sourceTurn: input.turnId }, nextField: "age", reply: "আপোনাৰ বয়স কিমান?" }) }];
    assert.equal(input.expectedField, "age"); assert.equal(input.language, "as");
    assert.deepEqual(input.numberHint, { value: 28, quote: "টুৱেণ্টি8", sourceTurn: input.turnId });
    return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details", age: { value: 28, evidence: "টুৱেণ্টি8", sourceTurn: input.turnId }, nextField: "phone", reply: "আপোনাৰ ফোন নম্বৰটো কওক।" }) }];
  });
  const h = harness(createIntakeInterpreter(provider));
  h.runtime.dialogue.state.question = "patient";
  try {
    await h.session.processUserUtterance("উদয়চিছ বড়া", { responseLanguage: "as" });
    const result = await h.session.processUserUtterance("টুৱেণ্টি8", { responseLanguage: "as" });
    assert.equal(result.businessState.intake.age?.value, 28); assert.equal(result.businessState.intake.name?.value, "উদয়চিছ বড়া");
    assert.equal(result.replySource, "model"); assert.equal(result.text, "আপোনাৰ ফোন নম্বৰটো কওক।");
    assert.equal(provider.inputs.length, 2); assert.equal(h.provider.inputs.length, 0);
  } finally { await h.session.close(); }
});

test("reported Assamese age survives digit-script normalization and an unchanged retained-name echo", async () => {
  const provider = new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as IntakeInput;
    if (input.turnId === 1) return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details",
      name: { quote: "উদয়চিছ বৰাক", sourceTurn: 1 }, nextField: "age", reply: "আপোনাৰ বয়স কিমান?" }) }];
    return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: "provide_details",
      name: { quote: "উদয়চিছ বৰাক", sourceTurn: 1 },
      age: { value: 28, evidence: "28", sourceTurn: input.turnId }, nextField: "phone", reply: "আপোনাৰ ফোন নম্বৰটো কওক।" }) }];
  });
  const h = harness(createIntakeInterpreter(provider)); h.runtime.dialogue.state.question = "patient";
  try {
    await h.session.processUserUtterance("উদয়চিছ বৰাক।", { responseLanguage: "as" });
    const result = await h.session.processUserUtterance("মোৰ বয়স ২৮ বছৰ।", { responseLanguage: "as" });
    assert.equal(result.businessState.intake.name?.value, "উদয়চিছ বৰাক");
    assert.equal(result.businessState.intake.age?.value, 28);
    assert.equal(result.businessState.intake.age?.evidence, "২৮");
    assert.equal(result.failureCategory, undefined);
    assert.equal(result.text, "আপোনাৰ ফোন নম্বৰটো কওক।");
  } finally { await h.session.close(); }
});

test("age digit normalization cannot invent evidence, change a name or take part of a larger number", () => {
  const input: IntakeInput = { text: "মোৰ বয়স ২৮ বছৰ।", turnId: 2, language: "as", state: emptyIntake(), phoneConfirmed: false };
  const proposal = { ...nothing, intent: "provide_details", name: null, age: { value: 28, evidence: "28", sourceTurn: 2 } };
  assert.equal(materializeIntakeDecision(proposal, input).age?.evidence, "২৮");
  for (const text of ["মোৰ বয়স ২৮০ বছৰ।", "মোৰ বয়স ২৯ বছৰ।", "unclear"]) {
    assert.throws(() => materializeIntakeDecision(proposal, { ...input, text }));
  }
  assert.throws(() => materializeIntakeDecision({ ...proposal, name: { quote: "invented", sourceTurn: 1 } }, input));
});

test("numeric hints are derived from current speech and supplied hints cannot override them", async () => {
  const provider = new ScriptedProvider(messages => {
    const input = JSON.parse(messages[0]!.content) as IntakeInput;
    const known = input.text === "twenty8";
    assert.deepEqual(input.numberHint, known ? { value: 28, quote: "twenty8", sourceTurn: 1 } : undefined);
    return [{ type: "text", delta: JSON.stringify({ ...nothing, intent: known ? "provide_details" : "request_help",
      age: known ? { value: 28, evidence: "twenty8", sourceTurn: 1 } : null, nextField: "age", reply: "Please say the age in digits." }) }];
  });
  for (const text of ["twenty8", "unclear"]) {
    const result = await createIntakeInterpreter(provider)({ text, turnId: 1, expectedField: "age", language: "en", state: emptyIntake(), phoneConfirmed: false,
      numberHint: { value: 99, quote: "forged", sourceTurn: 999 } }, new AbortController().signal);
    assert.equal(result?.age?.value, text === "twenty8" ? 28 : undefined);
  }
});
