import type { LLMProvider, LLMMessage, LLMOptions, LLMChunk, LLMResponse } from "../../src/components/agent/providers/llm/types.js";

export class ScriptedProvider implements LLMProvider {
  readonly label = "Deterministic tool test provider";
  readonly capabilities = { streaming: true, toolCalling: true, multilingual: true, models: ["offline-tools"] };
  readonly inputs: LLMMessage[][] = [];
  readonly options: Array<Partial<LLMOptions>> = [];
  constructor(private readonly script: (messages: LLMMessage[], call: number) => LLMChunk[]) {}
  async *generate(messages: LLMMessage[], options: Partial<LLMOptions> = {}): AsyncIterable<LLMChunk> {
    this.inputs.push(structuredClone(messages)); this.options.push(options);
    for (const chunk of this.script(messages, this.inputs.length)) { options.abortSignal?.throwIfAborted(); yield chunk; }
  }
  async chat(messages: LLMMessage[], options: Partial<LLMOptions> = {}): Promise<LLMResponse> {
    let text = ""; const toolCalls = [];
    for await (const chunk of this.generate(messages, options)) {
      if (chunk.type === "text") text += chunk.delta;
      if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    }
    return { role: "assistant", text, toolCalls };
  }
}
