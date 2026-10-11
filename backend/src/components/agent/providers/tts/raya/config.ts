import env from "../../../../../lib/env.js";
import { RayaConfigurationError } from "./errors.js";
import type { RayaModel, RayaTTSConfig, ResolvedRayaTTSConfig } from "./types.js";

const VALID_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000]);

/**
 * Resolves and validates runtime configuration for Raya BakBak TTS.
 */
export function getRayaConfig(overrides?: Partial<RayaTTSConfig>): ResolvedRayaTTSConfig {
  const apiKey = (overrides?.apiKey ?? env.RAYA_API_KEY ?? "").trim();
  const baseUrl = (overrides?.baseUrl ?? env.RAYA_API_BASE_URL ?? "https://hub.getraya.app/v1").replace(/\/+$/, "");
  const language = (overrides?.language ?? env.RAYA_TTS_LANGUAGE ?? "as").trim();
  const model: RayaModel = overrides?.model ?? env.RAYA_TTS_MODEL ?? "standard";
  const voiceId = (overrides?.voiceId ?? env.RAYA_TTS_VOICE_ID ?? "").trim();
  const sampleRate = overrides?.sampleRate ?? env.RAYA_TTS_SAMPLE_RATE ?? 24000;
  const speed = overrides?.speed ?? env.RAYA_TTS_SPEED ?? 1.0;
  const connectTimeoutMs = overrides?.connectTimeoutMs ?? env.RAYA_TTS_CONNECT_TIMEOUT_MS ?? 3000;
  const firstChunkTimeoutMs = overrides?.firstChunkTimeoutMs ?? env.RAYA_TTS_FIRST_CHUNK_TIMEOUT_MS ?? 1000;
  const requestTimeoutMs = overrides?.requestTimeoutMs ?? env.RAYA_TTS_REQUEST_TIMEOUT_MS ?? 15000;

  if (!VALID_SAMPLE_RATES.has(sampleRate)) {
    throw new RayaConfigurationError(
      `Invalid sample rate ${sampleRate}. Raya BakBak supports 8000, 16000, 22050, or 24000 Hz`,
    );
  }

  if (speed < 0.5 || speed > 1.5) {
    throw new RayaConfigurationError(
      `Invalid speed ${speed}. Raya BakBak speed must be between 0.5 and 1.5`,
    );
  }

  if (model !== "standard" && model !== "m1") {
    throw new RayaConfigurationError(
      `Invalid model "${model}". Raya BakBak model must be "standard" or "m1"`,
    );
  }

  return {
    apiKey,
    baseUrl,
    language,
    model,
    voiceId,
    sampleRate,
    speed,
    connectTimeoutMs,
    firstChunkTimeoutMs,
    requestTimeoutMs,
  };
}
