import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openClinicTestDatabase, removeClinicFixtures, schema, eq, testLogger } from "./clinic-test-db.js";
import { createClinicServices } from "../src/components/clinic/index.js";
import { createTransactionWithHooks } from "../src/lib/db/transaction-with-hooks.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";

// This deliberately targets only the existing guarded test DB, never the application's DB.
const database = await openClinicTestDatabase();
const output = fileURLToPath(new URL("../config/voice-agents.sandbox.json", import.meta.url));
let reserved = false;
let createdOrganizationId: string | undefined;
try {
  process.env["DATABASE_URL"] = database.url;
  const { seedDatabase } = await import("../src/lib/db/seed.js");
  const { pool } = await import("../src/lib/db/db.js");
  try { await seedDatabase(); } finally { await pool.end(); }
  const [admin] = await database.db.select().from(schema.users).where(eq(schema.users.email, "admin@brahmaputrahealth.com"));
  if (!admin) throw new Error("Synthetic staff fixture missing");
  // Reserve the output before creating fixtures; never overwrite an existing profile.
  const { open } = await import("node:fs/promises");
  const handle = await open(output, "wx");
  reserved = true;
  await handle.close();
  const [organization] = await database.db.insert(schema.organizations).values({ name: `Voice Sandbox Synthetic ${randomUUID()}`, businessType: "clinic", timezone: "Asia/Kolkata" }).returning();
  if (!organization) throw new Error("Synthetic clinic creation failed");
  createdOrganizationId = organization.id;
  await database.db.insert(schema.organizationMembers).values({ organizationId: organization.id, userId: admin.id, role: "owner" });
  const services = createClinicServices({ organizationId: organization.id, source: "manual" }, {
    db: database.db, transaction: createTransactionWithHooks(database.db, testLogger), logger: testLogger,
  });
  for (const [index, name] of ["ডাঃ বৰুৱা (Synthetic)", "Dr. Asha Basu (Synthetic)"].entries()) {
    const [person] = await database.db.insert(schema.clinicPeople).values({ organizationId: organization.id,
      phoneNumber: `900000009${index}`, role: "doctor", name }).returning();
    const [doctor] = await database.db.insert(schema.clinicDoctors).values({ organizationId: organization.id, personId: person!.id, specialization: "Synthetic test doctor",
      nameEn: index === 0 ? "Dr. Baruah (Synthetic)" : "Dr. Asha Basu (Synthetic)", nameAs: index === 0 ? name : null,
      searchAliases: index === 0 ? ["Baruah", "Boruah", "বৰুৱা"] : ["Asha Basu", "আশা বসু"] }).returning();
    const generated = await services.generateSlots({ doctorId: doctor!.id, weekdays: [...schema.clinicDayOfWeekEnum.enumValues], startTime: "09:00", endTime: "10:00", durationMinutes: 15, horizonDays: 7, maxPatients: 1 });
    if (!generated.success) throw new Error(generated.error.code);
  }
  await writeFile(output, JSON.stringify([{ organizationId: organization.id, agentId: "default", business: "clinic", appointmentsEnabled: true, enabledTools: clinicToolNames }], null, 2) + "\n");
  console.log(JSON.stringify({ database: database.name, organizationId: organization.id, organizationName: organization.name,
    profileFile: output, deliveredMessages: 0, next: "Point API and worker DATABASE_URL to this test database; set VOICE_AGENT_PROFILES_PATH to the profile file. Restart both, then choose the synthetic clinic in the dashboard." }, null, 2));
} catch (error) {
  if (createdOrganizationId) {
    await database.db.delete(schema.organizationMembers).where(eq(schema.organizationMembers.organizationId, createdOrganizationId));
    await removeClinicFixtures(database.db, [createdOrganizationId]);
  }
  if (reserved) await unlink(output);
  throw error;
} finally { await database.pool.end(); }
