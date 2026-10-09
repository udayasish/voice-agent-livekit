import logger from "../../../../lib/logger.js";
import { getGroqConfig, type GroqConfig, type ResolvedGroqConfig } from "./config.js";
import type {
  LLMCapabilities,
  LLMChunk,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMUsage,
} from "./types.js";

/**
 * Groq Cloud LLM Provider implementation.
 * Connects to Groq's high-speed OpenAI-compatible endpoint (https://api.groq.com/openai/v1).
 * Supports free models such as Qwen 2.5 32B ('qwen-2.5-32b').
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

  private prepareMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
  ): Array<{ role: string; content: string }> {
    const list: Array<{ role: string; content: string }> = [];

    if (systemPrompt && systemPrompt.trim().length > 0) {
      if (messages.length === 0 || messages[0]?.role !== "system") {
        list.push({ role: "system", content: systemPrompt.trim() });
      }
    }

    for (const msg of messages) {
      list.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return list;
  }

  async *generate(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): AsyncIterable<LLMChunk> {
    if (!this.config.isConfigured || !this.config.apiKey) {
      throw new Error(
        "Groq API key is required. Set GROQ_API_KEY in .env or pass apiKey in provider options.",
      );
    }

    const targetModel = options?.model ?? this.config.model;
    const url = `${this.config.baseURL}/chat/completions`;
    const payload = {
      model: targetModel,
      messages: this.prepareMessages(messages, options?.systemPrompt),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stream: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[llm:groq] Network error calling Groq API", { error: message });
      throw new Error(`Groq API network error: ${message}`);
    }

    if (!response.ok) {
      clearTimeout(timeout);
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      logger.error("[llm:groq] HTTP error from Groq API", {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      });
      throw new Error(
        `Groq API returned ${response.status} ${response.statusText}: ${errorBody || "Unknown error"}`,
      );
    }

    if (!response.body) {
      clearTimeout(timeout);
      throw new Error("Groq API response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        if (options?.abortSignal?.aborted || controller.signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
            continue;
          }

          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") {
            yield { type: "done" };
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              yield { type: "text", delta };
            }
          } catch {
            // Ignore incomplete JSON chunks in SSE stream
          }
        }
      }

      yield { type: "done" };
    } finally {
      clearTimeout(timeout);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): Promise<LLMResponse> {
    if (!this.config.isConfigured || !this.config.apiKey) {
      throw new Error(
        "Groq API key is required. Set GROQ_API_KEY in .env or pass apiKey in provider options.",
      );
    }

    const startTime = Date.now();
    const targetModel = options?.model ?? this.config.model;
    const url = `${this.config.baseURL}/chat/completions`;
    const payload = {
      model: targetModel,
      messages: this.prepareMessages(messages, options?.systemPrompt),
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          // ignore
        }
        throw new Error(
          `Groq API returned ${response.status} ${response.statusText}: ${errorBody || "Unknown error"}`,
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string; role?: string };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? "";
      const latencyMs = Date.now() - startTime;

      const usage: LLMUsage | undefined = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined;

      return {
        text,
        role: "assistant",
        usage,
        finishReason: choice?.finish_reason,
        latencyMs,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
