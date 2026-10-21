import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { z } from "zod";
import { AgentSession, MemorySessionStore, type BusinessBehavior } from "../src/components/agent/engine/index.js";
import { ToolRegistry, ToolExecutor, defineTool, createServerTimeTool, type ToolContext, type ToolResult, type ToolRuntime } from "../src/components/agent/tools/index.js";
import { sdkTools } from "../src/components/agent/tools/sdk.js";
import { RunContext } from "@openai/agents";
import { GroqLLMProvider } from "../src/components/agent/providers/llm/groq.js";
import { HuggingFaceLLMProvider } from "../src/components/agent/providers/llm/huggingface.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";
import type { LLMChunk } from "../src/components/agent/providers/llm/types.js";
import { LLMFailure } from "../src/components/agent/providers/llm/failure.js";

const fixed = "2026-10-13T00:00:00.000Z";
it("provider diagnostics categorize HTTP/network failures without retaining sensitive response bodies", async () => {
  const original = globalThis.fetch;
  const provider = new GroqLLMProvider({ apiKey: "test-key", baseURL: "http://offline.test/v1" });
  try {
    globalThis.fetch = async () => new Response("private provider body", { status: 429 });
    await assert.rejects(provider.chat([{ role: "user", content: "test" }]), error => error instanceof LLMFailure && error.kind === "rate_limit" && error.status === 429 && !error.message.includes("private"));
    globalThis.fetch = async () => { throw new Error("private request payload"); };
    await assert.rejects(provider.chat([{ role: "user", content: "test" }]), error => error instanceof LLMFailure && error.kind === "network" && !error.message.includes("private"));
  } finally { globalThis.fetch = original; }
});
const context = { organizationId: "org-a", agentId: "agent-a", sessionId: "session-a", callId: "call-a", conversationId: "conversation-a", turnId: 1 };
const clock = () => createServerTimeTool(() => new Date(fixed));
const code = (result: ToolResult) => result.success ? "OK" : result.error.code;
const neutral: BusinessBehavior<Record<string, never>> = { stateSchema: z.object({}).strict(), initialState: () => ({}), update: () => ({}), promptContext: () => "" };
const config = { agentId: "agent-a", name: "Reception", businessName: "Test business", instructions: "Use only confirmed tool results.",
  languages: ["en" as const], defaultLanguage: "en" as const, enabledTools: ["get_server_time"] };
