import { Usage, type Model, type ModelRequest, type ModelResponse, type StreamEvent } from "@openai/agents";
import type { LLMMessage, LLMProvider, LLMUsage, LLMToolCall } from "./types.js";
import { ContextBudget } from "./context-budget.js";
import { LLMFailure } from "./failure.js";

/** Bridges existing vendor providers to the Agents SDK; no domain or transport behavior. */
export class ProviderModel implements Model {
  finishReason: string | undefined;
  usage: LLMUsage | undefined;
  constructor(private readonly provider: LLMProvider, private readonly onToken: () => void = () => {},
    private readonly prepareToolCall: (call: LLMToolCall) => LLMToolCall = call => call,
    private initialToolCall?: LLMToolCall, private readonly budget = new ContextBudget(), private readonly background = false) {}

  private messages(request: ModelRequest): LLMMessage[] {
    if (request.handoffs.length) throw new Error("Handoffs are unavailable");
    if (typeof request.input === "string") return [{ role: "user", content: request.input }];
    const messages: LLMMessage[] = [];
    for (const item of request.input) {
      if (item.type === "function_call") {
        const call = { id: item.callId, name: item.name, arguments: item.arguments };
        const previous = messages.at(-1);
        if (previous?.role === "assistant") previous.toolCalls = [...previous.toolCalls ?? [], call];
        else messages.push({ role: "assistant", content: "", toolCalls: [call] });
        continue;
      }
      if (item.type === "function_call_result") {
        let content: string;
        if (typeof item.output === "string") content = item.output;
        else if (Array.isArray(item.output)) content = item.output.map(part => {
          if (part.type !== "input_text") throw new Error("Only text tool outputs are supported");
          return part.text;
        }).join("");
        else if (item.output.type === "text") content = item.output.text;
        else throw new Error("Only text tool outputs are supported");
        messages.push({ role: "tool", content, toolCallId: item.callId }); continue;
      }
      if (!("role" in item) || !("content" in item)) throw new Error("Only text messages are supported");
      const role = item.role;
      if (role !== "system" && role !== "user" && role !== "assistant") throw new Error("Unsupported message role");
      const content = typeof item.content === "string" ? item.content : item.content.map(part => {
        if (part.type === "input_text" || part.type === "output_text") return part.text;
        throw new Error("Only text content is supported");
      }).join("");
      messages.push({ role, content });
    }
    return messages;
  }

