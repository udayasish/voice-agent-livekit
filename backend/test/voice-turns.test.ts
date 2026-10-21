import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TurnCollector, SpeechTranscriptGate, NORMAL_TURN_PAUSE_MS, DICTATION_TURN_PAUSE_MS, type TranscriptFragment } from "../src/agent/turn-collector.js";
import { clinicDemoBehavior, createClinicDemoConfig, extractSlotsFromText, type ClinicDemoState } from "../src/components/agent/business/clinic-demo.js";
import { normalizePhoneNumber } from "../src/components/agent/normalizers/phone-number-normalizer.js";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { MockLLMProvider } from "../src/components/agent/providers/llm/mock.js";

const fragment = (text: string): TranscriptFragment => ({ text, confidence: 0.9, language: "as", latencyMs: 100 });
function phoneState(): ClinicDemoState {
  return { ...clinicDemoBehavior.initialState(), slots: { doctor: "Dr. Test", dateOrTime: "tomorrow", patientName: "Test Caller" },
    intakeActive: true, lastQuestion: "phoneNumber" };
}
function step(text: string, state: ClinicDemoState) {
  const updated = clinicDemoBehavior.stateSchema.parse(clinicDemoBehavior.update(text, state));
  const response = clinicDemoBehavior.response!({ text: "Hello", userText: text, state: updated, language: "as",
    isFallback: false, repeated: false, previousResponse: undefined });
  return { state: clinicDemoBehavior.onResponse!(response, updated), response };
}

describe("Voice turn listening", () => {
  it("never replies while VAD still reports speech", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turns: TranscriptFragment[] = [];
    const collector = new TurnCollector({ pauseMs: () => NORMAL_TURN_PAUSE_MS, onTurn: turn => { turns.push(turn); }, onError: assert.fail });
    collector.speechStarted(); collector.addFinal(fragment("hello")); t.mock.timers.tick(10000);
    assert.equal(turns.length, 0);
    collector.speechEnded(); t.mock.timers.tick(NORMAL_TURN_PAUSE_MS - 1); assert.equal(turns.length, 0);
    t.mock.timers.tick(1); assert.equal(turns[0]?.text, "hello"); collector.close();
  });
  it("merges digit fragments across pauses without removing repeated digits", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turns: TranscriptFragment[] = [];
    const collector = new TurnCollector({ pauseMs: () => DICTATION_TURN_PAUSE_MS, onTurn: turn => { turns.push(turn); }, onError: assert.fail });
    collector.addFinal(fragment("seven")); t.mock.timers.tick(2000);
    collector.speechStarted(); t.mock.timers.tick(4000); assert.equal(turns.length, 0);
    collector.addFinal(fragment("seven")); collector.speechEnded(); t.mock.timers.tick(2000);
    collector.addFinal(fragment("double four")); t.mock.timers.tick(2999); assert.equal(turns.length, 0);
    t.mock.timers.tick(1); assert.equal(turns[0]?.text, "seven seven double four"); collector.close();
  });
  it("extends the listening window when an interim transcript arrives", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turns: TranscriptFragment[] = [];
    const collector = new TurnCollector({ pauseMs: () => NORMAL_TURN_PAUSE_MS, onTurn: turn => { turns.push(turn); }, onError: assert.fail });
    collector.addFinal(fragment("first")); t.mock.timers.tick(1000); collector.interimReceived();
    t.mock.timers.tick(1000); assert.equal(turns.length, 0);
    collector.addFinal(fragment("second")); t.mock.timers.tick(1200);
    assert.equal(turns[0]?.text, "first second"); collector.close();
  });
  it("discards pending transcripts on departure or shutdown", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turns: TranscriptFragment[] = [];
    const collector = new TurnCollector({ pauseMs: () => 1200, onTurn: turn => { turns.push(turn); }, onError: assert.fail });
    collector.addFinal(fragment("hello")); collector.close(); collector.close();
    collector.speechEnded(); collector.addFinal(fragment("late")); t.mock.timers.tick(10000);
    assert.equal(turns.length, 0);
  });
  it("keeps consuming speech while the previous turn handler is pending", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const turns: string[] = [];
    const collector = new TurnCollector({ pauseMs: () => 1200, onTurn: async turn => { turns.push(turn.text); await pending; }, onError: assert.fail });
    collector.addFinal(fragment("first")); t.mock.timers.tick(1200);
    collector.addFinal(fragment("second")); t.mock.timers.tick(1200);
    assert.deepEqual(turns, ["first", "second"]); release(); await pending; collector.close();
  });
  it("reports handler failures once without retaining the failed fragments", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let errors = 0;
    const collector = new TurnCollector({ pauseMs: () => 1200, onTurn: async () => { throw new Error("failure"); }, onError: () => { errors++; } });
    collector.addFinal(fragment("hello")); t.mock.timers.tick(1200); await Promise.resolve();
    t.mock.timers.tick(5000); assert.equal(errors, 1); collector.close();
  });
});

