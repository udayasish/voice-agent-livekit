import { SignJWT, jwtVerify } from "jose";
import env from "./env.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export async function signAccessToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRATION)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessSecret);
  return payload;
}

export async function signRefreshToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_EXPIRATION)
    .sign(refreshSecret);
}

export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(token, refreshSecret);
  return payload;
}
