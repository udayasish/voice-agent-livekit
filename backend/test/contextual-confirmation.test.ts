import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { ClinicVoiceRuntime } from "../src/components/clinic/voice/runtime.js";
import { createConfirmationInterpreter, type ConfirmationInput, type ConfirmationDecision } from "../src/components/clinic/voice/interpreter.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import type { Database } from "../src/lib/db/transaction-with-hooks.js";
import { VoiceRecoveryTimer, waitForPlayback } from "../src/agent/voice-recovery.js";
import { UtteranceAudioBuffer } from "../src/agent/recognition-recovery.js";
import { AudioFrame } from "@livekit/rtc-node";
import { MemorySessionStore } from "../src/components/agent/engine/store.js";
import { containsCompletionClaim } from "../src/components/clinic/voice/confirmation.js";

const candidate = { id: randomUUID(), digits: "7002059544" };
const input = (text = "হয়, শুদ্ধ।"): ConfirmationInput => ({ text, language: "as", history: [], candidates: [candidate], activeCandidateId: candidate.id, phoneReadbackCompleted: true, draft: null });
function model(decide: (input: ConfirmationInput) => unknown) {
  return new ScriptedProvider(messages => [{ type: "text", delta: JSON.stringify(decide(JSON.parse(messages[0]!.content) as ConfirmationInput)) }, { type: "done" }]);
}
const decision = (i: ConfirmationInput, intent: ConfirmationDecision["intent"] = "confirm", targetId = i.activeCandidateId): ConfirmationDecision =>
  ({ intent, targetId, evidence: i.text, replacementText: null });

for (const text of ["হয়, শুদ্ধ।", "Yes, that is right", "हाँ सही", "হয়, correct"]) test(`SDK interpretation validates contextual affirmation: ${text}`, async () => {
  const provider = model(i => decision(i));
  const result = await createConfirmationInterpreter(provider)(input(text), new AbortController().signal);
  assert.equal(result.intent, "confirm"); assert.equal(provider.inputs.length, 1);
  assert.equal(provider.options[0]?.tools?.length, 0); assert.equal(provider.options[0]?.temperature, 0);
});
test("a length-limited structured confirmation cannot authorize even parseable JSON", async () => {
  const provider = model(i => decision(i));
  provider.chat = async () => ({ role: "assistant", text: JSON.stringify(decision(input())), finishReason: "length" });
  const events: string[] = [];
  const result = await createConfirmationInterpreter(provider, category => { events.push(category); })(input(), new AbortController().signal);
  assert.equal(result.intent, "unclear"); assert.deepEqual(events, ["incomplete_output"]);
});
for (const kind of ["malformed", "unknown_target", "missing_evidence", "invented_evidence", "invented_number", "extra_field"] as const) test(`invalid interpretation fails closed: ${kind}`, async () => {
  const provider = model(i => ({ ...decision(i), ...(kind === "malformed" ? { intent: "magic" } : {}),
    ...(kind === "unknown_target" ? { targetId: randomUUID() } : {}), ...(kind === "missing_evidence" ? { evidence: "" } : {}),
    ...(kind === "invented_evidence" ? { evidence: "not said" } : {}), ...(kind === "invented_number" ? { replacementText: "9999999999" } : {}),
    ...(kind === "extra_field" ? { confirmed: true } : {}) }));
  assert.equal((await createConfirmationInterpreter(provider)(input(), new AbortController().signal)).intent, "unclear");
  assert.equal(provider.inputs.length, 1);
});
test("unsupported interpreter tool calls cannot execute and failures log no payload", async () => {
  const events: unknown[] = [];
  const provider = new ScriptedProvider(() => [{ type: "tool_call", toolCall: { id: "bad", name: "book_appointment", arguments: "{}" } }]);
  assert.equal((await createConfirmationInterpreter(provider, (...args) => events.push(args))(input(), new AbortController().signal)).intent, "unclear");
  assert.equal(JSON.stringify(events).includes(candidate.digits), false);
});
test("interpretation is bounded even when provider ignores cancellation", async () => {
  const provider = model(i => decision(i));
  provider.generate = async function* () { await new Promise(() => {}); };
  assert.equal((await createConfirmationInterpreter(provider, () => {}, 15)(input(), new AbortController().signal)).intent, "unclear");
  const abort = new AbortController();
  const pending = createConfirmationInterpreter(provider)(input(), abort.signal); abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
function harness(choose: (i: ConfirmationInput) => ConfirmationDecision = i => decision(i), ordinaryReply = "What would you like next?") {
  const context = { organizationId: randomUUID(), agentId: "test", sessionId: randomUUID() };
  const interpreterProvider = model(choose);
  const runtime = new ClinicVoiceRuntime(context, randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("No database calls"); }, logger: { info() {}, warn() {}, error() {} } }, "Asia/Kolkata", createConfirmationInterpreter(interpreterProvider));
  const provider = new ScriptedProvider(() => [{ type: "text", delta: ordinaryReply }, { type: "done" }]);
  const store = new MemorySessionStore();
  const session = new AgentSession({ agentId: "test", name: "test", businessName: "Clinic", instructions: "Help", languages: ["as", "en", "hi"] }, context, provider, runtime.behavior, { store });
  return { session, runtime, provider, interpreterProvider, context, store };
}

