import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"] as const)
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/voice_agent"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32).default("your-super-secret-jwt-access-key-min-32-chars"),
  JWT_ACCESS_EXPIRATION: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32).default("your-super-secret-jwt-refresh-key-min-32-chars"),
  JWT_REFRESH_EXPIRATION: z.string().default("7d"),
  LIVEKIT_URL: z.string().default("http://localhost:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("devsecret"),
  TTS_SERVICE_URL: z.string().default("http://localhost:8001"),
  DEEPGRAM_API_KEY: z.string().optional(),
  HUGGINGFACE_API_TOKEN: z.string().optional(),
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
