import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/db.js";
import { users } from "../../../lib/db/models/users.js";
import {
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
} from "../../../lib/jwt.js";
import { UnauthorizedError } from "../../../lib/errors.js";

export async function refresh(token: string) {
  let payload;
  try {
    payload = await verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError("The refresh token is invalid or has expired", "UNAUTHORIZED");
  }

  // Check Redis revocation
  const isValid = await isRefreshTokenValid(payload.id, payload.jti);
  if (!isValid) {
    throw new UnauthorizedError("Refresh token has been revoked or expired", "UNAUTHORIZED");
  }

  // Revoke old refresh token (token rotation)
  await revokeRefreshToken(payload.id, payload.jti);

  // Verify user still exists and active
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.id),
  });

  if (!user || user.status !== "active") {
    throw new UnauthorizedError("User is no longer active", "UNAUTHORIZED");
  }

  // Issue new token pair
  const newJti = crypto.randomUUID();
  const newAccessToken = await signAccessToken({ id: user.id, email: user.email });
  const newRefreshToken = await signRefreshToken({ id: user.id, jti: newJti });

  await storeRefreshToken(user.id, newJti);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    },
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}