test("Right number confirms once and inconsistent model phone requests cannot restart dictation", async () => {
  for (const text of ["Please say your full ten-digit phone number. Is it correct?",
    "অনুগ্ৰহ কৰি আপোনাৰ সম্পূৰ্ণ ১০ অংকৰ ফোন নম্বৰটো জোৰেৰে ক'বনে?"]) {
    const h = harness(i => decision(i), text);
    try {
      const first = await h.session.processUserUtterance("7002059544");
      await h.session.notifyPlaybackResult(first.turnId, true);
      const reply = await h.session.processUserUtterance("Right number.", { responseLanguage: "as" });
      assert.equal(h.runtime.snapshot().phoneConfirmed, true);
      assert.equal(h.runtime.snapshot().collectingPhone, false);
      assert.doesNotMatch(reply.text, /phone|নম্বৰ/u);
      assert.match(h.provider.options[0]?.systemPrompt ?? "", /"phoneConfirmed":true/u);
      assert.match(h.provider.options[0]?.systemPrompt ?? "", /"nextField":"doctor"/u);
      assert.deepEqual(h.runtime.registry.get("resolve_clinic_and_caller")!.validate({}), {});
      assert.equal(h.runtime.registry.get("resolve_clinic_and_caller")!.strict, true);
      assert.throws(() => h.runtime.registry.get("resolve_clinic_and_caller")!.validate({ phoneNumber: null }));
      await h.session.processUserUtterance("Number two", { responseLanguage: "as" });
      assert.equal(h.runtime.snapshot().phoneConfirmed, true);
      assert.equal(h.runtime.snapshot().slots.phoneNumber, "7002059544");
      assert.equal(h.runtime.snapshot().collectingPhone, false);
    } finally { await h.session.close(); }
  }
});
test("a natural phone acknowledgement and next question remain model written", async () => {
  assert.equal(containsCompletionClaim("Your phone number is confirmed."), true);
  assert.equal(containsCompletionClaim("Your token number is confirmed.", true), true);
  assert.equal(containsCompletionClaim("Your phone number is confirmed. Your appointment is confirmed.", true), true);
  assert.equal(containsCompletionClaim("Your phone number is confirmed and your booking is confirmed.", true), true);
  const h = harness(i => decision(i), "Your phone number is confirmed. Which doctor would you prefer?");
  try {
    const first = await h.session.processUserUtterance("7002059544"); await h.session.notifyPlaybackResult(first.turnId, true);
    const result = await h.session.processUserUtterance("Right number.", { responseLanguage: "en" });
    assert.equal(result.replySource, "model"); assert.equal(result.text, "Your phone number is confirmed. Which doctor would you prefer?");
  } finally { await h.session.close(); }
});
test("readback text alone, failed playback and interrupted playback cannot confirm a number", async () => {
  const h = harness();
  try {
    const first = await h.session.processUserUtterance("7002059544"); assert.equal(h.provider.inputs.length, 0);
    assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    await h.session.processUserUtterance("হয়, শুদ্ধ।"); assert.equal(h.runtime.snapshot().phoneConfirmed, false);
    await h.session.notifyPlaybackResult(first.turnId, true); assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    const latest = h.session.getSnapshot().session.turnCount;
    await h.session.notifyPlaybackResult(latest, false); assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    await h.session.notifyInterruption(latest); await h.session.notifyPlaybackResult(latest, true);
    assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    const repeat = await h.session.processUserUtterance("হয়, শুদ্ধ।"); await h.session.notifyPlaybackResult(repeat.turnId, true);
    await h.session.processUserUtterance("হয়, শুদ্ধ।"); assert.equal(h.runtime.snapshot().phoneConfirmed, true);
  } finally { await h.session.close(); }
});
test("negation preserves the candidate and contextual previous-number restoration requires a new readback", async () => {
  const h = harness(i => decision(i, i.text === "No" ? "reject" : i.text.includes("previous") ? "restore_previous" : "confirm"));
  try {
    const first = await h.session.processUserUtterance("7002059544"); await h.session.notifyPlaybackResult(first.turnId, true);
    const rejected = await h.session.processUserUtterance("No");
    assert.equal(h.runtime.snapshot().slots.phoneNumber, "7002059544"); assert.equal(h.runtime.snapshot().phoneCandidates.length, 1);
    assert.equal(h.runtime.snapshot().phoneConfirmed, false); await h.session.notifyPlaybackResult(rejected.turnId, true);
    const restored = await h.session.processUserUtterance("No, keep the previous number, it was correct");
    assert.equal(h.runtime.snapshot().phoneConfirmed, false); assert.equal(h.runtime.snapshot().collectingPhone, false);
    await h.session.notifyPlaybackResult(restored.turnId, true); await h.session.processUserUtterance("হয়, শুদ্ধ।");
    assert.equal(h.runtime.snapshot().phoneConfirmed, true);
    assert.equal(h.session.getHistory().filter(m => m.role === "user").length, 4);
  } finally { await h.session.close(); }
});
test("complete replacements retain five candidates, partial corrections never fabricate digits, and snapshots are immutable", async () => {
  const h = harness(i => ({ ...decision(i, "replace_number"), replacementText: i.text }));
  try {
    for (const digits of ["7002059544", "8002059544", "9002059544", "6002059544", "7012059544", "7022059544"]) await h.session.processUserUtterance(digits);
    assert.equal(h.runtime.snapshot().phoneCandidates.length, 5); assert.equal(h.runtime.snapshot().phoneCandidates.some(c => c.digits === "7002059544"), false);
    await h.session.processUserUtterance("last digit five"); assert.equal(h.runtime.snapshot().slots.phoneNumber, "7022059544");
    assert.equal(h.runtime.snapshot().phoneConfirmed, false);
    assert.equal(Reflect.set(h.session.getSnapshot().conversation.businessState.phoneCandidates[0]!, "digits", "9999999999"), false);
    await h.session.reset(); assert.equal(h.runtime.snapshot().phoneCandidates.length, 0);
  } finally { await h.session.close(); }
});
test("unclear speech recovery creates no user transcript, invokes no model/tools, and persists fresh readback state", async () => {
  const h = harness();
  try {
    await h.session.processUserUtterance("7002059544");
    const response = await h.session.processRecovery("speech_unclear");
    assert.equal(h.session.getHistory().filter(m => m.role === "user").length, 1);
    assert.equal(h.provider.inputs.length, 0); assert.equal(h.interpreterProvider.inputs.length, 0);
    assert.equal(h.session.getSnapshot().conversation.toolHistory.length, 0);
    await h.session.notifyPlaybackResult(response.turnId, true);
    assert.equal(h.session.getSnapshot().conversation.businessState.phoneReadbackCompleted, true);
    const stored = await h.store.get(h.context); assert.equal(stored?.conversation.businessState !== undefined, true);
  } finally { await h.session.close(); assert.equal(await h.store.get(h.context), undefined); }
});

