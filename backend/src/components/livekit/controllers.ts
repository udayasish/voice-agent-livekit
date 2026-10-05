import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { successResponse } from "../../lib/response.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { createToken } from "./services/create-token.js";
import type { CreateTokenInput } from "./schema.js";

export const createTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = req.ctx?.user;
  if (!user) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHORIZED");
  }

  const organization = req.ctx?.organization;
  if (!organization) {
    throw new BadRequestError("Organization context required", "MISSING_ORGANIZATION");
  }

  const tokenData = await createToken(req.body as CreateTokenInput, user, organization);

  res.status(200).json(successResponse(tokenData));
});
