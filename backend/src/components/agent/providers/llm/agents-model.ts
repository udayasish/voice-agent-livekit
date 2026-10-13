import { Usage, type Model, type ModelRequest, type ModelResponse, type StreamEvent } from "@openai/agents";
import type { LLMMessage, LLMProvider, LLMUsage } from "./types.js";

/** Bridges existing vendor providers to the Agents SDK; no domain or transport behavior. */
export class ProviderModel implements Model {
  finishReason: string | undefined;
  usage: LLMUsage | undefined;
  constructor(private readonly provider: LLMProvider, private readonly onToken: () => void = () => {}) {}

  private messages(request: ModelRequest): LLMMessage[] {
    if (request.tools.length || request.handoffs.length) throw new Error("Tools are unavailable in Phase 14");
    if (typeof request.input === "string") return [{ role: "user", content: request.input }];
    return request.input.map(item => {
      if (!("role" in item) || !("content" in item)) throw new Error("Only text messages are supported");
      const role = item.role;
      if (role !== "system" && role !== "user" && role !== "assistant") throw new Error("Unsupported message role");
      const content = typeof item.content === "string" ? item.content : item.content.map(part => {
        if (part.type === "input_text" || part.type === "output_text") return part.text;
        throw new Error("Only text content is supported");
      }).join("");
      return { role, content };
    });
  }

  private async *generate(request: ModelRequest): AsyncIterable<StreamEvent> {
    request.signal?.throwIfAborted();
    this.finishReason = undefined;
    this.usage = undefined;
    let text = "";
    let usage: LLMUsage | undefined;
    yield { type: "response_started" };
    for await (const chunk of this.provider.generate(this.messages(request), {
      systemPrompt: request.systemInstructions,
      model: typeof request.modelSettings.providerData?.model === "string" ? request.modelSettings.providerData.model : undefined,
      temperature: request.modelSettings.temperature,
      maxTokens: request.modelSettings.maxTokens,
      abortSignal: request.signal,
    })) {
      request.signal?.throwIfAborted();
      if (chunk.type === "tool_call") throw new Error("Unregistered tool call rejected");
      if (chunk.type === "text") {
        if (chunk.delta) this.onToken();
        text += chunk.delta;
        yield { type: "output_text_delta", delta: chunk.delta };
      } else { usage = chunk.usage; this.usage = usage; this.finishReason = chunk.finishReason; }
    }
    request.signal?.throwIfAborted();
    yield {
      type: "response_done",
      response: {
        id: "", usage: new Usage({ requests: 1, inputTokens: usage?.promptTokens ?? 0,
          outputTokens: usage?.completionTokens ?? 0, totalTokens: usage?.totalTokens ?? 0 }),
        output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text }] }],
      },
    };
  }
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
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
