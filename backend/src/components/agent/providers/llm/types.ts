/**
 * Message payload adhering to the OpenAI-compatible chat format.
 */
export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

/**
 * Structured tool call representation.
 */
export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Token usage metadata returned by LLM completions.
 */
export type LLMUsage = {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
};

/**
 * Streaming chunk emitted during LLM response generation.
 */
export type LLMChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolCall: LLMToolCall }
  | { type: "done"; usage?: LLMUsage | undefined };

/**
 * Specification for structured tools passed to LLM.
 */
export type LLMToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Runtime execution options for LLM generation.
 */
export type LLMOptions = {
  model?: string | undefined;
  tools?: LLMToolSpec[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  systemPrompt?: string | undefined;
  abortSignal?: AbortSignal | undefined;
};

/**
 * Complete non-streaming LLM response.
 */
export type LLMResponse = {
  text: string;
  role: "assistant";
  usage?: LLMUsage | undefined;
  finishReason?: string | undefined;
  latencyMs?: number | undefined;
};

/**
 * Declared capabilities of an LLM provider.
 */
export type LLMCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  multilingual: boolean;
  models: string[];
};

/**
 * Provider interface for Large Language Model engines.
 * Adheres to TECH_STACK.md and VOICE_AI_ARCHITECTURE.md abstraction guidelines.
 * Completely decouples agent engine logic from specific vendors (Hugging Face, vLLM, Ollama, etc.).
 */
export interface LLMProvider {
  readonly label: string;
  readonly capabilities: LLMCapabilities;

  /**
   * Generates a streaming response delta-by-delta as an AsyncIterable of LLMChunks.
   */
  generate(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): AsyncIterable<LLMChunk>;

  /**
   * Generates a complete LLMResponse.
   */
  chat(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): Promise<LLMResponse>;
}
