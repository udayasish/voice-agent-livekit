import { streamChat, completeChat } from "./chat-protocol.js";
import {
  getHuggingFaceConfig,
  type HuggingFaceConfig,
  type ResolvedHuggingFaceConfig,
} from "./config.js";
import type {
  LLMCapabilities,
  LLMChunk,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "./types.js";

/**
 * Hugging Face Inference Providers LLM implementation.
 * Connects to the external OpenAI-compatible router (https://router.huggingface.co/v1).
 * Adheres strictly to the LLMProvider abstraction.
 */
export class HuggingFaceLLMProvider implements LLMProvider {
  readonly label = "Hugging Face Inference Providers";

  readonly capabilities: LLMCapabilities = {
    streaming: true,
    toolCalling: true,
    multilingual: true,
    models: ["Qwen/Qwen3.5-4B"],
  };

  private config: ResolvedHuggingFaceConfig;

  constructor(options?: Partial<HuggingFaceConfig>) {
    this.config = getHuggingFaceConfig(options);
  }

  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  get model(): string {
    return this.config.model;
  }

  private transport(model: string) {
    if (!this.config.apiKey || !this.config.isConfigured) throw new Error("LLM credentials are required");
    return { url: `${this.config.baseURL}/chat/completions`, apiKey: this.config.apiKey,
      temperature: this.config.temperature, maxTokens: this.config.maxTokens, timeoutMs: this.config.timeoutMs,
      maxTokenField: "max_tokens" as const, settings: {} };
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