const call = (id = "call_1", name = "get_server_time", args = "{}"): LLMChunk[] => [{ type: "tool_call", toolCall: { id, name, arguments: args } }, { type: "done" }];
const answer = (text = "The test tool completed."): LLMChunk[] => [{ type: "text", delta: text }, { type: "done" }];
function session(provider: ScriptedProvider, overrides: Partial<ToolRuntime> = {}, store = new MemorySessionStore()) {
  return new AgentSession(config, { organizationId: context.organizationId, agentId: context.agentId, sessionId: context.sessionId }, provider, neutral,
    { store, tools: { registry: new ToolRegistry([clock()]), callId: context.callId, conversationId: context.conversationId, ...overrides } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("Phase 15 tool boundary", () => {
  it("rejects duplicate names and invalid/reserved input definitions", () => {
    assert.throws(() => new ToolRegistry([clock(), clock()]), /Duplicate/u);
    assert.throws(() => defineTool({ name: "bad name", description: "test", inputSchema: z.object({}), outputSchema: z.string(), execute: async () => ({ success: true, data: "ok" }) }));
    assert.throws(() => defineTool({ name: "bad", description: "test", inputSchema: z.string(), outputSchema: z.string(), execute: async () => ({ success: true, data: "ok" }) }), /object schema/u);
    assert.throws(() => defineTool({ name: "bad", description: "test", inputSchema: z.object({ organizationId: z.string() }), outputSchema: z.string(), execute: async () => ({ success: true, data: "ok" }) }), /context/u);
    assert.throws(() => new ToolRegistry([clock()]).enabled(["missing"]), /not registered/u);
    assert.throws(() => new ToolRegistry([clock()]).enabled(["get_server_time", "get_server_time"]), /Duplicate/u);
  });
  it("freezes registry entries/schema and validates the harmless clock result", async () => {
    const registry = new ToolRegistry([clock()]);
    assert.ok(Object.isFrozen(registry)); assert.ok(Object.isFrozen(registry.get("get_server_time")));
    assert.ok(Object.isFrozen(registry.get("get_server_time")?.parameters));
    const executor = new ToolExecutor(registry, ["get_server_time"], context, new AbortController().signal);
    assert.deepEqual(await executor.execute("get_server_time", "{}", "call_1"), { success: true, data: { timestamp: fixed, timezone: "UTC" } });
  });
  it("rejects malformed, wrong-type and tenant-spoofing inputs before handler execution", async () => {
    let executions = 0;
    const echo = defineTool({ name: "echo", description: "test", inputSchema: z.object({ value: z.number().int() }), outputSchema: z.number(),
      execute: async ({ value }) => { executions++; return { success: true, data: value }; } });
    const executor = new ToolExecutor(new ToolRegistry([echo]), ["echo"], context, new AbortController().signal);
    for (const [index, args] of ['{"value":', '{"value":"1"}', '{"value":1,"organizationId":"org-b"}', 'null'].entries()) {
      assert.equal(code(await executor.execute("echo", args, `call_${index}`)), "INVALID_TOOL_INPUT");
    }
    assert.equal(executions, 0);
  });
  it("uses frozen trusted context and isolates sessions and invocation caches", async () => {
    const received: ToolContext[] = [];
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({}), outputSchema: z.string(),
      execute: async (_input, trusted) => { received.push(trusted); return { success: true, data: trusted.organizationId }; } });
    const registry = new ToolRegistry([probe]);
    const first = new ToolExecutor(registry, ["probe"], context, new AbortController().signal);
    const second = new ToolExecutor(registry, ["probe"], { ...context, organizationId: "org-b", sessionId: "session-b" }, new AbortController().signal);
    assert.deepEqual(await first.execute("probe", {}, "same_id"), { success: true, data: "org-a" });
    assert.deepEqual(await second.execute("probe", {}, "same_id"), { success: true, data: "org-b" });
    assert.ok(received.every(Object.isFrozen)); assert.equal(received[0]?.callId, context.callId);
    assert.equal(received[0]?.invocationId, "same_id"); assert.equal(received[0]?.turnId, 1);
  });
  it("validates and transforms typed arguments once before the handler", async () => {
    let transformations = 0;
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({ value: z.string().transform(value => { transformations++; return Number(value); }) }),
      outputSchema: z.number(), execute: async ({ value }) => ({ success: true, data: value + 1 }) });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, new AbortController().signal);
    assert.deepEqual(await executor.execute("probe", { value: "4" }, "one"), { success: true, data: 5 });
    assert.equal(transformations, 1);
  });
  it("rejects successful data that does not match the output schema", async () => {
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({}), outputSchema: z.string().min(5),
      execute: async () => ({ success: true, data: "bad" }) });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, new AbortController().signal);
    assert.equal(code(await executor.execute("probe", {}, "one")), "INVALID_TOOL_OUTPUT");
  });
  it("preserves optional typed inputs without advertising unsupported provider strict mode", async () => {
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({ value: z.string().optional() }), outputSchema: z.string(),
      execute: async ({ value }) => ({ success: true, data: value ?? "default" }) });
    assert.equal(probe.strict, false); assert.equal(clock().strict, true);
    const registry = new ToolRegistry([probe]);
    const executor = new ToolExecutor(registry, ["probe"], context, new AbortController().signal);
    assert.equal(sdkTools(registry, ["probe"], executor)[0]?.strict, false);
    assert.deepEqual(await executor.execute("probe", {}, "one"), { success: true, data: "default" });
    assert.equal(code(await executor.execute("probe", { unexpected: true }, "two")), "INVALID_TOOL_INPUT");
  });
  it("rejects unknown/disabled tools and invalid context", async () => {
    const executor = new ToolExecutor(new ToolRegistry([clock()]), [], context, new AbortController().signal);
    assert.equal(code(await executor.execute("missing", {}, "one")), "TOOL_NOT_FOUND");
    assert.equal(code(await executor.execute("get_server_time", {}, "two")), "TOOL_NOT_ALLOWED");
    assert.throws(() => new ToolExecutor(new ToolRegistry([clock()]), [], { ...context, organizationId: "" }, new AbortController().signal));
    const enabled = new ToolExecutor(new ToolRegistry([clock()]), ["get_server_time"], context, new AbortController().signal);
    const sdk = sdkTools(new ToolRegistry([clock()]), ["get_server_time"], enabled)[0]!;
    const result = await sdk.invoke(new RunContext({ organizationId: "org-b", agentId: context.agentId, sessionId: context.sessionId }), "{}");
    assert.equal(code(typeof result === "string" ? JSON.parse(result) as ToolResult : result), "INVALID_TOOL_CONTEXT"); assert.equal(enabled.history.length, 0);
  });
  it("returns safe failures for exceptions and invalid/non-JSON output", async () => {
    const events: string[] = [];
    const fail = defineTool({ name: "fail", description: "test", inputSchema: z.object({}), outputSchema: z.unknown(),
      execute: async () => { throw new Error("private-payload password=secret-test SQL"); } });
    const bad = defineTool({ name: "bad", description: "test", inputSchema: z.object({}), outputSchema: z.unknown(),
      execute: async () => ({ success: true, data: () => "private-payload" }) });
    const executor = new ToolExecutor(new ToolRegistry([fail, bad]), ["fail", "bad"], context, new AbortController().signal,
      { event: (event, metadata) => events.push(JSON.stringify({ event, metadata })) });
    assert.equal(code(await executor.execute("fail", {}, "one")), "TOOL_EXECUTION_FAILED");
    assert.equal(code(await executor.execute("bad", {}, "two")), "INVALID_TOOL_OUTPUT");
    assert.doesNotMatch(events.join(""), /private-payload|secret-test|SQL/u);
  });
  it("caches identical calls, rejects conflicts and protects cached results from mutation", async () => {
    let executions = 0;
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({ a: z.number(), b: z.number() }), outputSchema: z.object({ value: z.number() }),
      execute: async ({ a, b }) => { executions++; return { success: true, data: { value: a + b } }; } });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, new AbortController().signal);
    const first = await executor.execute("probe", { a: 1, b: 2 }, "same");
    if (first.success) (first.data as { value: number }).value = 99;
    assert.deepEqual(await executor.execute("probe", { b: 2, a: 1 }, "same"), { success: true, data: { value: 3 } });
    assert.equal(code(await executor.execute("probe", { a: 2, b: 2 }, "same")), "CONFLICTING_TOOL_CALL");
    assert.equal(executions, 1); assert.equal(executor.invocationCount, 1);
  });
  it("bounds call attempts and serializes handlers", async () => {
    const started = deferred(); const release = deferred(); const order: number[] = [];
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({ n: z.number() }), outputSchema: z.number(),
      execute: async ({ n }) => { order.push(n); if (n === 1) { started.resolve(); await release.promise; } return { success: true, data: n }; } });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, new AbortController().signal, undefined, { maxCalls: 2 });
    const a = executor.execute("probe", { n: 1 }, "one"); const b = executor.execute("probe", { n: 2 }, "two");
    await started.promise; assert.deepEqual(order, [1]); release.resolve(); await Promise.all([a, b]); assert.deepEqual(order, [1, 2]);
    assert.equal(code(await executor.execute("probe", { n: 3 }, "three")), "TOOL_LIMIT_EXCEEDED");
  });
  it("times out, aborts the handler signal, discards late output and stops queued calls", async () => {
    const release = deferred(); let signal: AbortSignal | undefined; let executions = 0;
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({}), outputSchema: z.number(), execute: async (_input, ctx) => {
      executions++; signal = ctx.signal; await release.promise; return { success: true, data: 1 };
    } });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, new AbortController().signal, undefined, { timeoutMs: 10 });
    const a = executor.execute("probe", {}, "one"); const b = executor.execute("probe", {}, "two");
    assert.equal(code(await a), "TOOL_TIMEOUT"); assert.equal(signal?.aborted, true);
    assert.equal(code(await b), "TOOL_RUN_STOPPED"); release.resolve(); await release.promise;
    assert.equal(executions, 1); assert.equal(code(executor.history[0]!.result), "TOOL_TIMEOUT");
  });
  it("propagates cancellation and removes abort listeners", async () => {
    const started = deferred(); const release = deferred(); const abort = new AbortController();
    const probe = defineTool({ name: "probe", description: "test", inputSchema: z.object({}), outputSchema: z.number(), execute: async () => {
      started.resolve(); await release.promise; return { success: true, data: 1 };
    } });
    const executor = new ToolExecutor(new ToolRegistry([probe]), ["probe"], context, abort.signal);
    const result = executor.execute("probe", {}, "one"); await started.promise; abort.abort();
    await assert.rejects(result); release.resolve(); assert.equal(executor.history.length, 0);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  });
});

