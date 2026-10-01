import type { Request, Response } from "express";
import { pool } from "../../lib/db/db.js";
import { redis } from "../../lib/redis.js";
import env from "../../lib/env.js";
import { getHuggingFaceConfig } from "../agent/providers/llm/config.js";

export const getHealth = async (_req: Request, res: Response) => {
  // Check PostgreSQL
  let postgresStatus = "disconnected";
  try {
    const pgRes = await pool.query("SELECT 1 AS ok");
    if (pgRes.rows[0]?.ok === 1) {
      postgresStatus = "connected";
    }
  } catch {
    postgresStatus = "disconnected";
  }

  // Check Redis
  let redisStatus = "disconnected";
  try {
    if (redis.isOpen) {
      const pong = await redis.ping();
      if (pong === "PONG") {
        redisStatus = "connected";
      }
    }
  } catch {
    redisStatus = "disconnected";
  }

  // Check LiveKit availability
  let livekitStatus = "unreachable";
  try {
    const lkRes = await fetch(env.LIVEKIT_URL, { signal: AbortSignal.timeout(2000) });
    if (lkRes.ok || lkRes.status === 200 || lkRes.status === 404 || lkRes.status === 400) {
      // Any response from LiveKit HTTP listener means it's available
      livekitStatus = "reachable";
    }
  } catch {
    livekitStatus = "unreachable";
  }

  // Hugging Face Inference Providers configuration status
  const hfConfig = getHuggingFaceConfig();
  const huggingfaceStatus = {
    provider: "huggingface-inference-providers",
    deployment: "external-api", // Explicitly note it is an external cloud API, not local Docker
    model: hfConfig.model,
    baseURL: hfConfig.baseURL,
    configured: hfConfig.isConfigured,
  };

  const isHealthy = postgresStatus === "connected" && redisStatus === "connected" && livekitStatus === "reachable";

  res.status(isHealthy ? 200 : 200).json({
    success: true,
    data: {
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      service: "voice-agent-backend",
      infrastructure: {
        postgres: postgresStatus,
        redis: redisStatus,
        livekit: livekitStatus,
      },
      llm: huggingfaceStatus,
    },
  });
};