test("unclear phone replies ask briefly after completed readback without authorizing or resetting it", async () => {
  const h = harness(i => i.text === "হয়, শুদ্ধ।" ? decision(i)
    : { intent: "unclear", targetId: null, evidence: "", replacementText: null });
  try {
    const first = await h.session.processUserUtterance("7002059544");
    await h.session.notifyPlaybackResult(first.turnId, true);
    const clarification = await h.session.processUserUtterance("সুন্দৰ সুন্দৰ", { responseLanguage: "as" });
    assert.equal(clarification.text, "নম্বৰটো শুদ্ধ নে সলনি কৰিব লাগে?");
    assert.equal(h.runtime.snapshot().phoneConfirmed, false);
    assert.equal(h.runtime.snapshot().phoneReadbackTurn, first.turnId);
    await h.session.notifyInterruption(clarification.turnId);
    assert.equal(h.runtime.snapshot().phoneReadbackCompleted, true);
    const calls = h.interpreterProvider.inputs.length;
    const recovery = await h.session.processRecovery("speech_unclear");
    assert.equal(recovery.text, clarification.text);
    assert.equal(h.interpreterProvider.inputs.length, calls);
    assert.equal(h.runtime.snapshot().phoneConfirmed, false);
    await h.session.processUserUtterance("হয়, শুদ্ধ।");
    assert.equal(h.runtime.snapshot().phoneConfirmed, true);
    assert.equal(h.session.getSnapshot().conversation.toolHistory.length, 0);
  } finally { await h.session.close(); }
});

