import { createClient } from "redis";
import env from "./env.js";
import logger from "./logger.js";

export const redis = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 3) {
        return false; // Stop retrying if Redis is not running
      }
      return Math.min(retries * 500, 2000);
    },
  },
});

redis.on("error", (err) => {
  // Only log if not ECONNREFUSED or log once
  if (err?.code !== "ECONNREFUSED") {
    logger.error("Redis Client Error", err);
  }
});

export const connectRedis = async () => {
  try {
    await redis.connect();
    logger.info("Connected to Redis");
  } catch (err) {
    logger.error("Failed to connect to Redis:", err);
  }
};
