import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { successResponse } from "../../lib/response.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { getUserOrganizations } from "./services/get-user-organizations.js";
import { getOrganizationById } from "./services/get-organization-by-id.js";

export const getMyOrganizationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.ctx?.user?.id;
  if (!userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHORIZED");
  }

  const organizations = await getUserOrganizations(userId);
  res.status(200).json(successResponse(organizations));
});

export const getOrganizationByIdHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.ctx?.user?.id;
  if (!userId) {
    throw new UnauthorizedError("Not authenticated", "UNAUTHORIZED");
  }

  const rawOrgId = req.ctx?.organization?.id ?? req.params["organizationId"] ?? req.params["id"];
  const orgId = Array.isArray(rawOrgId) ? rawOrgId[0] : rawOrgId;
  if (!orgId) {
    throw new BadRequestError("Organization ID missing", "BAD_REQUEST");
  }

  const organization = await getOrganizationById(orgId, userId);
  res.status(200).json(successResponse(organization));
});
