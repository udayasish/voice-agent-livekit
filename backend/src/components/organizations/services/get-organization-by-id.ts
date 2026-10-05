import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db/db.js";
import { organizationMembers } from "../../../lib/db/models/organizations.js";
import { ForbiddenError, NotFoundError } from "../../../lib/errors.js";

export async function getOrganizationById(organizationId: string, userId: string) {
  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
    ),
    with: {
      organization: true,
    },
  });

  if (!membership || !membership.organization) {
    throw new ForbiddenError("You do not have access to this organization", "FORBIDDEN");
  }

  return {
    id: membership.organization.id,
    name: membership.organization.name,
    businessType: membership.organization.businessType,
    status: membership.organization.status,
    timezone: membership.organization.timezone,
    role: membership.role,
    createdAt: membership.organization.createdAt,
    updatedAt: membership.organization.updatedAt,
  };
}