describe("Phase 15 SDK tool loop", () => {
  it("refreshes business facts for the SDK model call after tool execution", async () => {
    let resolved = false;
    const registry = new ToolRegistry([defineTool({ name: "resolve", description: "Read trusted state", inputSchema: z.object({}).strict(),
      outputSchema: z.object({ resolved: z.boolean() }), execute: async () => { resolved = true; return { success: true, data: { resolved } }; } })]);
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call("read", "resolve") : answer("Which doctor would you prefer?"));
    const scope = { organizationId: "org-a", agentId: "agent", sessionId: "session-a" };
    const agent = new AgentSession({ agentId: "agent", name: "Assistant", businessName: "Clinic", instructions: "Follow facts", languages: ["as"], enabledTools: ["resolve"] },
      scope, provider, { stateSchema: z.object({}), initialState: () => ({}), update: () => ({}), promptContext: () => "",
        verifiedContext: () => JSON.stringify({ resolved }) }, { tools: { registry, callId: "call", conversationId: "conversation" } });
    try {
      await agent.processUserUtterance("Continue");
      assert.match(provider.options[0]?.systemPrompt ?? "", /"resolved":false/u);
      assert.match(provider.options[1]?.systemPrompt ?? "", /"resolved":true/u);
      assert.equal(agent.getState().toolHistory.length, 1);
    } finally { await agent.close(); }
  });
  it("truncated speech after a tool does not retry or execute the tool twice", async () => {
    let executions = 0;
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call()
      : [{ type: "text", delta: "Incomplete private response" }, { type: "done", finishReason: "length" }]);
    const agent = session(provider, { registry: new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]) });
    try {
      const result = await agent.processUserUtterance("Read the time");
      assert.equal(result.failureCategory, "incomplete_output"); assert.equal(executions, 1); assert.equal(provider.inputs.length, 2);
      assert.equal(agent.getState().toolHistory.length, 1); assert.doesNotMatch(result.text, /Incomplete private/u);
    } finally { await agent.close(); }
  });
  it("returns safe malformed-JSON recovery through the SDK without logging arguments", async () => {
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call("one", "get_server_time", '{"secret-test":') : answer("Please try again."));
    let executions = 0; const logs: string[] = []; const original = console.error;
    console.error = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
    const agent = session(provider, { registry: new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]) });
    try {
      assert.equal((await agent.processUserUtterance("test")).isFallback, false);
      assert.match(provider.inputs[1]?.find(m => m.role === "tool")?.content ?? "", /INVALID_TOOL_INPUT/u);
      assert.equal(executions, 0); assert.doesNotMatch(logs.join(""), /secret-test/u);
    } finally { console.error = original; await agent.close(); }
  });
  it("reuses an invocation ID within an SDK run without repeating a handler", async () => {
    let executions = 0;
    const provider = new ScriptedProvider((_messages, count) => count <= 2 ? call("same") : answer("The result is ready."));
    const agent = session(provider, { registry: new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]) });
    assert.equal((await agent.chat("test")).text, "The result is ready.");
    assert.equal(executions, 1); assert.equal(agent.getState().toolHistory.length, 1); await agent.close();
  });
  it("closing a session cancels pending execution and never commits late results", async () => {
    const started = deferred(); const release = deferred(); let handlerSignal: AbortSignal | undefined;
    const registry = new ToolRegistry([defineTool({ name: "get_server_time", description: "test", inputSchema: z.object({}), outputSchema: z.string(),
      execute: async (_input, ctx) => { handlerSignal = ctx.signal; started.resolve(); await release.promise; return { success: true, data: "late" }; } })]);
    const agent = session(new ScriptedProvider(() => call()), { registry });
    const response = agent.processUserUtterance("test"); await started.promise;
    const rejected = assert.rejects(response); await agent.close(); await agent.close(); await rejected; release.resolve();
    assert.equal(handlerSignal?.aborted, true); assert.equal(agent.getState().toolHistory.length, 0);
    assert.equal(agent.getHistory().filter(m => m.role === "assistant").length, 0);
  });
  it("runs the real SDK, replays validated results next turn and keeps trusted context out of messages", async () => {
    let executions = 0;
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call() : answer(`Answer ${count}.`));
    const registry = new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]);
    const agent = session(provider, { registry });
    const result = await agent.processUserUtterance("What is the server time?");
    assert.equal(result.isFallback, false); assert.equal(executions, 1);
    assert.equal(provider.inputs[1]?.find(m => m.role === "tool")?.toolCallId, "call_1");
    assert.match(provider.inputs[1]?.find(m => m.role === "tool")?.content ?? "", /2026-10-13/u);
    assert.equal(agent.getState().toolHistory.length, 1);
    await agent.processUserUtterance("Repeat the result");
    assert.ok(provider.inputs[2]?.some(m => m.role === "tool"));
    assert.doesNotMatch(JSON.stringify(provider.inputs), /org-a|call-a|conversation-a|session-a/u);
    assert.equal(provider.options[0]?.tools?.[0]?.name, "get_server_time");
    await agent.close();
  });
  it("returns a validation envelope to the SDK without executing spoofed arguments", async () => {
    let executions = 0;
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call("one", "get_server_time", '{"organizationId":"org-b"}') : answer("The arguments were rejected."));
    const agent = session(provider, { registry: new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]) });
    await agent.processUserUtterance("test"); assert.equal(executions, 0);
    assert.match(provider.inputs[1]?.find(m => m.role === "tool")?.content ?? "", /INVALID_TOOL_INPUT/u); await agent.close();
  });
  it("does not restart an executed sequence when the final model output is empty", async () => {
    let executions = 0; const provider = new ScriptedProvider((_messages, count) => count === 1 ? call() : [{ type: "done" }]);
    const agent = session(provider, { registry: new ToolRegistry([createServerTimeTool(() => { executions++; return new Date(fixed); })]) });
    const result = await agent.processUserUtterance("test");
    assert.equal(result.isFallback, true); assert.equal(result.fallbackReason, "empty_output");
    assert.equal(executions, 1); assert.equal(provider.inputs.length, 2); await agent.close();
  });
  it("rejects unregistered model calls and fails closed without configured runtime", async () => {
    const provider = new ScriptedProvider(() => call("one", "query_postgres"));
    assert.throws(() => new AgentSession(config, { organizationId: context.organizationId, agentId: context.agentId, sessionId: context.sessionId }, provider, neutral), /runtime/u);
    const agent = session(provider); const result = await agent.processUserUtterance("test");
    assert.equal(result.isFallback, true); assert.equal(agent.getState().toolHistory.length, 0); await agent.close();
  });
  it("excludes interrupted tool pairs from the next model context and resets them", async () => {
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call() : answer(`Answer ${count}.`)); const agent = session(provider);
    const first = await agent.processUserUtterance("test"); await agent.notifyInterruption(first.turnId);
    assert.equal(agent.getState().toolHistory[0]?.interrupted, true);
    await agent.processUserUtterance("next"); assert.ok(!provider.inputs[2]?.some(m => m.role === "tool"));
    await agent.reset(); assert.equal(agent.getState().toolHistory.length, 0); await agent.close();
  });
  it("supersession drops late tool output and prevents stale assistant/history commits", async () => {
    const started = deferred(); const release = deferred();
    const registry = new ToolRegistry([defineTool({ name: "get_server_time", description: "test", inputSchema: z.object({}), outputSchema: z.string(),
      execute: async () => { started.resolve(); await release.promise; return { success: true, data: "late" }; } })]);
    const provider = new ScriptedProvider((_messages, count) => count === 1 ? call() : answer("New turn answered.")); const agent = session(provider, { registry });
    const old = agent.processUserUtterance("old"); await started.promise;
    const rejected = assert.rejects(old); const current = await agent.processUserUtterance("new"); await rejected; release.resolve();
    assert.equal(current.text, "New turn answered."); assert.equal(agent.getState().toolHistory.length, 0);
    assert.equal(agent.getHistory().filter(m => m.role === "assistant").length, 1); await agent.close();
  });
  it("bounds repeated model tool calls to five model turns", async () => {
    const provider = new ScriptedProvider((_messages, count) => call(`call_${count}`)); const agent = session(provider);
    const result = await agent.processUserUtterance("test"); assert.equal(result.isFallback, true);
    assert.equal(provider.inputs.length, 5); assert.equal(agent.getState().toolHistory.length, 4); await agent.close();
  });
});

