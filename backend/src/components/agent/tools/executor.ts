import { z } from "zod";
import { sessionContextSchema } from "../engine/config.js";
import { ToolRegistry, toolFailure, toolNameSchema, invalidJsonArgument } from "./registry.js";
import type { LLMToolCall } from "../providers/llm/types.js";
import type { ToolContext, ToolInvocation, ToolLogger, ToolResult } from "./types.js";

export const toolExecutionContextSchema = sessionContextSchema.extend({ callId: z.string().min(1), conversationId: z.string().min(1), turnId: z.number().int().positive() }).strict();
export type ToolExecutionContext = z.infer<typeof toolExecutionContextSchema>;
const silentLogger: ToolLogger = { event: () => {} };
const limitsSchema = z.object({ maxCalls: z.number().int().min(1).max(20).default(4), timeoutMs: z.number().int().min(1).max(60000).default(5000) });
type Json = z.infer<ReturnType<typeof z.json>>;
function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key]!)]));
  return value;
}
/** One executor per SDK run, bound to server context and enabled tools. */
export class ToolExecutor {
  readonly context: Readonly<ToolExecutionContext>;
  private readonly enabled: ReadonlySet<string>;
  private readonly limits;
  private readonly cache = new Map<string, { signature: string; result: Promise<ToolResult> }>();
  private queue: Promise<unknown> = Promise.resolve();
  private attempts = 0;
  private timedOut = false;
  private readonly invocations: ToolInvocation[] = [];
  constructor(private readonly registry: ToolRegistry, enabledNames: readonly string[], context: ToolExecutionContext,
    readonly signal: AbortSignal, private readonly logger: ToolLogger = silentLogger, limits: { maxCalls?: number; timeoutMs?: number } = {}) {
    this.context = Object.freeze(toolExecutionContextSchema.parse(context));
    registry.enabled(enabledNames); this.enabled = new Set(enabledNames); this.limits = limitsSchema.parse(limits);
  }
  get invocationCount(): number { return this.attempts; }
  get history(): ToolInvocation[] { return structuredClone(this.invocations); }
  prepareCall(call: LLMToolCall): LLMToolCall {
    // SDK 0.8 pre-parses JSON before invoking function tools and bypasses errorFunction
    // on syntax errors. A reserved, always-invalid field routes rejection through
    // our executor without exposing the original JSON or SDK exception text.
    try { JSON.parse(call.arguments); return call; }
    catch { return { ...call, arguments: JSON.stringify({ [invalidJsonArgument]: true }) }; }
  }
  invalidInput(name: string): ToolResult {
    this.attempts++;
    if (this.attempts > this.limits.maxCalls) return this.rejected(name, "invalid", "TOOL_LIMIT_EXCEEDED", "The tool invocation limit was reached.");
    return this.rejected(name, "invalid", "INVALID_TOOL_INPUT", "The tool arguments are invalid.");
  }
  invalidContext(name: string): ToolResult {
    this.attempts++;
    return this.rejected(name, "invalid", "INVALID_TOOL_CONTEXT", "The tool context is invalid.");
  }
  private log(event: Parameters<ToolLogger["event"]>[0], name: string, id: string, meta: Record<string, string | number | boolean> = {}) {
    this.logger.event(event, { ...this.context, toolName: toolNameSchema.safeParse(name).success ? name : "invalid", invocationId: id, ...meta });
  }
  private rejected(name: string, id: string, code: string, message: string): ToolResult {
    this.log("tool_rejected", name, id, { code }); return toolFailure(code, message);
  }
  execute(name: string, rawInput: unknown, invocationId: string): Promise<ToolResult> {
    this.signal.throwIfAborted();
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(invocationId)) {
      this.attempts++;
      return Promise.resolve(this.rejected(name, "invalid", this.attempts > this.limits.maxCalls ? "TOOL_LIMIT_EXCEEDED" : "INVALID_TOOL_CALL", "The tool invocation is invalid."));
    }
    let input: Json;
    try { input = z.json().parse(typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput); }
    catch { return Promise.resolve(this.invalidInput(name)); }
    const argumentsText = JSON.stringify(canonical(input));
    const signature = `${name}:${argumentsText}`;
    const cached = this.cache.get(invocationId);
    if (cached) return cached.signature === signature ? cached.result.then(result => structuredClone(result))
      : Promise.resolve(this.rejected(name, invocationId, "CONFLICTING_TOOL_CALL", "The invocation ID was reused with different arguments."));
    const attempt = ++this.attempts;
    const operation = this.queue.then(async () => {
      this.signal.throwIfAborted();
      if (this.timedOut) return this.rejected(name, invocationId, "TOOL_RUN_STOPPED", "Tool execution stopped after a timeout.");
      if (attempt > this.limits.maxCalls) return this.rejected(name, invocationId, "TOOL_LIMIT_EXCEEDED", "The tool invocation limit was reached.");
      const tool = this.registry.get(name);
      if (!tool) return this.rejected(name, invocationId, "TOOL_NOT_FOUND", "The requested tool is unavailable.");
      if (!this.enabled.has(name)) return this.rejected(name, invocationId, "TOOL_NOT_ALLOWED", "The requested tool is not enabled.");
      let validated: unknown;
      try { validated = tool.validate(input); }
      catch { return this.rejected(name, invocationId, "INVALID_TOOL_INPUT", "The tool arguments are invalid."); }
      const started = Date.now(); const controller = new AbortController();
      const signal = AbortSignal.any([this.signal, controller.signal]);
      const context: ToolContext = Object.freeze({ ...this.context, invocationId, signal });
      let timer: ReturnType<typeof setTimeout> | undefined; let onAbort: (() => void) | undefined;
      this.log("tool_started", name, invocationId);
      try {
        const stopped = new Promise<ToolResult>((resolve, reject) => {
          onAbort = () => reject(this.signal.reason ?? new DOMException("Aborted", "AbortError"));
          this.signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => { this.timedOut = true; controller.abort(); resolve(toolFailure("TOOL_TIMEOUT", "The tool timed out.")); }, this.limits.timeoutMs);
        });
        const result = await Promise.race([tool.invokeValidated(validated, context).catch(() => toolFailure("TOOL_EXECUTION_FAILED", "The tool could not complete the request.")), stopped]);
        this.signal.throwIfAborted();
        this.invocations.push({ name, invocationId, arguments: argumentsText, result: structuredClone(result) });
        const code = result.success ? "OK" : result.error.code;
        this.log(code === "TOOL_TIMEOUT" ? "tool_timeout" : result.success ? "tool_completed" : "tool_failed", name, invocationId, { code, durationMs: Date.now() - started });
        return result;
      } catch (error) {
        controller.abort(); this.log("tool_cancelled", name, invocationId, { durationMs: Date.now() - started }); throw error;
      } finally { if (timer) clearTimeout(timer); if (onAbort) this.signal.removeEventListener("abort", onAbort); }
    });
    this.cache.set(invocationId, { signature, result: operation }); this.queue = operation.catch(() => {});
    return operation.then(result => structuredClone(result));
  }
}
