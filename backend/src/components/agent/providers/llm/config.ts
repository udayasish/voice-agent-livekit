import env from "../../../../lib/env.js";

export interface HuggingFaceConfig {
  /** External API base URL (OpenAI-compatible router) */
  baseURL?: string | undefined;
  /** Target model identifier (default: "Qwen/Qwen3.5-4B") */
  model?: string | undefined;
  /** Secure external API token */
  apiKey?: string | undefined;
  /** Temperature for response generation (default: 0.3) */
  temperature?: number | undefined;
  /** Maximum completion tokens (default: 256 for voice brevity) */
  maxTokens?: number | undefined;
  /** Request timeout in milliseconds (default: 15000) */
  timeoutMs?: number | undefined;
  /** Whether the external provider credentials are configured */
  isConfigured?: boolean | undefined;
}

export interface ResolvedHuggingFaceConfig {
  baseURL: string;
  model: string;
  apiKey: string | undefined;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  isConfigured: boolean;
}

/**
 * Returns the application configuration for Hugging Face Inference Providers.
 * Note: Hugging Face Inference Providers are an EXTERNAL managed API service.
 * They run in cloud infrastructure (₹0 free tier), NOT in a local Docker container.
 */
export function getHuggingFaceConfig(
  overrides?: Partial<HuggingFaceConfig>,
): ResolvedHuggingFaceConfig {
  const apiKey = overrides?.apiKey ?? env.HUGGINGFACE_API_TOKEN;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

  return {
    baseURL: (overrides?.baseURL ?? env.HUGGINGFACE_BASE_URL).replace(/\/+$/, ""),
    model: overrides?.model ?? env.HUGGINGFACE_MODEL,
    apiKey,
    temperature: overrides?.temperature ?? 0.3,
    maxTokens: overrides?.maxTokens ?? 256,
    timeoutMs: overrides?.timeoutMs ?? 15000,
    isConfigured,
  };
}

export interface GroqConfig {
  /** External API base URL (default: "https://api.groq.com/openai/v1") */
  baseURL?: string | undefined;
  /** Target model identifier (default: "qwen/qwen3.8-27b") */
  model?: string | undefined;
  /** Secure external Groq API key */
  apiKey?: string | undefined;
  /** Temperature for response generation (default: 0.3) */
  temperature?: number | undefined;
  /** Maximum completion tokens (default: 256 for voice brevity) */
  maxTokens?: number | undefined;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number | undefined;
  /** Whether the external provider credentials are configured */
  isConfigured?: boolean | undefined;
}

export interface ResolvedGroqConfig {
  baseURL: string;
  model: string;
  apiKey: string | undefined;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  isConfigured: boolean;
}

/**
 * Returns the application configuration for Groq Cloud.
 */
export function getGroqConfig(overrides?: Partial<GroqConfig>): ResolvedGroqConfig {
  const apiKey = overrides?.apiKey ?? env.GROQ_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);

  return {
    baseURL: (overrides?.baseURL ?? env.GROQ_BASE_URL).replace(/\/+$/, ""),
    model: overrides?.model ?? env.GROQ_MODEL,
    apiKey,
    temperature: overrides?.temperature ?? 0.3,
    maxTokens: overrides?.maxTokens ?? 256,
    timeoutMs: overrides?.timeoutMs ?? 10000,
    isConfigured,
  };
}
