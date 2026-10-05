import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./db.js";
import { users } from "./models/users.js";
import { organizations, organizationMembers } from "./models/organizations.js";
import { hashPassword } from "../password.js";
import logger from "../logger.js";

export async function seedDatabase() {
  logger.info("🌱 Seeding database...");

  // 1. Create or get primary organization: Brahmaputra Health Clinic
  let org = await db.query.organizations.findFirst({
    where: eq(organizations.name, "Brahmaputra Health Clinic"),
  });

  if (!org) {
    const [inserted] = await db
      .insert(organizations)
      .values({
        name: "Brahmaputra Health Clinic",
        businessType: "clinic",
        status: "active",
        timezone: "Asia/Kolkata",
      })
      .returning();
    org = inserted!;
    logger.info(`Created organization: ${org.name} (${org.id})`);
  } else {
    logger.info(`Found existing organization: ${org.name} (${org.id})`);
  }

  // 2. Create or get secondary organization: Guwahati Dental Clinic (for unauthorized access tests)
  let secondaryOrg = await db.query.organizations.findFirst({
    where: eq(organizations.name, "Guwahati Dental Clinic"),
  });

  if (!secondaryOrg) {
    const [inserted] = await db
      .insert(organizations)
      .values({
        name: "Guwahati Dental Clinic",
        businessType: "clinic",
        status: "active",
        timezone: "Asia/Kolkata",
      })
      .returning();
    secondaryOrg = inserted!;
    logger.info(`Created secondary organization: ${secondaryOrg.name} (${secondaryOrg.id})`);
  }

  // 3. Create or update primary admin user
  const adminEmail = "admin@brahmaputrahealth.com";
  const passwordHash = await hashPassword("Password123!");

  let adminUser = await db.query.users.findFirst({
    where: eq(users.email, adminEmail),
  });

  if (!adminUser) {
    const [inserted] = await db
      .insert(users)
      .values({
        name: "Dr. Hemanta Barman",
        email: adminEmail,
        passwordHash,
        status: "active",
      })
      .returning();
    adminUser = inserted!;
    logger.info(`Created admin user: ${adminUser.email} (${adminUser.id})`);
  } else {
    await db
      .update(users)
      .set({ passwordHash, status: "active" })
      .where(eq(users.id, adminUser.id));
    logger.info(`Updated existing admin user: ${adminUser.email}`);
  }

  // 4. Link admin user to Brahmaputra Health Clinic as owner
  const membership = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, org.id),
      eq(organizationMembers.userId, adminUser.id),
    ),
  });

  if (!membership) {
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: adminUser.id,
      role: "owner",
    });
    logger.info(`Linked ${adminUser.email} to ${org.name} as owner`);
  }

  logger.info("✅ Database seeded successfully!");
}

if (process.argv[1]?.includes("seed")) {
  seedDatabase()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error("Failed to seed database:", err);
      await pool.end();
      process.exit(1);
    });
}
