import env from "../../../../lib/env.js";
import { HuggingFaceLLMProvider } from "./huggingface.js";
import { GroqLLMProvider } from "./groq.js";
import { MockLLMProvider } from "./mock.js";
import type { HuggingFaceConfig, GroqConfig } from "./config.js";
import type { LLMProvider } from "./types.js";

/**
 * Factory function returning the configured LLMProvider instance.
 * Adheres to the provider abstraction specified in VOICE_AI_ARCHITECTURE.md and TECH_STACK.md.
 * Allows effortless transition to Groq (qwen-2.5-32b), Hugging Face, or offline mock.
 */
export function getLLMProvider(
  providerType?: "huggingface" | "groq" | "mock" | undefined,
  options?: Partial<HuggingFaceConfig | GroqConfig> | undefined,
): LLMProvider {
  const selected = providerType ?? env.LLM_PROVIDER;

  switch (selected) {
    case "groq":
      return new GroqLLMProvider(options as Partial<GroqConfig>);
    case "mock":
      return new MockLLMProvider();
    case "huggingface":
    default:
      return new HuggingFaceLLMProvider(options as Partial<HuggingFaceConfig>);
  }
}
