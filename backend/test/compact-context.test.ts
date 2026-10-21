import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentSession, type BusinessBehavior, MemorySessionStore } from "../src/components/agent/engine/index.js";
import { ContextBudget, bytes } from "../src/components/agent/providers/llm/context-budget.js";
import { LLMFailure } from "../src/components/agent/providers/llm/failure.js";
import { ToolExecutor, ToolRegistry, defineTool, createServerTimeTool } from "../src/components/agent/tools/index.js";
import { createIntakeInterpreter, emptyIntake } from "../src/components/clinic/voice/intake.js";
import { ClinicVoiceRuntime } from "../src/components/clinic/voice/runtime.js";
import { ClinicDialogue } from "../src/components/clinic/voice/dialogue.js";
import { clinicReadModelSchema, projectClinicRead } from "../src/components/clinic/voice/model-results.js";
import { RedisProviderCooldown, setProviderCooldownStore } from "../src/components/agent/providers/llm/cooldown.js";
import { GroqLLMProvider } from "../src/components/agent/providers/llm/groq.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import type { Database } from "../src/lib/db/transaction-with-hooks.js";
import { UnusableSpeechRecoveryGate } from "../src/agent/voice-recovery.js";

const context = () => ({ organizationId: randomUUID(), agentId: "test", sessionId: randomUUID() });
const config = { agentId: "test", name: "Assistant", businessName: "Example", instructions: "Help from supplied facts.", languages: ["en" as const], defaultLanguage: "en" as const };
const neutral: BusinessBehavior<Record<string, never>> = { stateSchema: z.object({}), initialState: () => ({}), update: () => ({}), promptContext: () => "" };
const answer = (text: string) => [{ type: "text" as const, delta: text }, { type: "done" as const }];

test("GPT-OSS reasoning headroom is accounted for before context fitting and reaches the wire", async () => {
  const original = fetch, events: Record<string, unknown>[] = [], requests: Record<string, unknown>[] = [];
  const provider = new GroqLLMProvider({ apiKey: "offline-test", model: "openai/gpt-oss-120b" });
  const agent = new AgentSession(config, context(), provider, neutral, { logger: { event: (_name, _scope, data) => { if (data) events.push(data); } } });
  try {
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('data: {"choices":[{"delta":{"content":"Ready."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
    };
    await agent.processUserUtterance("Hello");
    assert.equal(requests[0]?.max_completion_tokens, 1536);
    assert.equal(events.find(e => e["reservedOutputTokens"] !== undefined)?.["reservedOutputTokens"], 1536);
  } finally { globalThis.fetch = original; await agent.close(); }
});

test("soft compaction keeps the previous exchange and reserves space before a tool result", () => {
  const metrics: Record<string, number | string | boolean>[] = [];
  const budget = new ContextBudget({ targetBytes: 7000, hardBytes: 12288, inputTokens: 3500 }, event => metrics.push(event));
  const messages = [{ role: "user" as const, content: "a".repeat(3500) }, { role: "assistant" as const, content: "b".repeat(3500) }, { role: "user" as const, content: "Why did it fail?" }];
  const tools = [{ name: "read", description: "Read", parameters: { type: "object", properties: {}, additionalProperties: false } }];
  assert.equal(budget.fit(messages, { tools }).messages.length, 3);
  assert.equal(metrics.at(-1)?.["reservedToolResultTokens"], 512);
  const withResult = [...messages, { role: "assistant" as const, content: "", toolCalls: [{ id: "r", name: "read", arguments: "{}" }] },
    { role: "tool" as const, content: '{"success":true}', toolCallId: "r" }];
  assert.equal(budget.fit(withResult, { tools }).messages.at(-1)?.role, "tool");
  assert.equal(metrics.at(-1)?.["reservedToolResultTokens"], 0);
});

test("unusable-speech prompts are admitted once until accepted caller input", () => {
  const gate = new UnusableSpeechRecoveryGate();
  assert.equal(gate.shouldPrompt(), true); assert.equal(gate.shouldPrompt(), false); assert.equal(gate.shouldPrompt(), false);
  gate.acceptedInput(); assert.equal(gate.shouldPrompt(), true);
});

test("clinic read-event history does not spend quota on redundant background summaries", async () => {
  const runtime = new ClinicVoiceRuntime(context(), randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("No DB calls expected"); }, logger: { info() {}, warn() {}, error() {} } });
  const provider = new ScriptedProvider(() => answer("How can I help?"));
  const session = new AgentSession(config, runtime.context, provider, runtime.behavior);
  try {
    for (let index = 0; index < 8; index++) { const result = await session.processUserUtterance("hello"); await session.notifyPlaybackResult(result.turnId, true); }
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(provider.inputs.length, 8); assert.equal(session.getState().memory, undefined);
  } finally { await session.close(); }
});

