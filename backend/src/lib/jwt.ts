import { SignJWT, jwtVerify } from "jose";
import env from "./env.js";
import { redis } from "./redis.js";
import logger from "./logger.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export type AccessTokenPayload = {
  id: string;
  email: string;
};

export type RefreshTokenPayload = {
  id: string;
  jti: string;
};

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRATION)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessSecret);
  if (!payload || typeof payload !== "object" || !("id" in payload) || !("email" in payload)) {
    throw new Error("Invalid access token payload");
  }
  return {
    id: String(payload.id),
    email: String(payload.email),
  };
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_EXPIRATION)
    .sign(refreshSecret);
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshSecret);
  if (!payload || typeof payload !== "object" || !("id" in payload) || !("jti" in payload)) {
    throw new Error("Invalid refresh token payload");
  }
  return {
    id: String(payload.id),
    jti: String(payload.jti),
  };
}

// ── Redis Session & Refresh Token Tracking ─────────────────────────────────

const REFRESH_TOKEN_PREFIX = "refresh_token:";
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function storeRefreshToken(
  userId: string,
  jti: string,
  ttlSeconds: number = DEFAULT_REFRESH_TTL_SECONDS,
): Promise<void> {
  try {
    if (redis.isOpen) {
      const key = `${REFRESH_TOKEN_PREFIX}${userId}:${jti}`;
      await redis.set(key, "1", { EX: ttlSeconds });
    }
  } catch (err) {
    logger.error("Failed to store refresh token in Redis:", err);
  }
}

export async function isRefreshTokenValid(userId: string, jti: string): Promise<boolean> {
  try {
    if (!redis.isOpen) {
      // If Redis is temporarily unreachable, fallback to token signature validity
      return true;
    }
    const key = `${REFRESH_TOKEN_PREFIX}${userId}:${jti}`;
    const value = await redis.get(key);
    return value !== null;
  } catch (err) {
    logger.error("Failed to verify refresh token in Redis:", err);
    return false;
  }
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  try {
    if (redis.isOpen) {
      const key = `${REFRESH_TOKEN_PREFIX}${userId}:${jti}`;
      await redis.del(key);
    }
  } catch (err) {
    logger.error("Failed to revoke refresh token in Redis:", err);
  }
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    if (redis.isOpen) {
      const pattern = `${REFRESH_TOKEN_PREFIX}${userId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch (err) {
    logger.error("Failed to revoke all user tokens in Redis:", err);
  }
}