describe("Speech evidence before model input", () => {
  const timed = (text: string, startMs: number, endMs: number, confidence = 0.9): TranscriptFragment =>
    ({ ...fragment(text), confidence, audioRange: { startMs, endMs } });

  it("accepts above-80-percent Assamese name transcripts when speech and timing qualify", () => {
    const gate = new SpeechTranscriptGate();
    gate.speechStarted(100, 100); gate.speechEnded(1900, 600);
    for (const confidence of [0.80, 0.8232422, 0.9526367, 1]) {
      assert.equal(gate.rejection(timed("উদয়চিছ বড়া?", 100, 1100, confidence)), undefined);
    }
    assert.equal(gate.rejection(timed("উদয়চিছ বড়া?", 4000, 5100, 0.99)), "no_speech");
  });

  it("rejects high-confidence text during silence, even after an earlier hello", () => {
    const gate = new SpeechTranscriptGate();
    assert.equal(gate.rejection(timed("phantom", 100, 800)), "no_speech");
    gate.speechStarted(200, 100); gate.speechEnded(1500, 600);
    assert.equal(gate.rejection(timed("হেল্ল'", 100, 900)), undefined);
    assert.equal(gate.rejection(timed("ভাৰতীয় সেনাৰ এজন অকলে", 4000, 5100)), "no_speech");
  });
  it("rejects long low-confidence output and missing or invalid timing", () => {
    const gate = new SpeechTranscriptGate();
    gate.speechStarted(200, 100); gate.speechEnded(2200, 600);
    assert.equal(gate.rejection(timed("ভাৰতীয় সেনাৰ এজন অকলে", 100, 1500, 0.2)), "low_confidence");
    assert.equal(gate.rejection(timed("হয়", 100, 400, NaN)), "low_confidence");
    assert.equal(gate.rejection(fragment("unlocated text")), "missing_timing");
    assert.equal(gate.rejection(timed("unlocated text", 0, Infinity)), "missing_timing");
    assert.equal(gate.rejection(timed("unlocated text", 1000, 1000)), "missing_timing");
  });
  it("preserves short Assamese affirmations and speech during assistant playback", () => {
    const gate = new SpeechTranscriptGate();
    gate.speechStarted(100, 100); gate.speechEnded(850, 600);
    assert.equal(gate.rejection(timed("হয়", 0, 200, 0.5)), undefined);
    // Recognition acceptance is independent of assistant playback; VAD still owns barge-in.
    gate.speechStarted(4000, 100); gate.speechEnded(5200, 600);
    assert.equal(gate.rejection(timed("ৰব", 3900, 4250)), undefined);
  });
  it("waits for asynchronous VAD, then excludes silent fragments from the actual delivered turn", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const gate = new SpeechTranscriptGate(), turns: TranscriptFragment[] = [], rejections: string[] = [];
    const collector = new TurnCollector({ pauseMs: () => NORMAL_TURN_PAUSE_MS, onError: assert.fail,
      onTurn: turn => { turns.push(turn); }, acceptFragment: part => {
        const reason = gate.rejection(part); if (reason) rejections.push(reason); return !reason;
      } });
    collector.addFinal(timed("হেল্ল'", 100, 500));
    t.mock.timers.tick(200);
    gate.speechStarted(200, 100); collector.speechStarted();
    gate.speechEnded(1100, 600); collector.speechEnded();
    collector.addFinal(timed("phantom silence", 2500, 3000));
    t.mock.timers.tick(NORMAL_TURN_PAUSE_MS);
    assert.deepEqual(turns.map(turn => turn.text), ["হেল্ল'"]);
    assert.deepEqual(rejections, ["no_speech"]);
    collector.addFinal(timed("more silence", 4000, 5000)); t.mock.timers.tick(NORMAL_TURN_PAUSE_MS);
    assert.equal(turns.length, 1); collector.close();
  });
  it("bounds retained evidence without letting old speech authorize new silence", () => {
    const gate = new SpeechTranscriptGate();
    for (let index = 0; index < 200; index++) {
      gate.speechStarted(index * 2000 + 200, 100); gate.speechEnded(index * 2000 + 1000, 600);
    }
    assert.equal(gate.rejection(timed("old", 100, 400)), "no_speech");
    assert.equal(gate.rejection(timed("latest", 398100, 398400)), undefined);
  });
});

