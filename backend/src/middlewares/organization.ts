import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import { db } from "../lib/db/db.js";
import { organizations, organizationMembers } from "../lib/db/models/organizations.js";

export const requireOrganization = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const user = req.ctx?.user;
  if (!user) {
    throw new UnauthorizedError("Authentication required before organization check", "UNAUTHORIZED");
  }

  // 1. Extract organization ID from header or route parameters
  const rawHeader = req.headers["x-organization-id"];
  const headerOrgId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const rawParam = req.params["organizationId"] ?? req.params["id"];
  const paramOrgId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
  const targetOrgId = (headerOrgId || paramOrgId)?.trim();

  if (!targetOrgId) {
    throw new BadRequestError("Organization ID must be provided via x-organization-id header or path parameter", "MISSING_ORGANIZATION_ID");
  }

  // 2. Query membership in PostgreSQL
  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, targetOrgId),
      eq(organizationMembers.userId, user.id),
    ),
    with: {
      organization: true,
    },
  });

  if (!membership || !membership.organization) {
    throw new ForbiddenError("You do not have access to this organization", "FORBIDDEN");
  }

  if (membership.organization.status !== "active") {
    throw new ForbiddenError("This organization is suspended", "ORGANIZATION_SUSPENDED");
  }

  req.ctx = {
    ...req.ctx,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      businessType: membership.organization.businessType,
      role: membership.role,
    },
  };

  next();
});