test("low observed provider quota pauses optional background work while foreground stays available", async () => {
  const original = fetch; let requests = 0;
  const provider = new GroqLLMProvider({ apiKey: randomUUID(), baseURL: "http://quota.test/v1" });
  try {
    globalThis.fetch = async () => { requests++; return Response.json({ choices: [{ message: { content: "Ready" }, finish_reason: "stop" }] },
      { headers: { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "1000" } }); };
    await provider.chat([{ role: "user", content: "hi" }]);
    await assert.rejects(provider.chat([{ role: "user", content: "summary" }], { background: true }), error => error instanceof LLMFailure && error.kind === "rate_limit");
    assert.equal(requests, 1); await provider.chat([{ role: "user", content: "continue" }]); assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test("200 SDK turns keep bounded model input while immutable full history is retained", async () => {
  const provider = new ScriptedProvider(messages => { assert.ok(messages.filter(m => m.role === "user").length <= 4); return answer("Which detail would you like next?"); });
  const session = new AgentSession(config, context(), provider, neutral);
  try {
    for (let i = 0; i < 200; i++) await session.processUserUtterance(`Turn ${i}: ${"অলপ তথ্য ".repeat(12)}`);
    assert.equal(session.getHistory().length, 400);
    for (let i = 0; i < provider.inputs.length; i++) assert.ok(bytes({ messages: provider.inputs[i], options: { ...provider.options[i], abortSignal: undefined } }) < 12288);
    assert.equal(provider.inputs.length, 200);
  } finally { await session.close(); }
});

test("post-tool 413 retries only the failed request with smaller context and never reexecutes", async () => {
  let executions = 0, rejected = false;
  const registry = new ToolRegistry([createServerTimeTool(() => { executions++; return new Date("2026-10-16T00:00:00Z"); })]);
  const provider = new ScriptedProvider((messages, call) => {
    if (messages.some(m => m.role === "tool") && !rejected) { rejected = true; throw new LLMFailure("request_limit", 413); }
    return answer(messages.some(m => m.role === "tool") ? "Clock returned." : `${call}${"x".repeat(1900)}`);
  });
  const session = new AgentSession({ ...config, enabledTools: ["get_server_time"] }, context(), provider, neutral,
    { tools: { registry, callId: "call", conversationId: "conversation" } });
  try {
    await session.processUserUtterance("first"); await session.processUserUtterance("second"); await session.processUserUtterance("third");
    const result = await session.processUserUtterance("clock", { initialToolCall: { name: "get_server_time", arguments: {} } });
    assert.equal(result.text, "Clock returned."); assert.equal(executions, 1);
    assert.equal(provider.inputs.length, 5);
    assert.ok(bytes(provider.inputs[4]) < bytes(provider.inputs[3]) * 0.9);
    assert.equal(session.getState().toolHistory.length, 1);
  } finally { await session.close(); }
});

test("mandatory oversized input is blocked locally and provider recovery does not blame speech", async () => {
  const provider = new ScriptedProvider(() => { throw new Error("Must not be called"); });
  const session = new AgentSession(config, context(), provider, neutral);
  try {
    const result = await session.processUserUtterance("অ".repeat(6000));
    assert.equal(provider.inputs.length, 0); assert.equal(result.failureCategory, "request_limit");
    assert.match(result.text, /response service/); assert.doesNotMatch(result.text, /say.*again|understand|unclear/);
    assert.equal(result.providerTtftMs, undefined); assert.equal(session.getHistory()[0]?.content.length, 6000);
  } finally { await session.close(); }
});

test("projections preserve canonical results/caching and invalid projection cannot rewrite success", async () => {
  let calls = 0;
  const tool = defineTool({ name: "sample", description: "Read", inputSchema: z.object({}), outputSchema: z.object({ full: z.string(), id: z.string() }),
    modelOutputSchema: z.object({ id: z.string() }), projectOutput: data => ({ id: data.id }), execute: async () => { calls++; return { success: true as const, data: { full: "x".repeat(5000), id: "one" } }; } });
  const registry = new ToolRegistry([tool]); const executor = new ToolExecutor(registry, ["sample"], { ...context(), callId: "c", conversationId: "v", turnId: 1 }, new AbortController().signal);
  const result = await executor.execute("sample", {}, "first");
  await executor.execute("sample", {}, "first");
  assert.equal(calls, 1); assert.ok(bytes(executor.modelResult("first", result)) < bytes(result) / 2);
  const broken = defineTool({ name: "broken", description: "Test", inputSchema: z.object({}), outputSchema: z.string(), modelOutputSchema: z.string(), projectOutput: () => 4,
    execute: async () => ({ success: true as const, data: "committed" }) });
  const other = new ToolExecutor(new ToolRegistry([broken]), ["broken"], { ...context(), callId: "c", conversationId: "v", turnId: 1 }, new AbortController().signal);
  assert.deepEqual(await other.execute("broken", {}, "second"), { success: true, data: "committed" });
  assert.deepEqual(other.history[0]?.modelResult, { success: true, data: "committed" });
});

test("doctor guidance records selection and localized date replies retain natural wording", () => {
  const dialogue = new ClinicDialogue("Asia/Kolkata");
  dialogue.plan("মোক কাইলৈ বুকিং লাগে।", "2026-10-16"); assert.equal(dialogue.state.question, "doctor");
  assert.deepEqual(dialogue.plan("বৰুৱা।", "2026-10-16").call, { name: "find_doctor", arguments: { name: "বৰুৱা" } });
  dialogue.dates(1, ["2026-10-17"]);
  assert.equal(dialogue.useful("শনিবাৰ, ১৭ অক্টোবৰ, ২০২৬ত উপলব্ধ আছে।"), true);
});

test("read projections paginate without losing ambiguity, selected IDs or full result counts", () => {
  const doctors = Array.from({ length: 9 }, (_, i) => ({ id: randomUUID(), name: `Doctor ${i}`, nameEn: `Doctor ${i}`, nameAs: null, searchAliases: ["common"], isActive: true }));
  const result = { outcome: "ambiguous", resultCount: 9, doctors, alternatives: [] };
  const first = clinicReadModelSchema.parse(projectClinicRead("find_doctor", result, 0, "en", null));
  assert.equal(first.outcome, "ambiguous"); assert.equal(first.resultCount, 9); assert.equal(first.nextOffset, 5);
  const second = projectClinicRead("find_doctor", result, 5, "en", null);
  assert.equal(clinicReadModelSchema.safeParse(second).success, true); assert.ok(bytes(first) < bytes(result));
});

test("intake interprets name and Assamese numeric age with exact evidence using real SDK", async () => {
  const provider = new ScriptedProvider(() => answer(JSON.stringify({ intent: "provide_details", name: { quote: "উদয় আশীষ বৰা", sourceTurn: 1 },
    age: { value: 28, evidence: "২৮", sourceTurn: 1 }, nextField: "phone", reply: "আপোনাৰ ফোন নম্বৰটো দিব পাৰিবনে?" })));
  const result = await createIntakeInterpreter(provider)({ text: "মোৰ নাম উদয় আশীষ বৰা আৰু বয়স ২৮।", turnId: 1, language: "as", state: emptyIntake(), phoneConfirmed: false }, new AbortController().signal);
  assert.equal(result?.age?.value, 28); assert.equal(result?.name?.value, "উদয় আশীষ বৰা");
  assert.equal(provider.inputs.length, 1); assert.deepEqual(provider.options[0]?.tools, []);
});

test("intake rejects invented evidence/numeric changes and bounds ignored cancellation", async () => {
  for (const age of [{ value: 29, evidence: "২৮", sourceTurn: 1 }, { value: 28, evidence: "not said", sourceTurn: 1 }]) {
    const provider = new ScriptedProvider(() => answer(JSON.stringify({ intent: "provide_details", name: null, age, nextField: "name", reply: "What is the name?" })));
    assert.equal(await createIntakeInterpreter(provider)({ text: "বয়স ২৮", turnId: 1, language: "as", state: emptyIntake(), phoneConfirmed: false }, new AbortController().signal), null);
  }
  const stalled = new ScriptedProvider(() => []); stalled.chat = () => new Promise(() => {});
  assert.equal(await createIntakeInterpreter(stalled, () => {}, 15)({ text: "hello", turnId: 1, language: "en", state: emptyIntake(), phoneConfirmed: false }, new AbortController().signal), null);
});

test("clinic saves intake early, asks one model-written follow-up and clears caller context on switch", async () => {
  const runtime = new ClinicVoiceRuntime(context(), randomUUID(), randomUUID(), { db: {} as Database, transaction: async () => { throw new Error("No DB"); }, logger: { info() {}, warn() {}, error() {} } }, "Asia/Kolkata", undefined,
    async input => ({ intent: "provide_details", name: { value: "Udoy Bora", evidence: "Udoy Bora", sourceTurn: input.turnId }, age: { value: 28, evidence: "28", sourceTurn: input.turnId }, nextField: "phone", reply: "Thanks. What phone number should we use?" }));
  runtime.dialogue.state.question = "patient";
  const provider = new ScriptedProvider(() => { throw new Error("No second generation"); });
  const session = new AgentSession(config, runtime.context, provider, runtime.behavior);
  try {
    const result = await session.processUserUtterance("Udoy Bora, age 28");
    assert.equal(result.replySource, "model"); assert.equal(provider.inputs.length, 0);
    assert.equal(runtime.snapshot().intake.age?.value, 28); assert.equal(runtime.snapshot().slots.patientName, "Udoy Bora");
    await session.processUserUtterance("7002059544");
    await session.processUserUtterance("7002059545"); // unconfirmed correction cannot change identity without interpretation
    assert.equal(runtime.snapshot().slots.phoneNumber, "7002059544");
    await session.reset(); assert.equal(runtime.snapshot().intake.name, null);
  } finally { await session.close(); }
});

test("optional background notes cover old turns only and cannot survive reset", async () => {
  const provider = new ScriptedProvider(messages => messages[0]?.content.startsWith('{"previous"')
    ? answer(JSON.stringify({ notes: [{ text: "Caller prefers morning discussions", sourceTurn: 1 }] })) : answer("What next?"));
  const session = new AgentSession(config, context(), provider, neutral);
  try {
    for (let i = 0; i < 8; i++) { const reply = await session.processUserUtterance(`request ${i}`); await session.notifyPlaybackResult(reply.turnId, true); }
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(session.getState().memory?.coveredTurn, 4);
    assert.equal(session.getState().memory?.notes[0]?.sourceTurn, 1);
    await session.reset(); assert.equal(session.getState().memory, undefined);
  } finally { await session.close(); }
});

test("transport sends strict structured JSON only without tools, guards wire size and honors cooldown", async () => {
  const original = fetch; let requests = 0;
  setProviderCooldownStore({ remaining: async () => 2000, extend: async () => {} });
  const provider = new GroqLLMProvider({ apiKey: randomUUID(), baseURL: "http://context.test/v1" });
  try {
    globalThis.fetch = async () => { requests++; return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }); };
    await assert.rejects(provider.chat([{ role: "user", content: "hi" }]), error => error instanceof LLMFailure && error.kind === "rate_limit");
    assert.equal(requests, 0); setProviderCooldownStore(undefined);
    await assert.rejects(provider.chat([{ role: "user", content: "a".repeat(13000) }]), error => error instanceof LLMFailure && error.kind === "request_limit");
    globalThis.fetch = async (_url, init) => { requests++; const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body["stream"], false); assert.ok(body["response_format"]); assert.equal(body["tools"], undefined);
      return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }); };
    await provider.chat([{ role: "user", content: "JSON please" }], { responseFormat: { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object", properties: {}, additionalProperties: false, required: [] } } } });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; setProviderCooldownStore(undefined); }
});

test("Redis cooldown extension is atomic and scopes workers without storing payloads", async () => {
  const calls: unknown[] = [];
  const store = new RedisProviderCooldown({ pTTL: async key => { calls.push(key); return 2500; }, eval: async (script, args) => { calls.push({ script, args }); return 1; } });
  await store.extend("opaque-scope", 2000); assert.equal(await store.remaining("opaque-scope"), 2500);
  assert.match(JSON.stringify(calls), /PSETEX/); assert.doesNotMatch(JSON.stringify(calls), /patient|transcript|apiKey/);
});

test("budget observations increase safety margins and cannot drop the current tool pair", () => {
  const budget = new ContextBudget(); const options = { systemPrompt: "rules", tools: [] };
  const messages = [{ role: "user" as const, content: "clock" }, { role: "assistant" as const, content: "", toolCalls: [{ id: "a", name: "clock", arguments: "{}" }] }, { role: "tool" as const, content: '{"success":true}', toolCallId: "a" }];
  const first = budget.fit(messages, options); budget.observe({ promptTokens: first.estimated * 2 }, first.estimated);
  const next = budget.fit(messages, options); assert.ok(next.estimated > first.estimated); assert.deepEqual(next.messages, messages);
});

test("late background summaries cannot overwrite a newer turn or survive close", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const provider = new ScriptedProvider(() => answer("What next?"));
  provider.chat = async () => { entered(); await held; return { role: "assistant", text: JSON.stringify({ notes: [{ text: "Stale note", sourceTurn: 1 }] }) }; };
  const session = new AgentSession(config, context(), provider, neutral);
  try {
    for (let i = 0; i < 8; i++) { const result = await session.processUserUtterance(`request ${i}`); await session.notifyPlaybackResult(result.turnId, true); }
    await started;
    await session.processUserUtterance("A new request"); release();
    await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(session.getState().memory, undefined);
  } finally { release(); await session.close(); }
});

test("late intake interpretation cannot overwrite the next caller turn", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const runtime = new ClinicVoiceRuntime(context(), randomUUID(), randomUUID(), { db: {} as Database, transaction: async () => { throw new Error("No DB"); }, logger: { info() {}, warn() {}, error() {} } }, "Asia/Kolkata", undefined,
    async input => {
      if (input.turnId === 1) { entered(); await held; }
      const value = input.turnId === 1 ? "Old Name" : "New Name";
      return { intent: "provide_details", name: { value, evidence: value, sourceTurn: input.turnId }, age: null, nextField: "age", reply: "How old is the patient?" };
    });
  runtime.dialogue.state.question = "patient";
  const session = new AgentSession(config, runtime.context, new ScriptedProvider(() => answer("What next?")), runtime.behavior);
  try {
    const first = session.processUserUtterance("Old Name"); await started;
    await session.processUserUtterance("New Name"); release(); await assert.rejects(first);
    assert.equal(runtime.snapshot().intake.name?.value, "New Name");
    assert.equal(session.getHistory().filter(m => m.role === "assistant").length, 1);
  } finally { release(); await session.close(); }
});

