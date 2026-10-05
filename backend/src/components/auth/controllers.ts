import type { Request, Response } from "express";
import env from "../../lib/env.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { successResponse } from "../../lib/response.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { login } from "./services/login.js";
import { refresh } from "./services/refresh.js";
import { logout } from "./services/logout.js";
import { getMe } from "./services/get-me.js";
import type { LoginInput } from "./schema.js";

const isProd = env.NODE_ENV === "production";

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  maxAge: 15 * 60 * 1000, // 15 mins
  path: "/",
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/",
};

export const loginHandler = asyncHandler(async (req: Request<{}, {}, LoginInput>, res: Response) => {
  const result = await login(req.body);

  res.cookie("access_token", result.accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie("refresh_token", result.refreshToken, REFRESH_COOKIE_OPTIONS);

  res.status(200).json(
    successResponse({
      user: result.user,
      organizations: result.organizations,
      currentOrganization: result.currentOrganization,
      accessToken: result.accessToken,
    })
  );
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token ?? req.body?.refreshToken;

  if (!token || typeof token !== "string") {
    throw new UnauthorizedError("Refresh token is required", "UNAUTHORIZED");
  }

  const result = await refresh(token);

  res.cookie("access_token", result.accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie("refresh_token", result.refreshToken, REFRESH_COOKIE_OPTIONS);

  res.status(200).json(
    successResponse({
      user: result.user,
      accessToken: result.accessToken,
    })
  );
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refresh_token ?? req.body?.refreshToken;
  const userId = req.ctx?.user?.id;

  await logout(userId, typeof refreshToken === "string" ? refreshToken : undefined);

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });

  res.status(200).json(
    successResponse({
      message: "Logged out successfully",
    })
  );
});

export const getMeHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.ctx?.user?.id;
  if (!userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHORIZED");
  }

  const result = await getMe(userId);

  res.status(200).json(successResponse(result));
});
