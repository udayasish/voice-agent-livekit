import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"] as const)
    .default("development"),
  PORT: z.coerce.number().default(4000),

  // ── Database (PostgreSQL) ──────────────────────────────────────────────────
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/voice_agent"),

  // ── Cache & Session State (Redis) ──────────────────────────────────────────
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // ── JWT Primitives ────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32).default("your-super-secret-jwt-access-key-min-32-chars"),
  JWT_ACCESS_EXPIRATION: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32).default("your-super-secret-jwt-refresh-key-min-32-chars"),
  JWT_REFRESH_EXPIRATION: z.string().default("7d"),

  // ── Realtime Media Transport (LiveKit) ────────────────────────────────────
  LIVEKIT_URL: z.string().default("http://127.0.0.1:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("devsecret"),
  LIVEKIT_AGENT_NAME: z.string().optional(),

  // ── Python TTS Service (AI4Bharat IndicF5) ────────────────────────────────
  TTS_SERVICE_URL: z.string().default("http://localhost:8001"),

  // ── Speech-to-Text (STT) Configuration ─────────────────────────────────────
  STT_PROVIDER: z.enum(["deepgram", "indicconformer"]).default("deepgram"),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default("nova-3"),
  DEEPGRAM_LANGUAGE: z.string().default("as"),
  DEEPGRAM_BASE_URL: z.string().default("wss://api.deepgram.com"),
  DEEPGRAM_ENDPOINTING_MS: z.coerce.number().default(300),

  // ── LLM Configuration ───────────────────────────────────────────────────────
  LLM_PROVIDER: z.enum(["huggingface", "groq", "mock"]).default("groq"),
  // Hugging Face router config
  HUGGINGFACE_API_TOKEN: z.string().optional(),
  HUGGINGFACE_BASE_URL: z.string().default("https://router.huggingface.co/v1"),
  HUGGINGFACE_MODEL: z.string().default("Qwen/Qwen3.5-4B"),

  // Groq Cloud (Free Tier - Qwen 3.8 27B)
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().default("qwen/qwen3.8-27b"),

  // ── Business / Clinic Configuration ─────────────────────────────────────────
  CLINIC_NAME: z.string().default("Brahmaputra Health Clinic"),

  // ── Frontend / CORS ───────────────────────────────────────────────────────
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((val) =>
      val
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export default env;
