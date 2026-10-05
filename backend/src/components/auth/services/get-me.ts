import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/db.js";
import { users } from "../../../lib/db/models/users.js";
import { organizationMembers } from "../../../lib/db/models/organizations.js";
import { NotFoundError } from "../../../lib/errors.js";

export async function getMe(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new NotFoundError("User not found", "USER_NOT_FOUND");
  }

  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
    with: {
      organization: true,
    },
  });

  const orgs = memberships
    .filter((m) => m.organization && m.organization.status === "active")
    .map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      businessType: m.organization.businessType,
      role: m.role,
    }));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
    },
    organizations: orgs,
  };
}