for (const sample of [
  { text: "My name is Udoy Bora and my age is twenty-eight", name: "Udoy Bora", ageText: "twenty-eight", age: 28 },
  { text: "मेरा नाम अमन है, उम्र अट्ठाईस", name: "अमन", ageText: "अट्ठाईस", age: 28 },
  { text: "মোৰ নাম উদয় বৰা, age twenty", name: "উদয় বৰা", ageText: "twenty", age: 20 },
]) test(`spoken-age proposals remain evidence-linked unconfirmed candidates: ${sample.ageText}`, async () => {
  const provider = new ScriptedProvider(() => answer(JSON.stringify({ intent: "provide_details", name: { quote: sample.name, sourceTurn: 1 },
    age: { value: sample.age, evidence: sample.ageText, sourceTurn: 1 }, nextField: "phone", reply: "What phone number should we use?" })));
  const result = await createIntakeInterpreter(provider)({ text: sample.text, turnId: 1, language: "en", state: emptyIntake(), phoneConfirmed: false }, new AbortController().signal);
  assert.equal(result?.age?.value, sample.age); assert.equal(result?.name?.value, sample.name);
});

test("conflicting ages preserve prior data and contextual help is not captured as a name", async () => {
  const runtime = new ClinicVoiceRuntime(context(), randomUUID(), randomUUID(), { db: {} as Database, transaction: async () => { throw new Error("No DB"); }, logger: { info() {}, warn() {}, error() {} } }, "Asia/Kolkata", undefined,
    async input => ({ intent: input.turnId === 3 ? "request_help" : "provide_details", name: input.turnId === 2 ? { value: "Udoy Bora", evidence: "Udoy Bora", sourceTurn: 2 } : null,
      age: input.turnId < 3 ? { value: input.turnId === 1 ? 28 : 22, evidence: input.turnId === 1 ? "28" : "22", sourceTurn: input.turnId } : null,
      nextField: input.turnId === 1 ? "name" : "age", reply: input.turnId === 1 ? "What is the patient's name?" : "What is the correct age?" }));
  runtime.dialogue.state.question = "patient";
  const provider = new ScriptedProvider(() => answer("What is the correct age?"));
  const session = new AgentSession(config, runtime.context, provider, runtime.behavior);
  try {
    await session.processUserUtterance("age 28"); await session.processUserUtterance("Udoy Bora age 22");
    assert.equal(runtime.snapshot().intake.age?.value, 28); assert.equal(runtime.snapshot().intake.unresolved, true);
    await session.processUserUtterance("What should I say?");
    assert.equal(runtime.snapshot().intake.name?.value, "Udoy Bora");
    assert.equal(runtime.snapshot().intake.age?.value, 28);
    assert.equal(runtime.snapshot().intake.unresolvedAge, true);
  } finally { await session.close(); }
});
