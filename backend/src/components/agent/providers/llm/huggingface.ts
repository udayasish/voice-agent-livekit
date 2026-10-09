import logger from "../../../../lib/logger.js";
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
  LLMUsage,
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

  /**
   * Prepares the message list, prepending system prompt if provided in options.
   */
  private prepareMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
  ): Array<{ role: string; content: string }> {
    const list: Array<{ role: string; content: string }> = [];

    if (systemPrompt && systemPrompt.trim().length > 0) {
      // Add system prompt if not already present as first message
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

  /**
   * Generates a streaming response delta-by-delta as an AsyncIterable of LLMChunks.
   */
  async *generate(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): AsyncIterable<LLMChunk> {
    if (!this.config.isConfigured || !this.config.apiKey) {
      throw new Error(
        "Hugging Face API token is required. Set HUGGINGFACE_API_TOKEN in .env or pass apiKey in provider options.",
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
      logger.error("[llm:huggingface] Network error calling Hugging Face router", { error: message });
      throw new Error(`Hugging Face inference network error: ${message}`);
    }

    if (!response.ok) {
      clearTimeout(timeout);
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      logger.error("[llm:huggingface] HTTP error from Hugging Face router", {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      });
      throw new Error(
        `Hugging Face API returned ${response.status} ${response.statusText}: ${errorBody || "Unknown error"}`,
      );
    }

    if (!response.body) {
      clearTimeout(timeout);
      throw new Error("Hugging Face API response body is empty");
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

  /**
   * Generates a complete LLMResponse via non-streaming chat completions.
   */
  async chat(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): Promise<LLMResponse> {
    if (!this.config.isConfigured || !this.config.apiKey) {
      throw new Error(
        "Hugging Face API token is required. Set HUGGINGFACE_API_TOKEN in .env or pass apiKey in provider options.",
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
          `Hugging Face API returned ${response.status} ${response.statusText}: ${errorBody || "Unknown error"}`,
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