  private async *generate(request: ModelRequest): AsyncIterable<StreamEvent> {
    request.signal?.throwIfAborted();
    this.finishReason = undefined;
    this.usage = undefined;
    if (this.initialToolCall) {
      const call = this.initialToolCall;
      this.initialToolCall = undefined;
      if (!request.tools.some(tool => tool.name === call.name)) throw new Error("Planned tool is not enabled");
      yield { type: "response_started" };
      yield { type: "response_done", response: { id: "", usage: new Usage({ requests: 0 }), output: [
        { type: "function_call", id: call.id, callId: call.id, name: call.name, arguments: call.arguments, status: "completed" },
      ] } };
      return;
    }
    let text = "";
    let usage: LLMUsage | undefined;
    const calls: LLMToolCall[] = [];
    const tools = request.tools.map(spec => {
      if (spec.type !== "function") throw new Error("Only registered function tools are supported");
      return { name: spec.name, description: spec.description, parameters: spec.parameters, strict: spec.strict };
    });
    if (tools.length && !this.provider.capabilities.toolCalling) throw new Error("Provider does not support tools");
    yield { type: "response_started" };
    const options = {
      background: this.background,
      systemPrompt: request.systemInstructions,
      model: typeof request.modelSettings.providerData?.model === "string" ? request.modelSettings.providerData.model : undefined,
      temperature: request.modelSettings.temperature,
      maxTokens: this.provider.getMaxCompletionTokens?.(request.modelSettings.maxTokens,
        typeof request.modelSettings.providerData?.model === "string" ? request.modelSettings.providerData.model : undefined) ?? request.modelSettings.maxTokens,
      abortSignal: request.signal,
      tools,
      toolChoice: request.modelSettings.toolChoice,
      parallelToolCalls: false,
    };
    let fitted = this.budget.fit(this.messages(request), options);
    for (;;) {
      try {
        for await (const chunk of this.provider.generate(fitted.messages, fitted.options)) {
          request.signal?.throwIfAborted();
          if (chunk.type === "tool_call") {
            if (!tools.some(tool => tool.name === chunk.toolCall.name)) throw new Error("Unregistered tool call rejected");
            if (calls.some(call => call.id === chunk.toolCall.id)) throw new Error("Duplicate tool call ID");
            calls.push(this.prepareToolCall(chunk.toolCall)); continue;
          }
          if (chunk.type === "text") {
            if (chunk.delta) this.onToken();
            text += chunk.delta;
            yield { type: "output_text_delta", delta: chunk.delta };
          } else { usage = chunk.usage; this.usage = usage; this.finishReason = chunk.finishReason; }
        }
        this.budget.observe(usage, fitted.estimated);
        if (this.finishReason === "length" && text.trim()) throw new LLMFailure("incomplete_output");
        break;
      } catch (error) {
        request.signal?.throwIfAborted();
        if (!(error instanceof LLMFailure) || error.status !== 413 || text || calls.length || !this.budget.useRecovery()) throw error;
        this.budget.emergency();
        const smaller = this.budget.fit(this.messages(request), options);
        if (smaller.size >= fitted.size * 0.9) throw error;
        fitted = smaller;
      }
    }
    request.signal?.throwIfAborted();
    yield {
      type: "response_done",
      response: {
        id: "", usage: new Usage({ requests: 1, inputTokens: usage?.promptTokens ?? 0,
          outputTokens: usage?.completionTokens ?? 0, totalTokens: usage?.totalTokens ?? 0 }),
        output: [
          ...(text || !calls.length ? [{ type: "message" as const, role: "assistant" as const, status: "completed" as const,
            content: [{ type: "output_text" as const, text }] }] : []),
          ...calls.map(call => ({ type: "function_call" as const, id: call.id, callId: call.id, name: call.name, arguments: call.arguments, status: "completed" as const })),
        ],
      },
    };
  }
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    if (request.outputType !== "text" && !request.tools.length) {
      const output = request.outputType;
      const options = { systemPrompt: request.systemInstructions,
        background: this.background,
        tools: [],
        model: typeof request.modelSettings.providerData?.model === "string" ? request.modelSettings.providerData.model : undefined,
        temperature: request.modelSettings.temperature,
        maxTokens: this.provider.getMaxCompletionTokens?.(request.modelSettings.maxTokens,
          typeof request.modelSettings.providerData?.model === "string" ? request.modelSettings.providerData.model : undefined) ?? request.modelSettings.maxTokens,
        abortSignal: request.signal,
        ...(this.provider.capabilities.structuredOutput ? { responseFormat: { type: "json_schema" as const,
          json_schema: { name: output.name, strict: output.strict, schema: output.schema } } } : {}) };
      const fitted = this.budget.fit(this.messages(request), options);
      const result = await this.provider.chat(fitted.messages, fitted.options);
      request.signal?.throwIfAborted();
      if (result.toolCalls?.length) throw new LLMFailure("protocol");
      this.usage = result.usage; this.finishReason = result.finishReason; this.budget.observe(result.usage, fitted.estimated);
      if (this.finishReason === "length") throw new LLMFailure("incomplete_output");
      if (result.text) this.onToken();
      return { output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: result.text }] }],
        usage: new Usage({ requests: 1, inputTokens: result.usage?.promptTokens ?? 0, outputTokens: result.usage?.completionTokens ?? 0 }) };
    }
    for await (const event of this.generate(request)) {
      if (event.type === "response_done") return { output: event.response.output, usage: new Usage({
        requests: 1, inputTokens: event.response.usage.inputTokens,
        outputTokens: event.response.usage.outputTokens, totalTokens: event.response.usage.totalTokens,
      }) };
    }
    throw new Error("Provider returned no completion");
  }
  getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> { return this.generate(request); }
}
