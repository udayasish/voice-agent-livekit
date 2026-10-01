import env from "../../../../lib/env.js";

export type HuggingFaceConfig = {
  /** External API base URL (OpenAI-compatible router) */
  baseURL: string;
  /** Target model identifier */
  model: string;
  /** Secure external API token */
  apiKey: string | undefined;
  /** Whether the external provider credentials are configured */
  isConfigured: boolean;
};

/**
 * Returns the application configuration for Hugging Face Inference Providers.
 * Note: Hugging Face Inference Providers are an EXTERNAL managed API service.
 * They run in cloud infrastructure (₹0 free tier), NOT in a local Docker container.
 */
export function getHuggingFaceConfig(): HuggingFaceConfig {
  const apiKey = env.HUGGINGFACE_API_TOKEN;
  return {
    baseURL: env.HUGGINGFACE_BASE_URL,
    model: env.HUGGINGFACE_MODEL,
    apiKey,
    isConfigured: Boolean(apiKey && apiKey.trim().length > 0),
  };
}
