import type { LLMCapabilities, LLMChunk, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "./types.js";

export interface MockLLMProviderOptions {
  model?: string | undefined;
  chunkDelayMs?: number | undefined;
  fixedResponse?: string | undefined;
  clinicName?: string | undefined;
}
/** Deterministic business-neutral provider for offline development. */
export class MockLLMProvider implements LLMProvider {
  readonly label = "Mock LLM Provider (Offline ₹0)";
  readonly capabilities: LLMCapabilities = {
    streaming: true, toolCalling: false, multilingual: true,
    models: ["mock-qwen-voice", "Qwen/Qwen3.5-4B"],
  };
  constructor(private readonly options: MockLLMProviderOptions = {}) {}
  private response(messages: LLMMessage[]): string {
    if (this.options.fixedResponse !== undefined) return this.options.fixedResponse;
    const text = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (/[\u0980-\u09FF]/u.test(text)) return "নমস্কাৰ, মই আপোনাক কেনেদৰে সহায় কৰিব পাৰো?";
    if (/[\u0900-\u097F]/u.test(text)) return "नमस्ते, मैं आपकी कैसे सहायता कर सकता हूँ?";
    return "Hello, how can I assist you today?";
  }
  async *generate(messages: LLMMessage[], options?: Partial<LLMOptions>): AsyncIterable<LLMChunk> {
    for (const delta of this.response(messages).match(/\S+\s*/gu) ?? []) {
      options?.abortSignal?.throwIfAborted();
      if (this.options.chunkDelayMs) await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { options?.abortSignal?.removeEventListener("abort", onAbort); resolve(); }, this.options.chunkDelayMs);
        options?.abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
      options?.abortSignal?.throwIfAborted();
      yield { type: "text", delta };
    }
    yield { type: "done" };
  }
  async chat(messages: LLMMessage[], options?: Partial<LLMOptions>): Promise<LLMResponse> {
    let text = "";
    for await (const chunk of this.generate(messages, options)) if (chunk.type === "text") text += chunk.delta;
    return { text, role: "assistant" };
  }
}