test("unclear replies after interrupted phone readback still require a complete number readback", async () => {
  const h = harness(() => ({ intent: "unclear", targetId: null, evidence: "", replacementText: null }));
  try {
    const first = await h.session.processUserUtterance("7002059544");
    await h.session.notifyInterruption(first.turnId);
    const reply = await h.session.processUserUtterance("সুন্দৰ সুন্দৰ");
    assert.match(reply.text, /সাত শূন্য/u);
    assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    assert.equal(h.runtime.snapshot().phoneReadbackTurn, reply.turnId);
    assert.equal(h.runtime.snapshot().phoneConfirmed, false);
  } finally { await h.session.close(); }
});
test("asynchronous preparation cannot apply late state after supersession/reset/close", async () => {
  for (const stop of ["supersede", "reset", "close"] as const) {
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
    const context = { organizationId: "org", agentId: "test", sessionId: randomUUID() };
    let writes = 0;
    const session = new AgentSession({ agentId: "test", name: "test", businessName: "test", instructions: "Help", languages: ["en"], defaultLanguage: "en" }, context,
      new ScriptedProvider(() => [{ type: "text", delta: "Done" }]), { stateSchema: z.object({}), initialState: () => ({}), update: () => ({}), promptContext: () => "",
        onTurn: async (text, _turn, ctx) => { if (text === "old") { entered(); await held; ctx!.signal.throwIfAborted(); writes++; } } });
    const pending = session.processUserUtterance("old"); const rejected = assert.rejects(pending, { name: "AbortError" }); await waiting;
    if (stop === "supersede") await session.processUserUtterance("new"); else if (stop === "reset") await session.reset(); else await session.close();
    release(); await rejected; assert.equal(writes, 0); await session.close();
  }
});
test("silence reminders stop after two completed question playbacks and reset on user activity", async () => {
  let count = 0;
  const timer = new VoiceRecoveryTimer(() => { count++; timer.playbackCompleted(true); }, [5, 5]);
  const untilCount = async (expected: number) => {
    for (let attempt = 0; attempt < 100 && count < expected; attempt++) await new Promise(r => setTimeout(r, 5));
    assert.ok(count >= expected);
  };
  timer.playbackCompleted(true); await untilCount(2); assert.equal(count, 2);
  timer.activity(); timer.playbackCompleted(true); timer.pause(); await new Promise(r => setTimeout(r, 12)); assert.equal(count, 2);
  timer.playbackCompleted(true); await untilCount(3); timer.close();
});
test("native drain completion and cancellation determine playback eligibility", async () => {
  await waitForPlayback({ waitForPlayout: async () => {} }, 20, new AbortController().signal);
  const controller = new AbortController(); const pending = waitForPlayback({ waitForPlayout: () => new Promise(() => {}) }, 20, controller.signal);
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
});
test("ephemeral recovery buffer copies PCM, rejects truncated ranges and clears", () => {
  const buffer = new UtteranceAudioBuffer(40), data = new Int16Array(320).fill(7);
  buffer.push(new AudioFrame(data, 16000, 1, 320), 0); data.fill(0);
  assert.equal(buffer.slice({ startMs: 0, endMs: 20 })?.[0]?.data[0], 7);
  buffer.push(new AudioFrame(data, 16000, 1, 320), 20); buffer.push(new AudioFrame(data, 16000, 1, 320), 40);
  assert.equal(buffer.slice({ startMs: 0, endMs: 60 }), undefined);
  buffer.clear(); assert.equal(buffer.slice({ startMs: 20, endMs: 60 }), undefined);
});


