import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AgentSession, agentConfigSchema, buildPrompt, MemorySessionStore, SESSION_TTL_SECONDS, sessionKey,
  type AgentConfigInput, type BusinessBehavior, type SessionContext, type SessionSnapshot, type SessionStore } from "../src/components/agent/engine/index.js";
import { MockLLMProvider } from "../src/components/agent/providers/llm/mock.js";
import { ProviderModel } from "../src/components/agent/providers/llm/agents-model.js";
import type { LLMMessage, LLMChunk, LLMOptions } from "../src/components/agent/providers/llm/types.js";
import { clinicDemoBehavior, createClinicDemoConfig, extractSlotsFromText } from "../src/components/agent/business/clinic-demo.js";
import { RedisSessionStore } from "../src/components/agent/session-store.js";
import { participantSessionContext } from "../src/agent/session-context.js";
import type { ModelRequest } from "@openai/agents";
import { getEventListeners } from "node:events";
import { HuggingFaceLLMProvider } from "../src/components/agent/providers/llm/huggingface.js";
import { GroqLLMProvider } from "../src/components/agent/providers/llm/groq.js";
import { dispatchTranscriptCallback } from "../src/agent/stt.js";

const config: AgentConfigInput = { agentId: "hotel-agent", name: "Reception", businessName: "River Hotel",
  instructions: "Answer hotel inquiries using supplied facts.", languages: ["as", "hi", "en"], defaultLanguage: "as" };
const hotel: BusinessBehavior<{ request: string }> = {
  stateSchema: z.object({ request: z.string() }).strict(), initialState: () => ({ request: "" }),
  update: text => ({ request: text }), promptContext: state => JSON.stringify(state),
};
const context = (organizationId = "org-a"): SessionContext => ({ organizationId, agentId: "hotel-agent", sessionId: randomUUID() });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
class ControlledProvider extends MockLLMProvider {
  readonly started = deferred();
  readonly release = deferred();
  calls = 0;
  inputs: LLMMessage[][] = [];
  override async *generate(messages: LLMMessage[], options?: Partial<LLMOptions>): AsyncIterable<LLMChunk> {
    this.inputs.push(structuredClone(messages));
    if (++this.calls === 1) { this.started.resolve(); await this.release.promise; }
    // Intentionally ignores cancellation to prove the engine rejects late provider results.
    yield { type: "text", delta: `Reply ${this.calls}.` };
    yield { type: "done" };
  }
}

