import { revokeAllUserTokens, revokeRefreshToken, verifyRefreshToken } from "../../../lib/jwt.js";

export async function logout(userId?: string, refreshToken?: string) {
  if (refreshToken) {
    try {
      const payload = await verifyRefreshToken(refreshToken);
      await revokeRefreshToken(payload.id, payload.jti);
      return;
    } catch {
      // If token verification fails, proceed to revoke all user tokens if userId known
    }
  }

  if (userId) {
    await revokeAllUserTokens(userId);
  }
}
