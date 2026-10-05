import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { UnauthorizedError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { db } from "../lib/db/db.js";
import { users } from "../lib/db/models/users.js";

export const auth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.ctx?.user) {
    return next();
  }

  let token: string | undefined;

  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  // 2. Check HTTP-only cookie if header not provided
  if (!token && req.cookies && typeof req.cookies === "object") {
    token = req.cookies.access_token;
  }

  if (!token) {
    throw new UnauthorizedError("Authentication token is missing", "UNAUTHORIZED");
  }

  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError("The access token is invalid or has expired", "UNAUTHORIZED");
  }

  if (!payload || !payload.id) {
    throw new UnauthorizedError("Invalid token payload", "UNAUTHORIZED");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.id),
  });

  if (!user) {
    throw new UnauthorizedError("User does not exist", "USER_NOT_FOUND");
  }

  if (user.status !== "active") {
    throw new UnauthorizedError("User account is suspended", "USER_SUSPENDED");
  }

  req.ctx = {
    ...req.ctx,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    },
  };

  next();
});