describe("Clinic dictation demo", () => {
  it("preserves the full reported doctor name and morning time", () => {
    assert.equal(extractSlotsFromText("হয় মোক ডক্টৰ প্ৰবল হাজৰিকাৰ লগত").doctor, "ডাঃ প্ৰবল হাজৰিকা");
    assert.equal(extractSlotsFromText("ডঃ প্ৰলাল হাজৰিকা").doctor, "ডাঃ প্ৰলাল হাজৰিকা");
    assert.equal(extractSlotsFromText("মই মই কাই কাইলৈ ৰাতিপুৱা ১০ বজাত।").dateOrTime, "কাইলৈ ৰাতিপুৱা ১০ বজাত");
  });
  it("does not turn a reported noisy sentence into a caller name", () => {
    const state = { ...phoneState(), slots: { doctor: "Dr. Test", dateOrTime: "tomorrow" }, lastQuestion: "patientName" as const };
    assert.equal(step("বাঘাৰ উপযুক্ত লৈছিল।", state).state.slots.patientName, undefined);
  });
  it("counts the reported nine digits without inventing a tenth", () => {
    const text = "ছেভেন ডাবল জিৰ' 2' ফাইভ নাইন ফাইভ ডাবল ফ'ৰ।";
    assert.equal(normalizePhoneNumber(text).digits, "700259544");
    const result = step(text, phoneState());
    assert.equal(result.state.slots.phoneNumber, undefined); assert.match(result.response, /9টা/u);
    assert.match(result.response, /শেষ হ'ল যদি/u);
    assert.doesNotMatch(result.response, /বাকী 1টা/u);
    assert.equal(result.state.lastQuestion, "phoneNumber");
  });
  it("retains digits across turns then reads the complete number for confirmation", () => {
    let state = step("ছেভেন", phoneState()).state;
    state = step("ডাবল জিৰ' 2'", state).state;
    state = step("জিৰ' ফাইভ নাইন", state).state;
    const complete = step("ফাইভ ডাবল ফ'ৰ।", state);
    assert.equal(complete.state.slots.phoneNumber, "7002059544"); assert.equal(complete.state.phoneConfirmed, false);
    assert.equal(complete.state.lastQuestion, "phoneConfirmation"); assert.match(complete.response, /শুদ্ধনে/u);
    const confirmed = step("হয়", complete.state);
    assert.equal(confirmed.state.phoneConfirmed, true); assert.match(confirmed.response, /বুক হোৱা নাই/u);
  });
  it("accepts recognized spoken digits joined to numeric runs without changing their order", () => {
    for (const text of [
      "ছেভেন00 20 ফাইভ নাইন ফাইভ ফ'ৰ ফ'ৰ",
      "ছেভেন০০ ২০ ফাইভ নাইন ফাইভ ফ'ৰ ফ'ৰ",
      "seven00 20five9five44",
      "seven double0 two0 five nine five double4",
    ]) {
      const parsed = normalizePhoneNumber(text);
      assert.equal(parsed.digits, "7002059544", text);
      assert.deepEqual(parsed.unrecognizedTokens, [], text);
      const result = step(text, phoneState());
      assert.equal(result.state.slots.phoneNumber, "7002059544", text);
      assert.equal(result.state.lastQuestion, "phoneConfirmation");
    }
  });
  it("rejects unknown joined words and ambiguous multipliers instead of inferring digits", () => {
    for (const text of ["ছেভেন জিৰ' ট00 ফাইভ নাইন ফাইভ ডাবল ফ'ৰ", "seven double020 five nine five four four"]) {
      assert.ok(normalizePhoneNumber(text).unrecognizedTokens.length > 0);
      assert.equal(step(text, phoneState()).state.slots.phoneNumber, undefined);
    }
  });
  it("keeps repeated incomplete prompts specific to number capture", () => {
    const partial = step("seven zero", phoneState());
    const reply = clinicDemoBehavior.response!({ text: "Hello", userText: "হয়", state: partial.state,
      language: "as", isFallback: false, repeated: false, previousResponse: partial.response });
    assert.notEqual(reply, partial.response); assert.match(reply, /নম্বৰ|অংক/u);
  });
  it("recovers the reported nine-digit/unclear/joined-token sequence through the SDK", async () => {
    const config = createClinicDemoConfig("Test clinic");
    const session = new AgentSession(config, { organizationId: "test-org", agentId: config.agentId, sessionId: "test-joined-dictation" },
      new MockLLMProvider({ fixedResponse: "Hello." }), clinicDemoBehavior);
    await session.processUserUtterance("ডাঃ বৰুৱা");
    await session.processUserUtterance("কাইলৈ");
    await session.processUserUtterance("মোৰ নাম Test Caller");
    const partial = await session.processUserUtterance("হয় ছেভেন ডাবল জিৰ' 2' ফাইভ নাইন ফাইভ ডাবল ফ'ৰ।");
    assert.equal(partial.businessState.slots.phoneNumber, undefined);
    let previous = partial.text;
    for (const text of ["তং পা বসু, ছেভেন ডাবল জে, 2. ফাইভ ডাবল ফ'ৰ।", "ছেভেন জিৰ' ট00 ফাইভ নাইন ফাইভ ডাবল ফ'ৰ"]) {
      const reply = await session.processUserUtterance(text);
      assert.equal(reply.businessState.slots.phoneNumber, undefined);
      assert.equal(reply.businessState.lastQuestion, "phoneNumber");
      assert.equal(reply.isFallback, false); assert.notEqual(reply.text, previous);
      assert.match(reply.text, /নম্বৰ/u); previous = reply.text;
    }
    const complete = await session.processUserUtterance("ছেভেন00 20 ফাইভ নাইন ফাইভ ফ'ৰ ফ'ৰ");
    assert.equal(complete.businessState.slots.phoneNumber, "7002059544");
    assert.equal(complete.businessState.lastQuestion, "phoneConfirmation");
    assert.equal(complete.businessState.phoneConfirmed, false);
    await session.close();
  });
  it("continues eight digits after an initial two rather than replacing them", () => {
    const state = step("seven zero", phoneState()).state;
    assert.equal(step("seven zero two five nine five four four", state).state.slots.phoneNumber, "7070259544");
  });
  it("allows a complete retry and a negative confirmation to restart collection", () => {
    const partial = step("seven zero", phoneState()).state;
    const complete = step("7002059544", partial).state;
    const rejected = step("নহয়", complete).state;
    assert.equal(rejected.slots.phoneNumber, undefined); assert.equal(rejected.phoneConfirmed, false);
    assert.equal(rejected.lastQuestion, "phoneNumber");
    assert.equal(step("9000000000", rejected).state.slots.phoneNumber, "9000000000");
  });
  it("accepts natural Assamese, Hindi and English confirmation sentences", () => {
    const ready = step("7002059544", phoneState()).state;
    for (const text of ["হয়, শুদ্ধ, হয় শুদ্ধ, দিনং কৰিব।", "হয় শুদ্ধ, নম্বৰটো শুদ্ধ।", "ঠিক আছে", "Yes, that number is correct.", "हाँ, नंबर सही है।"]) {
      const result = step(text, ready);
      assert.equal(result.state.phoneConfirmed, true, text);
      assert.equal(result.state.lastQuestion, null, text);
      assert.match(result.response, /বুক হোৱা নাই/u);
    }
  });
  it("prioritizes natural negative confirmation over positive words", () => {
    const ready = step("7002059544", phoneState()).state;
    for (const text of ["হয়, কিন্তু নম্বৰটো শুদ্ধ নহয়।", "নম্বৰটো ভুল হৈছে", "Yes, that is not correct.", "नंबर सही नहीं है।"]) {
      const result = step(text, ready);
      assert.equal(result.state.phoneConfirmed, false, text);
      assert.equal(result.state.slots.phoneNumber, undefined, text);
      assert.equal(result.state.lastQuestion, "phoneNumber", text);
    }
    for (const text of ["সেনাৰ", "হয়তো শুদ্ধ", "Is that correct?"]) {
      const result = step(text, ready);
      assert.equal(result.state.phoneConfirmed, false, text);
      assert.equal(result.state.slots.phoneNumber, "7002059544", text);
      assert.equal(result.state.lastQuestion, "phoneConfirmation", text);
    }
  });
  it("keeps Assamese replies for English digit input then accepts the reported confirmation", async () => {
    const { ConversationSession } = await import("../src/agent/llm.js");
    const session = new ConversationSession(new MockLLMProvider({ fixedResponse: "Hello." }), { roomName: "test-room", participantIdentity: "test-user" });
    await session.processUserUtterance("ডক্টৰ বৰুৱাৰ লগত");
    await session.processUserUtterance("দহ বজাত");
    await session.processUserUtterance("মোৰ নাম Test Caller");
    assert.equal(session.isCollectingPhoneNumber(), true);
    const readback = await session.processUserUtterance("7 double 0 2 0 5 9 5 double 4");
    assert.match(readback.text, /শুদ্ধনে/u);
    assert.equal(session.getSnapshot().conversation.language, "as");
    assert.equal(session.isCollectingPhoneNumber(), false);
    const unclear = await session.processUserUtterance("সেনাৰ");
    assert.equal(unclear.isFallback, false); assert.match(unclear.text, /শুদ্ধনে/u);
    assert.doesNotMatch(unclear.text, /সাত শূন্য/u);
    const confirmed = await session.processUserUtterance("হয়, শুদ্ধ, হয় শুদ্ধ, দিনং কৰিব।");
    assert.equal(confirmed.businessState.phoneConfirmed, true);
    assert.match(confirmed.text, /বুক হোৱা নাই/u);
    assert.doesNotMatch(confirmed.text, /শুদ্ধনে/u);
    await session.close();
  });
  it("keeps double pending across fragments and rejects unknown digit words", () => {
    const partial = step("seven double", phoneState()).state;
    const next = step("zero two zero five nine five double four", partial).state;
    assert.equal(next.slots.phoneNumber, "7002059544");
    const unclear = step("ফাইভ দহ।", phoneState());
    assert.equal(unclear.state.slots.phoneNumber, undefined); assert.equal(unclear.state.phoneIssue, "unclear");
    assert.equal(unclear.state.phoneDraftText, ""); assert.match(unclear.response, /স্পষ্ট নহ'ল/u);
    assert.equal(step("জিৰ' টিঅ''", phoneState()).state.phoneIssue, "unclear");
    assert.equal(normalizePhoneNumber("জিৰ' টu' ফাইভ নাইন").digits, "0259");
  });
  it("never silently accepts extra digits or a dangling double", () => {
    for (const text of ["70020595444", "7002059544 double", "7002059544 টিঅ"]) {
      const result = step(text, phoneState());
      assert.equal(result.state.slots.phoneNumber, undefined, text);
    }
  });
  it("supports explicit restart after a partial number", () => {
    const partial = step("seven zero", phoneState()).state;
    const restarted = step("নতুনকৈ nine zero zero", partial).state;
    assert.equal(normalizePhoneNumber(restarted.phoneDraftText).digits, "900");
  });
  it("retains the pending phone question if recovery speech replaces a reply", () => {
    const partial = step("seven zero", phoneState()).state;
    const recovered = clinicDemoBehavior.onResponse!("ক্ষমা কৰিব, আকৌ এবাৰ ক'ব পাৰিবনে?", partial);
    assert.equal(recovered.lastQuestion, "phoneNumber");
    assert.equal(step("zero two zero five nine five double four", recovered).state.slots.phoneNumber, "7002059544");
  });
  it("uses the real SDK engine to retain and confirm partial dictation", async () => {
    const config = createClinicDemoConfig("Test clinic");
    const session = new AgentSession(config, { organizationId: "test-org", agentId: config.agentId, sessionId: "test-dictation" },
      new MockLLMProvider({ fixedResponse: "Hello." }), clinicDemoBehavior);
    await session.processUserUtterance("ডঃ প্ৰবল হাজৰিকাৰ লগত");
    await session.processUserUtterance("কাইলৈ ৰাতিপুৱা ১০ বজাত");
    await session.processUserUtterance("মোৰ নাম উদয় বৰা");
    await session.processUserUtterance("seven zero zero two");
    const number = await session.processUserUtterance("zero five nine five double four");
    assert.equal(number.businessState.slots.phoneNumber, "7002059544");
    assert.equal(number.businessState.lastQuestion, "phoneConfirmation");
    const yes = await session.processUserUtterance("হয়");
    assert.equal(yes.businessState.phoneConfirmed, true); assert.match(yes.text, /বুক হোৱা নাই/u);
    await session.close();
  });
});


describe("Qualified speech recovery outcomes", () => {
  it("waits for a delayed first final instead of marking hello audio delivered as no-transcript", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const turns: string[] = [], recovery: string[] = []; let finalRequests = 0;
    const collector = new TurnCollector({ pauseMs: () => 1200, finalTranscriptGraceMs: 1500,
      onAwaitingFinal: () => { finalRequests++; }, onTurn: turn => { turns.push(turn.text); }, onUnusable: reason => { recovery.push(reason); }, onError: assert.fail });
    collector.speechStarted(); collector.speechEnded(); t.mock.timers.tick(1200);
    assert.equal(finalRequests, 1); assert.deepEqual(recovery, []);
    t.mock.timers.tick(400); collector.addFinal(fragment("হেল্ল'")); t.mock.timers.tick(0);
    assert.deepEqual(turns, ["হেল্ল'"]); t.mock.timers.tick(5000); assert.deepEqual(recovery, []); collector.close();
  });
  it("bounds missing-final grace even if interims continue and cancels it on close", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const recovery: string[] = []; let requests = 0;
    const collector = new TurnCollector({ pauseMs: () => 20, finalTranscriptGraceMs: 100, onAwaitingFinal: () => { requests++; },
      onTurn: () => assert.fail("No final"), onUnusable: reason => { recovery.push(reason); }, onError: assert.fail });
    collector.speechStarted(); collector.speechEnded(); t.mock.timers.tick(20);
    collector.interimReceived(); t.mock.timers.tick(100);
    assert.equal(requests, 1); assert.deepEqual(recovery, ["no_transcript"]);
    collector.speechStarted(); collector.speechEnded(); t.mock.timers.tick(20); collector.close(); t.mock.timers.tick(5000);
    assert.deepEqual(recovery, ["no_transcript"]);
  });
  it("reports rejected speech and missing transcripts once without inventing a user turn", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const outcomes: string[] = [], turns: TranscriptFragment[] = [];
    const collector = new TurnCollector({ pauseMs: () => 20, onTurn: turn => { turns.push(turn); }, onError: assert.fail,
      acceptFragment: () => false, onUnusable: reason => { outcomes.push(reason); } });
    collector.speechStarted(); collector.addFinal(fragment("untrusted")); collector.speechEnded(); t.mock.timers.tick(20);
    collector.speechStarted(); collector.speechEnded(); t.mock.timers.tick(20); t.mock.timers.tick(1000);
    assert.deepEqual(outcomes, ["speech_unclear", "no_transcript"]); assert.deepEqual(turns, []); collector.close();
  });
  it("does not trigger speech recovery for unqualified hallucinated transcripts or after close", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const outcomes: string[] = [];
    const collector = new TurnCollector({ pauseMs: () => 20, onTurn: () => assert.fail("No accepted turn expected"), onError: assert.fail,
      acceptFragment: () => false, onUnusable: reason => { outcomes.push(reason); } });
    collector.addFinal(fragment("noise")); t.mock.timers.tick(20);
    collector.speechStarted(); collector.speechEnded(); collector.close(); t.mock.timers.tick(100);
    assert.deepEqual(outcomes, []);
  });
});
