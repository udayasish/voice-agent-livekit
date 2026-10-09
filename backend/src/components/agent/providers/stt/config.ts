import env from "../../../../lib/env.js";

export interface DeepgramConfig {
  /** Deepgram API key (token authentication) */
  apiKey?: string | undefined;
  /** Target model identifier (default: "nova-3") */
  model?: string | undefined;
  /** Primary spoken language (default: "as" for Assamese, supports "as-IN") */
  language?: string | undefined;
  /** Streaming WebSocket base URL (default: "wss://api.deepgram.com") */
  baseUrl?: string | undefined;
  /** Whether to apply automatic punctuation */
  punctuate?: boolean | undefined;
  /** Whether to apply smart formatting (dates, currencies, numbers) */
  smartFormat?: boolean | undefined;
  /** Whether to emit interim hypotheses while user is speaking */
  interimResults?: boolean | undefined;
  /** Endpointing silence window in milliseconds (default: 25) */
  endpointingMs?: number | undefined;
  /** Native sample rate in Hz (default: 16000) */
  sampleRate?: number | undefined;
  /** Native channels count (default: 1) */
  numChannels?: number | undefined;
  /** Whether credentials are validly configured */
  isConfigured?: boolean | undefined;
}

export interface ResolvedDeepgramConfig {
  apiKey: string | undefined;
  model: string;
  language: string;
  baseUrl: string;
  punctuate: boolean;
  smartFormat: boolean;
  interimResults: boolean;
  endpointingMs: number;
  sampleRate: number;
  numChannels: number;
  isConfigured: boolean;
}

/**
 * Returns the application configuration for Deepgram Nova-3 STT.
 * Validates configuration from environment variables with zero hardcoded secrets.
 */
export function getDeepgramConfig(overrides?: Partial<DeepgramConfig>): ResolvedDeepgramConfig {
  const apiKey = overrides?.apiKey ?? env.DEEPGRAM_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

  return {
    apiKey,
    model: overrides?.model ?? env.DEEPGRAM_MODEL,
    language: overrides?.language ?? env.DEEPGRAM_LANGUAGE,
    baseUrl: overrides?.baseUrl ?? env.DEEPGRAM_BASE_URL,
    punctuate: overrides?.punctuate ?? true,
    smartFormat: overrides?.smartFormat ?? true,
    interimResults: overrides?.interimResults ?? true,
    endpointingMs: overrides?.endpointingMs ?? env.DEEPGRAM_ENDPOINTING_MS,
    sampleRate: overrides?.sampleRate ?? 16000,
    numChannels: overrides?.numChannels ?? 1,
    isConfigured,
  };
}
