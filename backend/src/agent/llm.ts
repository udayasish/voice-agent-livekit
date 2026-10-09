import env from "../lib/env.js";
import logger from "../lib/logger.js";
import {
  getLLMProvider,
  type LLMChunk,
  type LLMMessage,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type HuggingFaceConfig,
  HuggingFaceLLMProvider,
  GroqLLMProvider,
} from "../components/agent/providers/llm/index.js";

/**
 * Generates the voice agent system prompt parameterized with the configured clinic/business name.
 * Tailored for speech synthesis: concise, spoken-friendly, multilingual, and strictly fact-grounded.
 */
export function createVoiceSystemPrompt(clinicName: string = env.CLINIC_NAME): string {
  return `
You are an AI voice receptionist for ${clinicName}.
You are speaking directly to callers over the telephone.

CRITICAL RULES FOR SPOKEN VOICE:
1. Spoken Brevity:
   - Keep all responses concise and voice-friendly (1 to 2 short sentences).
   - NEVER use markdown syntax (no asterisks, bold, italics, hashtags, dashes, or bullet points).
   - NEVER use emojis, HTML tags, or unpronounceable punctuation.

2. Multilingual Fluency & Code-Switching:
   - You understand Assamese (অসমীয়া), Hindi (हिन्दी), and English fluently.
   - Always reply in the SAME language the caller is speaking.
   - If the caller speaks Assamese, reply in polite Assamese.
   - If the caller speaks Hindi, reply in polite Hindi.
   - If the caller speaks English, reply in polite English.
   - If the caller code-switches (Assamese mixed with English clinical terms like "appointment", "doctor", "clinic"), reply naturally in conversational Assamese.

3. Missing Information & Clarification:
   - If the caller asks for an appointment but omits necessary details (doctor name, department, date, or time), politely ask for the missing detail.
   - Ask for only one or two missing details at a time.

4. Strict Factuality:
   - Do not hallucinate appointment slots, doctor schedules, or medical advice.
   - Never claim an appointment is booked without system confirmation.
`.trim();
}

/**
 * Standard system prompt for the voice agent using the environment-configured clinic name.
 */
export const DEFAULT_VOICE_SYSTEM_PROMPT = createVoiceSystemPrompt();

export interface ProcessUtteranceResult {
  text: string;
  stream: AsyncIterable<LLMChunk>;
  ttftMs: number;
  totalLatencyMs: number;
}

/**
 * Conversation session managing dialog turns, context history, and LLM interaction
 * for a specific participant in a voice call.
 */
export class ConversationSession {
  readonly roomName: string;
  readonly participantIdentity: string;
  private provider: LLMProvider;
  private messages: LLMMessage[] = [];
  private systemPrompt: string;

  constructor(
    provider: LLMProvider,
    options: {
      roomName: string;
      participantIdentity: string;
      systemPrompt?: string | undefined;
      clinicName?: string | undefined;
    },
  ) {
    this.provider = provider;
    this.roomName = options.roomName;
    this.participantIdentity = options.participantIdentity;
    this.systemPrompt =
      options.systemPrompt ??
      createVoiceSystemPrompt(options.clinicName ?? env.CLINIC_NAME);
  }

  /**
   * Retrieves current conversation turn history.
   */
  getHistory(): readonly LLMMessage[] {
    return this.messages;
  }

  /**
   * Clears conversational history for the session.
   */
  clearHistory(): void {
    this.messages = [];
  }