describe("Phase 14 reusable engine", () => {
  it("supports a validated reply language independent of the input recognizer", async () => {
    const session = new AgentSession(config, context(), new MockLLMProvider({ fixedResponse: "Hello." }), hotel);
    await session.processUserUtterance("seven double zero", { responseLanguage: "as" });
    assert.equal(session.getState().language, "as");
    await session.processUserUtterance("Please speak English");
    assert.equal(session.getState().language, "en");
    await session.close();
  });
  it("rejects unsupported reply language before accepting a turn", async () => {
    const session = new AgentSession({ ...config, languages: ["as"] }, context(), new MockLLMProvider(), hotel);
    await assert.rejects(session.processUserUtterance("seven", { responseLanguage: "en" }), /supported/u);
    assert.equal(session.getHistory().length, 0); assert.equal(session.getSnapshot().session.turnCount, 0);
    await session.close();
  });
  it("carries the reported live transcript sequence past the doctor question even with empty model output", async () => {
    class WelcomeThenEmpty extends MockLLMProvider {
      calls = 0;
      override async *generate(): AsyncIterable<LLMChunk> {
        if (++this.calls === 1) yield { type: "text", delta: "নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেলথ ক্লিনিকত আপোনাক স্বাগতম। আপুনি কোন ডাক্তৰৰ সৈতে দেখা কৰিব বিচাৰে?" };
        yield { type: "done", finishReason: this.calls === 1 ? "stop" : "length", usage: { completionTokens: 256 } };
      }
    }
    const c = createClinicDemoConfig("Clinic");
    const session = new AgentSession(c, { ...context(), agentId: c.agentId }, new WelcomeThenEmpty(), clinicDemoBehavior);
    const greeting = await session.processUserUtterance("হেল্ল'");
    assert.equal(greeting.businessState.lastQuestion, "doctor");
    for (const text of ["নৌ", "সেনাৰে এজন এজন এজন"]) {
      const reply = await session.processUserUtterance(text);
      assert.equal(reply.businessState.slots.doctor, undefined);
    }
    for (const text of ["হয় মই ডঃ বৰুৱা লগত দেখুৱাব বুজিছোঁ।", "এক", "ডঃ বৰুৱা", "মই মই ডঃ", "ডঃ বৰুৱাৰ লগত এপইণ্টমেণ্ট লগত বিচাৰিছিল।"]) {
      const reply = await session.processUserUtterance(text);
      assert.equal(reply.businessState.slots.doctor, "ডাঃ বৰুৱা");
      assert.match(reply.text, /তাৰিখ|সময়/u);
      assert.equal(reply.fallbackReason, "empty_output");
    }
    assert.match((await session.processUserUtterance("কাইলৈ")).text, /নাম/u);
    assert.match((await session.processUserUtterance("উদয় বৰা")).text, /ফোন/u);
    assert.match((await session.processUserUtterance("9000000000")).text, /বুক হোৱা নাই/u);
    await session.close();
  });
  it("retries an empty text completion once without duplicating conversation history", async () => {
    class EmptyThenText extends MockLLMProvider {
      calls = 0;
      override async *generate(): AsyncIterable<LLMChunk> {
        if (++this.calls === 2) yield { type: "text", delta: "Hello, how can I help?" };
        yield { type: "done", finishReason: this.calls === 1 ? "length" : "stop", usage: { completionTokens: 256 } };
      }
    }
    const provider = new EmptyThenText(); const events: string[] = [];
    const session = new AgentSession(config, context(), provider, hotel, { logger: { event: (event, _context, meta) => events.push(JSON.stringify({ event, meta })) } });
    const result = await session.processUserUtterance("hello");
    assert.equal(provider.calls, 2); assert.equal(result.isFallback, false);
    assert.equal(session.getHistory().length, 2); assert.match(events.join(""), /provider_empty_output|length/u);
    await session.close();
  });
  it("does not repeat generic empty-output recovery or expose internal reasoning", async () => {
    const session = new AgentSession(config, context(), new MockLLMProvider({ fixedResponse: "<think>private internal reasoning</think>" }), hotel);
    const a = await session.processUserUtterance("hello"); const b = await session.processUserUtterance("again");
    assert.equal(a.fallbackReason, "empty_output"); assert.equal(b.fallbackReason, "empty_output");
    assert.notEqual(a.text, b.text); assert.doesNotMatch(a.text + b.text, /private|reasoning/u); await session.close();
  });
  it("does not retry an empty completion after interruption", async () => {
    const controller = new AbortController(); let calls = 0;
    class Empty extends MockLLMProvider {
      override async *generate(): AsyncIterable<LLMChunk> { calls++; yield { type: "done" }; }
    }
    const session = new AgentSession(config, context(), new Empty(), hotel, { logger: { event: event => { if (event === "provider_empty_output") controller.abort(); } } });
    await assert.rejects(session.processUserUtterance("hello", { abortSignal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, 1); assert.equal(session.getHistory().length, 1); await session.close();
  });
  it("records the model's actual intake question so a bare name answer has context", async () => {
    const c = createClinicDemoConfig("Clinic");
    const session = new AgentSession(c, { ...context(), agentId: c.agentId }, new MockLLMProvider({ fixedResponse: "Which doctor would you like to see?" }), clinicDemoBehavior);
    const greeting = await session.processUserUtterance("hello"); assert.equal(greeting.businessState.lastQuestion, "doctor");
    const name = await session.processUserUtterance("Baruah"); assert.equal(name.businessState.slots.doctor, "Baruah");
    assert.match(name.text, /date|time/u); await session.close();
  });
  it("drains new transcripts while an earlier reply is still processing", async () => {
    const firstReply = deferred(); const observed: number[] = [];
    dispatchTranscriptCallback(async () => { observed.push(1); await firstReply.promise; observed.push(3); }, () => assert.fail("unexpected callback error"));
    dispatchTranscriptCallback(() => { observed.push(2); }, () => assert.fail("unexpected callback error"));
    assert.deepEqual(observed, [1, 2]); firstReply.resolve(); await firstReply.promise; await Promise.resolve();
    assert.deepEqual(observed, [1, 2, 3]);
    let errors = 0;
    dispatchTranscriptCallback(async () => { throw new Error("failure"); }, () => { errors++; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(errors, 1);
  });
  it("preserves Groq finish/usage metadata and a final SSE line without a trailing newline", async () => {
    const original = globalThis.fetch; const requests: Record<string, unknown>[] = [];
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('data: {"choices":[{"delta":{"content":"Hello."},"finish_reason":"stop"}],"x_groq":{"usage":{"completion_tokens":8}}}');
    };
    try {
      const qwen = new GroqLLMProvider({ apiKey: "test-key", model: "qwen/qwen3.8-27b" });
      const chunks: LLMChunk[] = [];
      for await (const chunk of qwen.generate([{ role: "user", content: "hello" }])) chunks.push(chunk);
      assert.deepEqual(chunks[0], { type: "text", delta: "Hello." });
      const done = chunks.at(-1); assert.equal(done?.type, "done");
      if (done?.type === "done") { assert.equal(done.finishReason, "stop"); assert.equal(done.usage?.completionTokens, 8); }
      assert.equal(requests[0]?.reasoning_effort, "none"); assert.equal(requests[0]?.reasoning_format, "hidden");
      assert.equal(requests[0]?.max_completion_tokens, 256);
      const other = new GroqLLMProvider({ apiKey: "test-key", model: "openai/gpt-oss-20b" });
      for await (const _chunk of other.generate([{ role: "user", content: "hello" }])) { /* consume */ }
      assert.equal(requests[1]?.reasoning_effort, undefined);
    } finally { globalThis.fetch = original; }
  });
  it("validates configuration and matching trusted context", () => {
    assert.throws(() => agentConfigSchema.parse({ ...config, languages: ["en"] }));
    assert.throws(() => agentConfigSchema.parse({ ...config, recoveryMessages: { en: "  " } }));
    assert.throws(() => agentConfigSchema.parse({ ...config, modelSettings: { temperature: 5 } }));
    assert.throws(() => new AgentSession(config, { ...context(), agentId: "other" }, new MockLLMProvider(), hotel));
  });
  it("runs clinic and hotel configurations through the same SDK engine", async () => {
    const provider = new MockLLMProvider({ fixedResponse: "How can I help?" });
    const hotelSession = new AgentSession(config, context(), provider, hotel);
    const clinicConfig = createClinicDemoConfig("Clinic");
    const clinic = new AgentSession(clinicConfig, { ...context(), agentId: clinicConfig.agentId }, provider, clinicDemoBehavior);
    const a = await hotelSession.processUserUtterance("I need a room.");
    const b = await clinic.processUserUtterance("I need an appointment.");
    assert.equal(a.businessState.request, "I need a room.");
    assert.equal(b.businessState.intakeActive, true);
    assert.match(b.text, /doctor/iu);
    assert.equal("slots" in a.businessState, false);
    await Promise.all([hotelSession.close(), clinic.close()]);
  });
  it("isolates tenant state and freezes independent nested snapshots", async () => {
    const store = new MemorySessionStore();
    const c1 = context(); const c2 = { ...c1, organizationId: "org-b" };
    const a = new AgentSession(config, c1, new MockLLMProvider(), hotel, { store });
    const b = new AgentSession(config, c2, new MockLLMProvider(), hotel, { store });
    await a.processUserUtterance("private request"); await b.ready;
    assert.equal(b.getHistory().length, 0);
    assert.notEqual(sessionKey(c1), sessionKey(c2));
    const snapshot = a.getState();
    assert.throws(() => { (snapshot.businessState as { request: string }).request = "changed"; });
    assert.throws(() => { (a.config.languages as string[]).push("hi"); });
    assert.notEqual(a.getState(), snapshot);
    await a.close(); assert.equal(store.get(c1), undefined); assert.ok(store.get(c2)); await b.close();
  });
  it("preserves multilingual prompts and defaults for numeral-only input", async () => {
    const session = new AgentSession(config, context(), new MockLLMProvider(), hotel);
    for (const [text, language] of [["নমস্কাৰ appointment", "as"], ["नमस्ते", "hi"], ["12345", "hi"], ["Hello", "en"]] as const) {
      await session.processUserUtterance(text);
      assert.equal(session.getState().language, language);
      assert.match(buildPrompt(session.config, language), new RegExp(`Current caller language: ${language}`));
    }
    assert.match(buildPrompt(session.config, "as"), /confirmed tool result/iu);
    await session.close();
  });
  it("retains only supplied clinic dates and refuses to confirm a booking", async () => {
    assert.equal(extractSlotsFromText("tomorrow").dateOrTime, "tomorrow");
    assert.equal(extractSlotsFromText("দহ বজাত").dateOrTime, "দহ বজাত");
    assert.equal(extractSlotsFromText("hello").dateOrTime, undefined);
    const c = createClinicDemoConfig("Clinic");
    const session = new AgentSession(c, { ...context(), agentId: c.agentId }, new MockLLMProvider({ fixedResponse: "Your booking succeeded." }), clinicDemoBehavior);
    await session.processUserUtterance("Dr. Baruah tomorrow");
    await session.processUserUtterance("my name is Rahul Bora");
    const result = await session.processUserUtterance("7002059544");
    assert.match(result.text, /has not been booked/iu);
    assert.equal(result.businessState.slots.dateOrTime, "tomorrow");
    await session.close();
  });
  it("advances the clinic demo after a bare doctor name and bare caller name", async () => {
    const config = createClinicDemoConfig("Clinic");
    const session = new AgentSession(config, { ...context(), agentId: config.agentId }, new MockLLMProvider(), clinicDemoBehavior);
    const first = await session.processUserUtterance("মোক এটা এপইণ্টমেণ্ট লাগিব।");
    assert.equal(first.text, "আপুনি কোনজন চিকিৎসকৰ ওচৰলৈ যাব বিচাৰে অনুগ্ৰহ কৰি কওক।");
    const doctor = await session.processUserUtterance("বৰুৱা।");
    assert.equal(doctor.businessState.slots.doctor, "ডাঃ বৰুৱা");
    assert.match(doctor.text, /তাৰিখ|সময়/u); assert.notEqual(doctor.text, first.text);
    await session.processUserUtterance("কাইলৈ।");
    const name = await session.processUserUtterance("উদয় বৰা।");
    assert.equal(name.businessState.slots.patientName, "উদয় বৰা"); assert.match(name.text, /ফোন/u);
    const complete = await session.processUserUtterance("9000000000");
    assert.match(complete.text, /বুক হোৱা নাই/u); await session.close();
  });
  it("recognizes common spoken doctor title spellings without title-dependent looping", async () => {
    for (const text of ["ডাক্তৰ বৰুৱাৰ লগত দেখুৱাব বিচাৰোঁ।", "ডাক্টৰ বৰুৱা।", "ডক্টৰ বৰুৱা।", "বৰুৱা ডাক্তৰ।", "ডাঃ বৰুৱা।", "ডা. বৰুৱা।"]) {
      assert.equal(extractSlotsFromText(text).doctor, "ডাঃ বৰুৱা", text);
    }
    assert.equal(extractSlotsFromText("doctor baruah").doctor, "Dr. baruah");
    assert.equal(extractSlotsFromText("I need a doctor consultation").doctor, undefined);
    assert.equal(extractSlotsFromText("কোনজন ডাক্তৰ?").doctor, undefined);
  });
  it("clarifies an unresolved detail without guessing a doctor or repeating the same reply", async () => {
    const config = createClinicDemoConfig("Clinic");
    const session = new AgentSession(config, { ...context(), agentId: config.agentId }, new MockLLMProvider(), clinicDemoBehavior);
    const first = await session.processUserUtterance("এপইণ্টমেণ্ট লাগিব।");
    for (const text of ["নাজানো।", "কাইলৈ।", "কোনজন চিকিৎসক?"]) {
      const previous = session.getState().lastAssistantUtterance;
      const result = await session.processUserUtterance(text);
      assert.equal(result.businessState.slots.doctor, undefined);
      assert.notEqual(result.text, previous);
    }
    const fixed = await session.processUserUtterance("বৰুৱা");
    assert.equal(fixed.businessState.slots.doctor, "ডাঃ বৰুৱা");
    assert.notEqual(fixed.text, first.text); await session.close();
  });
  it("applies the same policy to chat, replay chunks and history", async () => {
    const session = new AgentSession(config, context(), new MockLLMProvider({ fixedResponse: "**Hello** <b>there</b> 😀." }), hotel);
    const result = await session.processUserUtterance("hello");
    const chunks: string[] = [];
    for await (const chunk of result.stream) if (chunk.type === "text") chunks.push(chunk.delta);
    assert.equal(chunks.join(""), result.text);
    assert.doesNotMatch(result.text, /[*<>😀]/u);
    assert.equal(session.getHistory().at(-1)?.content, result.text);
    const chat = await session.chat("hello again");
    assert.equal(chat.text, session.config.recoveryMessages.en);
    await session.close();
  });
  it("uses localized recovery for empty, whitespace and provider failures", async () => {
    for (const fixedResponse of ["", "  "]) {
      const session = new AgentSession(config, context(), new MockLLMProvider({ fixedResponse }), hotel);
      const result = await session.processUserUtterance("নমস্কাৰ");
      assert.equal(result.isFallback, true); assert.equal(result.text, session.config.recoveryMessages.as); await session.close();
    }
    class Failure extends MockLLMProvider {
      override async *generate(): AsyncIterable<LLMChunk> { throw new Error("secret provider payload"); }
    }
    const events: string[] = [];
    const session = new AgentSession(config, context(), new Failure(), hotel, { logger: {
      event: (event, ctx, meta) => events.push(JSON.stringify({ event, ctx, meta })),
    } });
    const result = await session.processUserUtterance("sensitive caller text");
    assert.equal(result.isFallback, true);
    assert.doesNotMatch(events.join(""), /secret|sensitive/u);
    await session.close();
  });
  it("rejects unregistered model tool calls without executing them", async () => {
    class ToolProvider extends MockLLMProvider {
      override async *generate(): AsyncIterable<LLMChunk> {
        yield { type: "tool_call", toolCall: { id: "1", name: "book", arguments: "{}" } };
      }
    }
    const session = new AgentSession(config, context(), new ToolProvider(), hotel);
    const result = await session.processUserUtterance("book it");
    assert.equal(result.isFallback, true); assert.doesNotMatch(result.text, /succeeded/u); await session.close();
  });
  it("supports the SDK streamed model interface", async () => {
    const model = new ProviderModel(new MockLLMProvider({ fixedResponse: "Hello." }));
    const request: ModelRequest = { input: "hi", modelSettings: {}, tools: [], handoffs: [], outputType: "text", tracing: false };
    const types: string[] = [];
    for await (const event of model.getStreamedResponse(request)) types.push(event.type);
    assert.deepEqual(types, ["response_started", "output_text_delta", "response_done"]);
  });
  it("rejects pre-aborted/empty turns before modifying history", async () => {
    const session = new AgentSession(config, context(), new MockLLMProvider(), hotel);
    await assert.rejects(session.processUserUtterance("  "));
    await assert.rejects(session.processUserUtterance("hi", { abortSignal: AbortSignal.abort() }));
    assert.equal(session.getHistory().length, 0); await session.close();
  });
  it("interruption discards late generation and retains the accepted user turn", async () => {
    const provider = new ControlledProvider();
    const session = new AgentSession(config, context(), provider, hotel);
    const turn = session.processUserUtterance("first");
    const rejected = assert.rejects(turn, { name: "AbortError" });
    await provider.started.promise; await session.notifyInterruption(1); provider.release.resolve(); await rejected;
    assert.deepEqual(session.getHistory().map(m => m.role), ["user"]);
    await session.close();
  });
  it("new turns supersede late generation with no stale assistant commit", async () => {
    const provider = new ControlledProvider();
    const session = new AgentSession(config, context(), provider, hotel);
    const first = session.processUserUtterance("first"); const rejected = assert.rejects(first, { name: "AbortError" });
    await provider.started.promise;
    const second = await session.processUserUtterance("second"); provider.release.resolve(); await rejected;
    assert.equal(second.turnId, 2);
    assert.deepEqual(session.getHistory().map(m => m.turnId), [1, 2, 2]);
    await session.close();
  });
  it("marks interrupted playback and excludes it from the next model context", async () => {
    class Capture extends MockLLMProvider {
      inputs: LLMMessage[][] = [];
      override async *generate(messages: LLMMessage[], options?: Partial<LLMOptions>): AsyncIterable<LLMChunk> {
        this.inputs.push(messages); yield* super.generate(messages, options);
      }
    }
    const provider = new Capture(); const session = new AgentSession(config, context(), provider, hotel);
    await session.processUserUtterance("hi"); await session.notifyInterruption(1);
    assert.equal(session.getHistory()[1]?.interrupted, true);
    await session.processUserUtterance("again");
    assert.equal(provider.inputs[1]?.some(m => m.role === "assistant"), false); await session.close();
  });
  it("reset invalidates in-flight turns and preserves monotonic IDs", async () => {
    const provider = new ControlledProvider(); const session = new AgentSession(config, context(), provider, hotel);
    const first = session.processUserUtterance("first"); const rejected = assert.rejects(first);
    await provider.started.promise; await session.reset(); provider.release.resolve(); await rejected;
    assert.equal(session.getHistory().length, 0);
    assert.equal((await session.processUserUtterance("next")).turnId, 2); await session.close();
  });
  it("close is idempotent and aborts in-flight generation", async () => {
    const provider = new ControlledProvider(); const store = new MemorySessionStore();
    const ctx = context(); const session = new AgentSession(config, ctx, provider, hotel, { store });
    const first = session.processUserUtterance("first"); const rejected = assert.rejects(first);
    await provider.started.promise; const closed = session.close(); assert.equal(session.close(), closed);
    await closed; provider.release.resolve(); await rejected;
    assert.equal(store.get(ctx), undefined); await assert.rejects(session.processUserUtterance("next"), /closed/u);
  });
  it("serializes Redis writes, refreshes expiry and deletes after pending writes", async () => {
    const records: Array<{ key: string; state: SessionSnapshot<unknown>; ttl: number }> = [];
    const gate = deferred(); const entered = deferred(); const operations: string[] = [];
    const client = {
      set: async (key: string, value: string, options: { EX: number }) => {
        operations.push("set"); if (!records.length) { entered.resolve(); await gate.promise; }
        records.push({ key, state: JSON.parse(value) as SessionSnapshot<unknown>, ttl: options.EX });
      },
      del: async (key: string) => { operations.push(`del:${key}`); },
    };
    const ctx = context(); const session = new AgentSession(config, ctx, new MockLLMProvider(), hotel, { store: new RedisSessionStore(client) });
    await entered.promise; const turn = session.processUserUtterance("hello"); gate.resolve(); await turn;
    assert.deepEqual(records.map(r => r.state.conversation.history.length), [0, 1, 2]);
    assert.ok(records.every(r => r.ttl === SESSION_TTL_SECONDS && r.key === sessionKey(ctx)));
    await session.close(); assert.equal(operations.at(-1), `del:${sessionKey(ctx)}`);
  });
  it("memory storage expires stale sessions and refreshes on writes", async () => {
    let now = 0; const store = new MemorySessionStore(() => now); const ctx = context();
    const session = new AgentSession(config, ctx, new MockLLMProvider(), hotel, { store }); await session.ready;
    now += 1000; await session.processUserUtterance("hello"); now = SESSION_TTL_SECONDS * 1000;
    assert.ok(store.get(ctx)); now += 1000; assert.equal(store.get(ctx), undefined); await session.close();
  });
  it("storage failures close the affected session, clear state and log safely", async () => {
    let deleted = 0; const events: string[] = [];
    const store: SessionStore = { save: async () => { throw new Error("redis password"); }, delete: async () => { deleted++; } };
    const session = new AgentSession(config, context(), new MockLLMProvider(), hotel, { store, logger: { event: event => events.push(event) } });
    await assert.rejects(session.ready, /storage failed/u);
    assert.equal(session.getSnapshot().session.status, "closed"); assert.equal(deleted, 1);
    assert.ok(events.includes("storage_failed")); await assert.rejects(session.processUserUtterance("next")); await session.close();
  });
  it("rejects malformed or missing participant organization metadata", () => {
    assert.throws(() => participantSessionContext("", "session"));
    assert.throws(() => participantSessionContext('{"organizationId":"untrusted"}', "session"));
    const metadata = JSON.stringify({ organizationId: randomUUID(), userId: randomUUID(), agentId: null });
    assert.equal(participantSessionContext(metadata, "session").agentId, "clinic-demo");
  });
  it("accepts the frontend demo ID using the existing token API contract", () => {
    const metadata = { organizationId: randomUUID(), userId: randomUUID(), agentId: "agent-clinic-opd-01" };
    assert.equal(participantSessionContext(JSON.stringify(metadata), "session").agentId, metadata.agentId);
    assert.throws(() => participantSessionContext(JSON.stringify({ ...metadata, agentId: 42 }), "session"));
    assert.throws(() => participantSessionContext(JSON.stringify({ ...metadata, agentId: "x".repeat(101) }), "session"));
    assert.throws(() => participantSessionContext(JSON.stringify({ ...metadata, organizationId: "invalid" }), "session"));
  });
  it("external abort cancels generation without fallback even if the provider ignores it", async () => {
    const provider = new ControlledProvider(); const caller = new AbortController();
    const session = new AgentSession(config, context(), provider, hotel);
    const turn = session.processUserUtterance("private", { abortSignal: caller.signal });
    const rejected = assert.rejects(turn, { name: "AbortError" });
    await provider.started.promise; caller.abort(); provider.release.resolve(); await rejected;
    assert.equal(session.getHistory().length, 1); await session.close();
  });
  it("closes on mid-session storage errors before returning generated speech", async () => {
    const memory = new MemorySessionStore(); let saves = 0;
    const store: SessionStore = {
      save: async state => { if (++saves === 3) throw new Error("outage"); await memory.save(state); },
      delete: ctx => memory.delete(ctx),
    };
    const ctx = context(); const session = new AgentSession(config, ctx, new MockLLMProvider(), hotel, { store });
    await session.ready; await assert.rejects(session.processUserUtterance("hi"), /storage failed/u);
    assert.equal(memory.get(ctx), undefined); assert.equal(session.getSnapshot().session.status, "closed"); await session.close();
  });
  it("waits for an in-flight Redis write before deletion on close", async () => {
    const entered = deferred(); const release = deferred(); const operations: string[] = [];
    const store: SessionStore = {
      save: async () => { operations.push("start"); entered.resolve(); await release.promise; operations.push("saved"); },
      delete: async () => { operations.push("deleted"); },
    };
    const session = new AgentSession(config, context(), new MockLLMProvider(), hotel, { store });
    await entered.promise; const closed = session.close(); release.resolve(); await closed;
    assert.deepEqual(operations, ["start", "saved", "deleted"]);
  });
  it("forwards configuration and shared prompt rules to the injected provider", async () => {
    let captured: Partial<LLMOptions> | undefined;
    class Capture extends MockLLMProvider {
      override async *generate(messages: LLMMessage[], options?: Partial<LLMOptions>): AsyncIterable<LLMChunk> {
        captured = options; yield* super.generate(messages, options);
      }
    }
    const session = new AgentSession({ ...config, modelSettings: { model: "custom-model", maxTokens: 123, temperature: 0.1 } }, context(), new Capture(), hotel);
    await session.processUserUtterance("hello");
    assert.equal(captured?.model, "custom-model"); assert.equal(captured?.maxTokens, 123); assert.equal(captured?.temperature, 0.1);
    assert.match(captured?.systemPrompt ?? "", /River Hotel/u); assert.match(captured?.systemPrompt ?? "", /No business tools/u);
    await session.close();
  });
  it("vendor adapters compose cancellation without leaking abort listeners", async () => {
    const originalFetch = globalThis.fetch;
    const signal = new AbortController().signal;
    const listenerCount = getEventListeners(signal, "abort").length;
    const requestSignals: Array<AbortSignal | null | undefined> = [];
    globalThis.fetch = async (_input, init) => {
      requestSignals.push(init?.signal);
      init?.signal?.throwIfAborted();
      return new Response('data: {"choices":[{"delta":{"content":"Hello."}}]}\n\ndata: [DONE]\n\n');
    };
    try {
      for (const Provider of [HuggingFaceLLMProvider, GroqLLMProvider]) {
        const provider = new Provider({ apiKey: "test-key", baseURL: "http://offline.test/v1" });
        const model = new ProviderModel(provider);
        const request: ModelRequest = { input: "hello", modelSettings: {}, tools: [], handoffs: [], outputType: "text", tracing: false, signal };
        for (let i = 0; i < 5; i++) assert.equal((await model.getResponse(request)).output.length, 1);
        assert.equal(getEventListeners(signal, "abort").length, listenerCount);
        await assert.rejects(model.getResponse({ ...request, signal: AbortSignal.abort() }));
      }
      assert.ok(requestSignals.every(s => s && s !== signal));
    } finally { globalThis.fetch = originalFetch; }
  });
});
