import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/db.js";
import { organizationMembers } from "../../../lib/db/models/organizations.js";

export async function getUserOrganizations(userId: string) {
  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
    with: {
      organization: true,
    },
  });

  return memberships
    .filter((m) => m.organization && m.organization.status === "active")
    .map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      businessType: m.organization.businessType,
      status: m.organization.status,
      timezone: m.organization.timezone,
      role: m.role,
      joinedAt: m.createdAt,
    }));
}
