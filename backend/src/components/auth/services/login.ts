import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/db.js";
import { users } from "../../../lib/db/models/users.js";
import { organizationMembers } from "../../../lib/db/models/organizations.js";
import { verifyPassword } from "../../../lib/password.js";
import { signAccessToken, signRefreshToken, storeRefreshToken } from "../../../lib/jwt.js";
import { UnauthorizedError } from "../../../lib/errors.js";
import type { LoginInput } from "../schema.js";

export async function login(input: LoginInput) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!user || !user.passwordHash) {
    throw new UnauthorizedError("Invalid email or password", "UNAUTHORIZED");
  }

  const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password", "UNAUTHORIZED");
  }

  if (user.status !== "active") {
    throw new UnauthorizedError("User account is suspended", "USER_SUSPENDED");
  }

  // Generate tokens
  const jti = crypto.randomUUID();
  const accessToken = await signAccessToken({ id: user.id, email: user.email });
  const refreshToken = await signRefreshToken({ id: user.id, jti });

  // Store refresh token in Redis
  await storeRefreshToken(user.id, jti);

  // Fetch organizations user belongs to
  const memberships = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, user.id),
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
    currentOrganization: orgs[0] ?? null,
    accessToken,
    refreshToken,
  };
}
