import env from "../../../../lib/env.js";

export interface IndicF5Config {
  /** Base URL for the Python IndicF5 TTS microservice */
  serviceUrl?: string | undefined;
  /** Audio output sample rate (default: 24000 Hz) */
  sampleRate?: number | undefined;
  /** Request timeout in milliseconds (default: 15000 ms) */
  timeoutMs?: number | undefined;
  /** Default target language (default: 'as' for Assamese) */
  language?: string | undefined;
}

export interface ResolvedIndicF5Config {
  serviceUrl: string;
  sampleRate: number;
  timeoutMs: number;
  language: string;
}

/**
 * Returns resolved runtime configuration for the IndicF5 TTS service.
 */
export function getIndicF5Config(overrides?: Partial<IndicF5Config>): ResolvedIndicF5Config {
  return {
    serviceUrl: (overrides?.serviceUrl ?? env.TTS_SERVICE_URL ?? "http://localhost:8001").replace(/\/+$/, ""),
    sampleRate: overrides?.sampleRate ?? 24000,
    timeoutMs: overrides?.timeoutMs ?? 15000,
    language: overrides?.language ?? "as",
  };
}