  /**
   * Processes a user speech transcript through the LLM provider.
   * Flow: STT text -> LLM provider -> response text.
   */
  async processUserUtterance(
    userText: string,
    options?: {
      abortSignal?: AbortSignal;
      maxTokens?: number;
      temperature?: number;
    },
  ): Promise<ProcessUtteranceResult> {
    const trimmed = userText.trim();
    if (!trimmed) {
      throw new Error("User utterance cannot be empty");
    }

    // 1. Append user message to history
    this.messages.push({
      role: "user",
      content: trimmed,
    });

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let accumulatedText = "";

    // 2. Stream generation from the LLM provider
    const llmOptions: Partial<LLMOptions> = {
      systemPrompt: this.systemPrompt,
      abortSignal: options?.abortSignal,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    };

    const capturedChunks: LLMChunk[] = [];

    try {
      const chunkStream = this.provider.generate(this.messages, llmOptions);

      for await (const chunk of chunkStream) {
        if (options?.abortSignal?.aborted) {
          break;
        }

        capturedChunks.push(chunk);

        if (chunk.type === "text" && chunk.delta.length > 0) {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          accumulatedText += chunk.delta;
        }
      }
    } catch (err) {
      // Automatic fallback if cloud provider fails (e.g. 0 credits, model unsupported, network error)
      logger.warn(
        `[agent:llm] Primary LLM provider failed (${err instanceof Error ? err.message : String(err)}). Falling back to offline provider to preserve conversational session.`,
      );
      const fallbackProvider = getLLMProvider("mock");
      const fallbackStream = fallbackProvider.generate(this.messages, llmOptions);
      capturedChunks.length = 0;
      accumulatedText = "";

      for await (const chunk of fallbackStream) {
        if (options?.abortSignal?.aborted) break;
        capturedChunks.push(chunk);
        if (chunk.type === "text" && chunk.delta.length > 0) {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          accumulatedText += chunk.delta;
        }
      }
    }

    const totalLatencyMs = Date.now() - startTime;
    const ttftMs = firstTokenTime !== null ? firstTokenTime - startTime : totalLatencyMs;
    const finalText = accumulatedText.trim();

    // 3. Append assistant response to history
    if (finalText.length > 0) {
      this.messages.push({
        role: "assistant",
        content: finalText,
      });
    }

    // Replay iterable for caller consumption
    async function* replayChunks() {
      for (const c of capturedChunks) {
        yield c;
      }
    }

    return {
      text: finalText,
      stream: replayChunks(),
      ttftMs,
      totalLatencyMs,
    };
  }

  /**
   * Non-streaming convenience turn execution.
   */
  async chat(
    userText: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<LLMResponse> {
    const trimmed = userText.trim();
    this.messages.push({
      role: "user",
      content: trimmed,
    });

    const response = await this.provider.chat(this.messages, {
      systemPrompt: this.systemPrompt,
      abortSignal: options?.abortSignal,
    });

    if (response.text.trim().length > 0) {
      this.messages.push({
        role: "assistant",
        content: response.text.trim(),
      });
    }

    return response;
  }
}

/**
 * Initializes and loads the configured LLMProvider for the LiveKit agent worker.
 * Defaults to Hugging Face Inference Providers (Qwen3.5-4B).
 * Safely warns and falls back to mock provider if credentials are not configured in ₹0 local dev.
 */
export function loadLLMProvider(
  options?: Partial<HuggingFaceConfig>,
): LLMProvider {
  const provider = getLLMProvider(undefined, options);

  if (provider instanceof GroqLLMProvider && !provider.isConfigured) {
    logger.info(
      "[agent:llm] GROQ_API_KEY not configured. To use Groq (qwen-2.5-32b), set GROQ_API_KEY in backend/.env. Using mock provider for ₹0 local development.",
    );
    return getLLMProvider("mock");
  }

  if (provider instanceof HuggingFaceLLMProvider && !provider.isConfigured) {
    logger.info(
      "[agent:llm] HUGGINGFACE_API_TOKEN not configured. Hugging Face cloud inference requires an API token. Using mock provider for ₹0 local development.",
    );
    return getLLMProvider("mock");
  }

  logger.info("[agent:llm] LLM Provider initialized successfully", {
    label: provider.label,
    capabilities: provider.capabilities,
  });

  return provider;
}