test("a stalled native audio drain times out instead of authorizing playback", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = waitForPlayback({ waitForPlayout: () => new Promise(() => {}) }, 999999, new AbortController().signal);
  const rejected = assert.rejects(pending, /drain timeout/u);
  t.mock.timers.tick(59999); t.mock.timers.tick(1); await rejected;
});


test("empty/invalid JSON/provider errors clarify once and interpreter context is limited to four prior messages", async () => {
  for (const mode of ["empty", "json", "failure"] as const) {
    const provider = new ScriptedProvider(() => { if (mode === "failure") throw new Error("Private provider payload");
      return [{ type: "text", delta: mode === "json" ? "{invalid" : "" }, { type: "done" }]; });
    const context = input(); context.history = Array.from({ length: 7 }, (_, turnId) => ({ role: "user" as const, content: "prior", turnId, interrupted: false }));
    assert.equal((await createConfirmationInterpreter(provider)(context, new AbortController().signal)).intent, "unclear");
    assert.equal(provider.inputs.length, 1);
    assert.equal((JSON.parse(provider.inputs[0]![0]!.content) as ConfirmationInput).history.length, 4);
  }
});

test("restoring a different previous candidate uses the server reference and fresh playback", async () => {
  const h = harness(i => i.text === "Use the previous number" ? decision(i, "restore_previous", i.previousCandidateId ?? null)
    : { ...decision(i, "replace_number"), replacementText: i.text });
  try {
    await h.session.processUserUtterance("7002059544"); const first = h.runtime.snapshot().activeCandidateId;
    await h.session.processUserUtterance("8002059544"); assert.equal(h.runtime.snapshot().previousCandidateId, first);
    const restored = await h.session.processUserUtterance("Use the previous number");
    assert.equal(h.runtime.snapshot().slots.phoneNumber, "7002059544"); assert.equal(h.runtime.snapshot().activeCandidateId, first);
    assert.equal(h.runtime.snapshot().phoneConfirmed, false); assert.equal(h.runtime.snapshot().phoneReadbackCompleted, false);
    await h.session.notifyPlaybackResult(restored.turnId, true); assert.equal(h.runtime.snapshot().phoneReadbackCompleted, true);
  } finally { await h.session.close(); }
});

test("candidate references from another session cannot confirm a phone even with the same digits", async () => {
  const a = harness(); let foreign: string | null = null;
  const b = harness(i => decision(i, "confirm", foreign));
  try {
    await a.session.processUserUtterance("7002059544"); foreign = a.runtime.snapshot().activeCandidateId;
    const captured = await b.session.processUserUtterance("7002059544"); await b.session.notifyPlaybackResult(captured.turnId, true);
    assert.notEqual(foreign, b.runtime.snapshot().activeCandidateId);
    await b.session.processUserUtterance("হয়, শুদ্ধ।"); assert.equal(b.runtime.snapshot().phoneConfirmed, false); assert.equal(a.runtime.snapshot().phoneConfirmed, false);
  } finally { await a.session.close(); await b.session.close(); }
});
