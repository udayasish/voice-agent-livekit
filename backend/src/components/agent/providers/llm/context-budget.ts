import { LLMFailure } from "./failure.js";
import type { LLMMessage, LLMOptions, LLMUsage } from "./types.js";

export interface ContextLimits { targetBytes: number; hardBytes: number; inputTokens: number; contextWindowTokens?: number | undefined; }
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = { targetBytes: 8192, hardBytes: 12288, inputTokens: 3500 };
export type ContextMetrics = Record<string, number | string | boolean>;
export const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
/** An estimate, deliberately not advertised as a tokenizer or a provider limit. */
export function estimateTokens(value: unknown): number {
  const text = JSON.stringify(value) ?? "";
  let ascii = 0, other = 0;
  for (const char of text) { if (char.codePointAt(0)! < 128) ascii++; else other += Buffer.byteLength(char, "utf8"); }
  return Math.ceil(ascii / 3 + other / 1.5);
}
export class ContextBudget {
  private target: number;
  private weight = 1;
  private recoveryUsed = false;
  constructor(readonly limits = DEFAULT_CONTEXT_LIMITS, private readonly event: (metrics: ContextMetrics) => void = () => {}) { this.target = limits.targetBytes; }
  beginTurn() { this.recoveryUsed = false; }
  useRecovery(): boolean { if (this.recoveryUsed) return false; this.recoveryUsed = true; return true; }
  emergency() { this.target = Math.min(this.target, 6144); }
  observe(usage: LLMUsage | undefined, estimated: number) {
    if (usage?.promptTokens !== undefined && estimated > 0) {
      this.weight = Math.max(this.weight, usage.promptTokens / estimated * 1.15);
      this.event({ measurement: "usage", reportedInputTokens: usage.promptTokens, estimatedInputTokens: estimated, safetyWeight: this.weight });
    }
  }
  fit(messages: LLMMessage[], options: Partial<LLMOptions>): { messages: LLMMessage[]; options: Partial<LLMOptions>; estimated: number; size: number } {
    const copy = structuredClone(messages);
    const inputCeiling = Math.min(this.limits.inputTokens, this.limits.contextWindowTokens === undefined ? Infinity : this.limits.contextWindowTokens - (options.maxTokens ?? 256) - 256);
    let systemPrompt = options.systemPrompt;
    const measure = () => ({ messages: copy, systemPrompt, tools: options.tools ?? [], responseFormat: options.responseFormat });
    let currentUser = copy.length - 1;
    while (currentUser >= 0 && copy[currentUser]?.role !== "user") currentUser--;
    const reserve = options.tools?.length && !copy.slice(currentUser).some(message => message.role === "tool") ? 512 : 0;
    const ceiling = inputCeiling - reserve;
    const over = () => bytes(measure()) + 256 > this.target || estimateTokens(measure()) * this.weight > ceiling;
    let removed = 0;
    while (over()) {
      const users = copy.flatMap((message, index) => message.role === "user" ? [index] : []);
      if (users.length > 1) {
        // Retain the immediately preceding exchange when it fits the hard
        // budgets; a soft byte target alone must not erase the user's context.
        if (users.length === 2 && this.target > 6144 && bytes(measure()) + 256 <= this.limits.hardBytes
          && estimateTokens(measure()) * this.weight <= ceiling) break;
        copy.splice(0, users[1]!); removed++; continue;
      }
      const smaller = systemPrompt?.replace(/<conversation_notes>[\s\S]*?<\/conversation_notes>\s*/gu, "");
      if (smaller !== systemPrompt) { systemPrompt = smaller; continue; }
      break;
    }
    const size = bytes(measure()) + 256, estimated = Math.ceil(estimateTokens(measure()) * this.weight);
    this.event({ estimatedRequestBytes: size, instructionsBytes: bytes(systemPrompt ?? ""), historyBytes: bytes(copy.filter(m => m.role !== "tool")),
      toolResultBytes: bytes(copy.filter(m => m.role === "tool")), toolSchemaBytes: bytes(options.tools ?? []), estimatedInputTokens: estimated,
      reservedOutputTokens: options.maxTokens ?? 256, safetyTokens: 256,
      reservedToolResultTokens: reserve,
      removedTurns: removed, estimator: "script-weighted-v1" });
    if (size > this.limits.hardBytes || estimated > ceiling || (this.target <= 6144 && size > this.target)) throw new LLMFailure("request_limit");
    return { messages: copy, options: { ...options, systemPrompt, requestByteLimit: this.limits.hardBytes }, estimated, size };
  }
}
