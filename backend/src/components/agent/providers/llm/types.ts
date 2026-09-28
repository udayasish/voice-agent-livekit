export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolCall: LLMToolCall }
  | { type: "done" };

export type LLMToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMOptions = {
  model: string;
  tools?: LLMToolSpec[];
  temperature?: number;
  maxTokens?: number;
};

export interface LLMProvider {
  generate(
    messages: LLMMessage[],
    options: LLMOptions,
  ): AsyncIterable<LLMChunk>;
}
