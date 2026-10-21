import { streamChat, completeChat } from "./chat-protocol.js";
import { getGroqConfig, type GroqConfig, type ResolvedGroqConfig } from "./config.js";
import type {
  LLMCapabilities,
  LLMChunk,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "./types.js";

/**
 * Groq Cloud LLM Provider implementation.
 * Connects to Groq's high-speed OpenAI-compatible endpoint (https://api.groq.com/openai/v1).
 * Provider-specific voice settings are kept here, outside the reusable engine.
 */
export class GroqLLMProvider implements LLMProvider {
  get label(): string { return `Groq Cloud (${this.config.model})`; }

  readonly capabilities: LLMCapabilities = {
    streaming: true,
    structuredOutput: true,
    toolCalling: true,
    multilingual: true,
    models: ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  };

  private config: ResolvedGroqConfig;

  constructor(options?: Partial<GroqConfig>) {
    this.config = getGroqConfig(options);
  }

  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  get model(): string {
    return this.config.model;
  }

  getMaxCompletionTokens(requested = this.config.maxTokens, model = this.config.model): number {
    // GPT-OSS counts hidden reasoning in the completion budget. A voice-sized
    // 256/384-token limit can exhaust before the final answer or JSON is complete.
    return model === "openai/gpt-oss-120b" || model === "openai/gpt-oss-20b" ? Math.max(requested, 1536) : requested;
  }

  private voiceSettings(model: string): Record<string, string | boolean> {
    // GPT-OSS cannot disable reasoning or use Qwen's reasoning_format option.
    if (model === "openai/gpt-oss-120b" || model === "openai/gpt-oss-20b") {
      return { reasoning_effort: "low", include_reasoning: false };
    }
    return model.startsWith("qwen/qwen3") ? { reasoning_effort: "none", reasoning_format: "hidden" } : {};
  }

  private transport(model: string) {
    if (!this.config.apiKey || !this.config.isConfigured) throw new Error("LLM credentials are required");
    return { url: `${this.config.baseURL}/chat/completions`, apiKey: this.config.apiKey,
      temperature: this.config.temperature, maxTokens: this.config.maxTokens, timeoutMs: this.config.timeoutMs,
      maxTokenField: "max_completion_tokens" as const, settings: this.voiceSettings(model) };
  }
  generate(messages: LLMMessage[], options: Partial<LLMOptions> = {}): AsyncIterable<LLMChunk> {
    const model = options.model ?? this.config.model;
    return streamChat(this.transport(model), messages, { ...options, model, maxTokens: this.getMaxCompletionTokens(options.maxTokens, model) });
  }
  async chat(messages: LLMMessage[], options: Partial<LLMOptions> = {}): Promise<LLMResponse> {
    const model = options.model ?? this.config.model;
    const responseFormat = this.capabilities.models.includes(model) ? options.responseFormat : undefined;
    return completeChat(this.transport(model), messages, { ...options, model, responseFormat, maxTokens: this.getMaxCompletionTokens(options.maxTokens, model) });
  }
}