describe("OpenAI-compatible tool protocol", () => {
  for (const Provider of [GroqLLMProvider, HuggingFaceLLMProvider]) {
    it(`${Provider.name}: streaming fragments, multiple calls, payload and result correlation`, async () => {
      const original = globalThis.fetch; let payload: Record<string, unknown> = {};
      const lines = [
        { choices: [{ delta: { tool_calls: [{ index: 1, id: "second", type: "function", function: { name: "get_server_time", arguments: "{" } },
          { index: 0, id: "first", type: "function", function: { name: "get_server_time", arguments: "{" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }, { index: 1, function: { arguments: "}" } }] }, finish_reason: "tool_calls" }] },
      ].map(value => `data: ${JSON.stringify(value)}\n`).join("") + "data: [DONE]";
      globalThis.fetch = async (_url, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const bytes = new TextEncoder().encode(lines);
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 47)); controller.enqueue(bytes.slice(47)); controller.close(); } }));
      };
      try {
        const provider = new Provider({ apiKey: "test-key", baseURL: "http://offline.test/v1" }); const chunks: LLMChunk[] = [];
        for await (const chunk of provider.generate([{ role: "assistant", content: "", toolCalls: [{ id: "previous", name: "get_server_time", arguments: "{}" }] },
          { role: "tool", content: '{"success":true}', toolCallId: "previous" }],
        { tools: [{ name: "get_server_time", description: "Clock", parameters: { type: "object", properties: {}, additionalProperties: false }, strict: true }] })) chunks.push(chunk);
        assert.deepEqual(chunks.filter(c => c.type === "tool_call").map(c => c.toolCall.id), ["first", "second"]);
        assert.ok(chunks.filter(c => c.type === "tool_call").every(c => c.toolCall.arguments === "{}"));
        assert.match(JSON.stringify(payload), /tool_call_id|tool_calls|get_server_time/u);
        assert.equal(payload.parallel_tool_calls, false); assert.equal(payload.tool_choice, "auto");
      } finally { globalThis.fetch = original; }
    });
    it(`${Provider.name}: non-streaming parity and malformed/unsupported calls`, async () => {
      const original = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "one", type: "function", function: { name: "get_server_time", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }));
      try {
        const provider = new Provider({ apiKey: "test-key", baseURL: "http://offline.test/v1" });
        assert.equal((await provider.chat([{ role: "user", content: "test" }])).toolCalls?.[0]?.id, "one");
        globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","type":"shell","function":{"name":"test","arguments":"{}"}}]}}]}\n');
        await assert.rejects(async () => { for await (const _chunk of provider.generate([{ role: "user", content: "test" }])) { /* drain */ } });
        globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","type":"function","function":{"name":"test","arguments":"{"}}]},"finish_reason":"length"}]}\n');
        await assert.rejects(async () => { for await (const _chunk of provider.generate([{ role: "user", content: "test" }])) { /* drain */ } }, error => error instanceof Error && "kind" in error && error.kind === "protocol");
      } finally { globalThis.fetch = original; }
    });
  }
});
