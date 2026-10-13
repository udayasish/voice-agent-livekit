import { z } from "zod";
import logger from "../../../../lib/logger.js";
import type { LLMChunk, LLMMessage, LLMOptions, LLMResponse, LLMToolCall, LLMUsage } from "./types.js";

export interface ChatTransport {
  url: string; apiKey: string; temperature: number; maxTokens: number; timeoutMs: number;
  maxTokenField: "max_tokens" | "max_completion_tokens";
  settings?: Record<string, string>;
}
const callSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u), type: z.literal("function"),
  function: z.object({ name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u), arguments: z.string() }) });
const usageSchema = z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() });
const deltaSchema = z.object({ index: z.number().int().min(0), id: z.string().optional(), type: z.literal("function").optional(),
  function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional() });
const eventSchema = z.object({ choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional(),
  tool_calls: z.array(deltaSchema).optional() }).optional(), finish_reason: z.string().nullable().optional() })).optional(),
  usage: usageSchema.nullable().optional(), x_groq: z.object({ usage: usageSchema.optional() }).optional() });
const completionSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(),
  tool_calls: z.array(callSchema).optional() }), finish_reason: z.string().nullable().optional() })).min(1), usage: usageSchema.optional() });
const tokenUsage = (usage: z.infer<typeof usageSchema> | null | undefined): LLMUsage | undefined => usage
  ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined;

export function chatMessages(messages: LLMMessage[], systemPrompt?: string) {
  const list = messages.map(message => ({ role: message.role, content: message.toolCalls?.length && !message.content ? null : message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}),
  }));
  if (systemPrompt?.trim() && messages[0]?.role !== "system") list.unshift({ role: "system", content: systemPrompt.trim() });
  return list;
}
function payload(config: ChatTransport, messages: LLMMessage[], options: Partial<LLMOptions>, stream: boolean) {
  const tools = options.tools ?? [];
  const choice = options.toolChoice ?? "auto";
  return { model: options.model, messages: chatMessages(messages, options.systemPrompt), temperature: options.temperature ?? config.temperature,
    [config.maxTokenField]: options.maxTokens ?? config.maxTokens, ...config.settings, stream,
    ...(tools.length ? { tools: tools.map(spec => ({ type: "function", function: { ...spec } })),
      tool_choice: ["auto", "none", "required"].includes(choice) ? choice : { type: "function", function: { name: choice } },
      parallel_tool_calls: options.parallelToolCalls ?? false } : {}),
  };
}
async function request(config: ChatTransport, messages: LLMMessage[], options: Partial<LLMOptions>, stream: boolean) {
  options.abortSignal?.throwIfAborted();
  const controller = new AbortController();
  const signal = options.abortSignal ? AbortSignal.any([controller.signal, options.abortSignal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(payload(config, messages, options, stream)), signal });
    if (!response.ok) { logger.warn("LLM HTTP request failed", { status: response.status }); throw new Error(`LLM HTTP request failed (${response.status})`); }
    return { response, signal, timer };
  } catch (error) { clearTimeout(timer); signal.throwIfAborted(); throw error; }
}

/** Shared OpenAI-compatible wire handling; it never executes function calls. */
export async function* streamChat(config: ChatTransport, messages: LLMMessage[], options: Partial<LLMOptions>): AsyncIterable<LLMChunk> {
  const { response, signal, timer } = await request(config, messages, options, true);
  const reader = response.body?.getReader();
  if (!reader) { clearTimeout(timer); throw new Error("LLM response body is empty"); }
  const decoder = new TextDecoder(); let buffer = ""; let ended = false;
  let usage: LLMUsage | undefined; let finishReason: string | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  try {
    while (!ended) {
      signal.throwIfAborted();
      const part = await reader.read();
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      const lines = buffer.split("\n"); buffer = part.done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const text = trimmed.slice(5).trim();
        if (text === "[DONE]") { ended = true; break; }
        const parsed = eventSchema.parse(JSON.parse(text));
        const choice = parsed.choices?.[0]; finishReason = choice?.finish_reason ?? finishReason;
        usage = tokenUsage(parsed.usage ?? parsed.x_groq?.usage) ?? usage;
        if (choice?.delta?.content) yield { type: "text", delta: choice.delta.content };
        for (const delta of choice?.delta?.tool_calls ?? []) {
          const call = calls.get(delta.index) ?? { id: "", name: "", arguments: "" };
          call.id += delta.id ?? ""; call.name += delta.function?.name ?? ""; call.arguments += delta.function?.arguments ?? "";
          calls.set(delta.index, call);
        }
      }
      if (part.done) break;
    }
    signal.throwIfAborted();
    if (calls.size && finishReason !== "tool_calls" && finishReason !== "stop") throw new Error("Incomplete tool call response");
    const ids = new Set<string>();
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      callSchema.parse({ id: call.id, type: "function", function: call });
      if (ids.has(call.id)) throw new Error("Duplicate tool call ID in completion");
      ids.add(call.id);
      yield { type: "tool_call", toolCall: call };
    }
    yield { type: "done", usage, finishReason };
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function completeChat(config: ChatTransport, messages: LLMMessage[], options: Partial<LLMOptions>): Promise<LLMResponse> {
  const started = Date.now(); const { response, signal, timer } = await request(config, messages, options, false);
  try {
    const parsed = completionSchema.parse(await response.json()); signal.throwIfAborted();
    const choice = parsed.choices[0]!;
    if (choice.message.tool_calls?.length && choice.finish_reason !== "tool_calls" && choice.finish_reason !== "stop") throw new Error("Incomplete tool call response");
    const toolCalls: LLMToolCall[] | undefined = choice.message.tool_calls?.map(call => ({ id: call.id, ...call.function }));
    if (toolCalls && new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw new Error("Duplicate tool call ID in completion");
    return { text: choice.message.content ?? "", role: "assistant", usage: tokenUsage(parsed.usage), finishReason: choice.finish_reason ?? undefined,
      toolCalls, latencyMs: Date.now() - started };
  } finally { clearTimeout(timer); }
}
