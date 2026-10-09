import env from "../../../../lib/env.js";
import type {
  LLMCapabilities,
  LLMChunk,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "./types.js";

export interface MockLLMProviderOptions {
  model?: string | undefined;
  chunkDelayMs?: number | undefined;
  fixedResponse?: string | undefined;
  clinicName?: string | undefined;
}

/**
 * Mock LLM Provider for unit tests, benchmarking harnesses, and ₹0 offline development.
 * Produces deterministic, linguistically sound responses matching the requested languages
 * (Assamese, Hindi, English, Code-Switching) and conversational requirements.
 */
export class MockLLMProvider implements LLMProvider {
  readonly label = "Mock LLM Provider (Offline ₹0)";

  readonly capabilities: LLMCapabilities = {
    streaming: true,
    toolCalling: true,
    multilingual: true,
    models: ["mock-qwen-voice", "Qwen/Qwen3.5-4B"],
  };

  private chunkDelayMs: number;
  private fixedResponse?: string | undefined;
  private clinicName: string;

  constructor(options?: MockLLMProviderOptions) {
    this.chunkDelayMs = options?.chunkDelayMs ?? 0;
    this.fixedResponse = options?.fixedResponse;
    this.clinicName = options?.clinicName ?? env.CLINIC_NAME;
  }

  /**
   * Generates a conversational response tailored to the input language and intent.
   */
  private generateMockResponse(messages: LLMMessage[]): string {
    if (this.fixedResponse) {
      return this.fixedResponse;
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lower = lastUserMessage.toLowerCase();

    // 1. Missing information detection
    // e.g., asks for appointment but provides no doctor, date, or time
    const isAppointmentRequest =
      lastUserMessage.includes("এপইণ্টমেণ্ট") ||
      lastUserMessage.includes("appointment") ||
      lastUserMessage.includes("अपॉइंटमेंट") ||
      lastUserMessage.includes("booking") ||
      lastUserMessage.includes("বুক");

    const hasDoctorOrSpecialty =
      lastUserMessage.includes("বৰুৱা") ||
      lastUserMessage.includes("Baruah") ||
      lastUserMessage.includes("doctor") ||
      lastUserMessage.includes("ডাঃ") ||
      lastUserMessage.includes("डॉक्टर");

    const hasTimeOrDate =
      lastUserMessage.includes("কাইলৈ") ||
      lastUserMessage.includes("tomorrow") ||
      lastUserMessage.includes("कल") ||
      lastUserMessage.includes("বজাত") ||
      lastUserMessage.includes("pm") ||
      lastUserMessage.includes("am");

    // Missing details case:
    if (isAppointmentRequest && (!hasDoctorOrSpecialty || !hasTimeOrDate)) {
      if (lower.match(/[\u0980-\u09FF]/)) {
        // Assamese script
        return "নিশ্চয়, আপুনি কোন তাৰিখে আৰু কোনজন চিকিৎসকৰ ওচৰলৈ যাব বিচাৰে অনুগ্ৰহ কৰি কওক।";
      }
      if (lower.match(/[\u0900-\u097F]/)) {
        // Devanagari / Hindi script
        return "ज़रूर, कृपया बताएं कि आप किस तारीख को और किस डॉक्टर से मिलना चाहते हैं?";
      }
      return "Sure, please let me know which doctor and date you would prefer for your appointment.";
    }

    // 2. Code-switching (Assamese script + English words or phonetic code-mix)
    if (
      lower.match(/[\u0980-\u09FF]/) &&
      (lower.includes("appointment") || lower.includes("clinic") || lower.includes("doctor") || lower.includes("book"))
    ) {
      return "নমস্কাৰ, কাইলৈ আমাৰ ক্লিনিকত ডাঃ বৰুৱাৰ লগত পুৱা ১০ বজাত এপইণ্টমেণ্ট উপলব্ধ আছে।";
    }

    // 3. Pure Assamese
    if (lower.match(/[\u0980-\u09FF]/)) {
      return `নমস্কাৰ, ${this.clinicName}লৈ স্বাগতম। মই আপোনাক কেনেদৰে সহায় কৰিব পাৰো?`;
    }

    // 4. Hindi
    if (lower.match(/[\u0900-\u097F]/)) {
      return `नमस्ते, ${this.clinicName} में आपका स्वागत है। मैं आपकी क्या सहायता कर सकता हूँ?`;
    }

    // 5. English default
    return `Hello, welcome to ${this.clinicName}. How can I assist you with your appointment today?`;
  }

  /**
   * Streaming generator simulating token chunks.
   */
  async *generate(
    messages: LLMMessage[],
    options?: Partial<LLMOptions>,
  ): AsyncIterable<LLMChunk> {
    const fullText = this.generateMockResponse(messages);
    // Split into natural word chunks to simulate LLM streaming
    const words = fullText.split(" ");

    for (let i = 0; i < words.length; i++) {
      if (options?.abortSignal?.aborted) {
        break;
      }

      if (this.chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      }

      const word = words[i] ?? "";
      const chunk = i === words.length - 1 ? word : `${word} `;
      yield { type: "text", delta: chunk };
    }

    yield {
      type: "done",
      usage: {
        promptTokens: messages.reduce((acc, m) => acc + m.content.length / 4, 0),
        completionTokens: Math.round(fullText.length / 4),
        totalTokens: Math.round((messages.reduce((acc, m) => acc + m.content.length, 0) + fullText.length) / 4),
      },
    };
  }

  /**
   * Non-streaming complete response.
   */
  async chat(
    messages: LLMMessage[],
    _options?: Partial<LLMOptions>,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const text = this.generateMockResponse(messages);
    const latencyMs = Date.now() - startTime;

    return {
      text,
      role: "assistant",
      usage: {
        promptTokens: 20,
        completionTokens: 15,
        totalTokens: 35,
      },
      finishReason: "stop",
      latencyMs,
    };
  }
}
