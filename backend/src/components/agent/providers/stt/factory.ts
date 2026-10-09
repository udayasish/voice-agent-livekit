import env from "../../../../lib/env.js";
import { DeepgramSTTProvider } from "./deepgram.js";
import { IndicConformerSTTProvider } from "./fallback.js";
import type { DeepgramConfig } from "./config.js";
import type { STTProvider } from "./types.js";

/**
 * Factory function returning the configured STTProvider instance.
 * Defaults to Deepgram Nova-3 streaming STT.
 */
export function getSTTProvider(
  providerType?: "deepgram" | "indicconformer" | undefined,
  options?: Partial<DeepgramConfig> | undefined,
): STTProvider {
  const selected = providerType ?? env.STT_PROVIDER;

  switch (selected) {
    case "indicconformer":
      return new IndicConformerSTTProvider();
    case "deepgram":
    default:
      return new DeepgramSTTProvider(options);
  }
}
