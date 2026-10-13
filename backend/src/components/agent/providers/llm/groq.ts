import logger from "../../../../lib/logger.js";
import { z } from "zod";
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
      max_completion_tokens: options?.maxTokens ?? this.config.maxTokens,
      ...this.voiceSettings(targetModel),
      stream: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const requestSignal = options?.abortSignal
      ? AbortSignal.any([controller.signal, options.abortSignal]) : controller.signal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[llm:groq] Network error calling Groq API");
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
    let finishReason: string | undefined;
    let usage: LLMUsage | undefined;
    const usageSchema = z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() });
    const eventSchema = z.object({
      choices: z.array(z.object({
        delta: z.object({ content: z.string().nullable().optional() }).optional(),
        finish_reason: z.string().nullable().optional(),
      })).optional(),
      usage: usageSchema.nullable().optional(),
      x_groq: z.object({ usage: usageSchema.optional() }).optional(),
    });

    try {
      while (true) {
        if (options?.abortSignal?.aborted || controller.signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
            continue;
          }

          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") {
            yield { type: "done", usage, finishReason };
            return;
          }

          try {
            const parsed = eventSchema.parse(JSON.parse(dataStr));
            const choice = parsed.choices?.[0];
            finishReason = choice?.finish_reason ?? finishReason;
            const tokenUsage = parsed.usage ?? parsed.x_groq?.usage;
            if (tokenUsage) usage = { promptTokens: tokenUsage.prompt_tokens, completionTokens: tokenUsage.completion_tokens, totalTokens: tokenUsage.total_tokens };
            const delta = choice?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              yield { type: "text", delta };
            }
          } catch {
            // Ignore incomplete JSON chunks in SSE stream
          }
        }
        if (done) break;
      }

      requestSignal.throwIfAborted();
      yield { type: "done", usage, finishReason };
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
      max_completion_tokens: options?.maxTokens ?? this.config.maxTokens,
      ...this.voiceSettings(targetModel),
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const requestSignal = options?.abortSignal
      ? AbortSignal.any([controller.signal, options.abortSignal]) : controller.signal;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
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
