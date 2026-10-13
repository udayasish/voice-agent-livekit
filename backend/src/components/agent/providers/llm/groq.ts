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
  readonly label = "Groq Cloud (qwen/qwen3.8-27b)";

  readonly capabilities: LLMCapabilities = {
    streaming: true,
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

  private voiceSettings(model: string) {
    // Groq documents 'none' for Qwen 3; GPT-OSS and other models have different supported values.
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
    return streamChat(this.transport(model), messages, { ...options, model });
  }
  async chat(messages: LLMMessage[], options: Partial<LLMOptions> = {}): Promise<LLMResponse> {
    const model = options.model ?? this.config.model;
    return completeChat(this.transport(model), messages, { ...options, model });
  }
}
