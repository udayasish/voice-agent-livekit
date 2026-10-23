import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/lib/db/models/index.js";
import { createTransactionWithHooks, type Database } from "../src/lib/db/transaction-with-hooks.js";
import { createClinicServices, type ClinicIdentity, type ClinicDependencies } from "../src/components/clinic/index.js";
import type { ClinicLogger } from "../src/components/clinic/notifications/types.js";
import { clinicDayOfWeekEnum } from "../src/components/clinic/models/enums.js";

export const testLogger: ClinicLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export async function openClinicTestDatabase(options: { migrationsFolder?: string } = {}) {
  const configured = process.env["CLINIC_TEST_DATABASE_URL"];
  const url = new URL(configured ?? process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:5433/voice_agent");
  if (!configured) url.pathname = "/voice_agent_clinic_test";
  // Test schema/data must never be created in a production/source/main voice database.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^\/voice_agent_clinic_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error("Clinic tests require a local database named voice_agent_clinic_test (optional underscore suffix).");
  }
  const name = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  try {
    const exists = await admin.query<{ exists: number }>("select 1 as exists from pg_database where datname = $1", [name]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name}"`); // Identifier is constrained above; PostgreSQL cannot parameterize CREATE DATABASE.
  } finally { await admin.end(); }
  const pool = new pg.Pool({ connectionString: url.toString(), max: 16, connectionTimeoutMillis: 5000 });
  const db = drizzle(pool, { schema });
  try { await migrate(db, { migrationsFolder: options.migrationsFolder ?? fileURLToPath(new URL("../drizzle/migrations", import.meta.url)) }); }
  catch (error) { await pool.end(); throw error; }
  return { pool, db, url: url.toString(), name };
}

export async function createClinicFixture(db: Database, options: { timezone?: string; now?: string } = {}) {
  const [organization] = await db.insert(schema.organizations).values({ name: `Synthetic Clinic ${randomUUID()}`, businessType: "clinic", timezone: options.timezone ?? "Asia/Kolkata" }).returning();
  if (!organization) throw new Error("Fixture organization missing");
  await db.insert(schema.clinicSettings).values({ organizationId: organization.id });
  const [person] = await db.insert(schema.clinicPeople).values({ organizationId: organization.id, role: "doctor", phoneNumber: "9000000001", name: "Asha Basu" }).returning();
  if (!person) throw new Error("Fixture doctor contact missing");
  const [doctor] = await db.insert(schema.clinicDoctors).values({ organizationId: organization.id, personId: person.id, specialization: "General Medicine" }).returning();
  if (!doctor) throw new Error("Fixture doctor missing");
  let instant = new Date(options.now ?? "2026-10-13T00:00:00Z");
  const now = () => new Date(instant);
  const deps: ClinicDependencies = { db, transaction: createTransactionWithHooks(db, testLogger), logger: testLogger, now };
  const services = (overrides: Partial<Omit<ClinicIdentity, "organizationId">> = {}, extra: Partial<ClinicDependencies> = {}) =>
    createClinicServices({ organizationId: organization.id, source: "manual", ...overrides }, { ...deps, ...extra });
  return { organization, person, doctor, deps, services, now, setNow: (value: string) => { instant = new Date(value); } };
}
export type ClinicFixture = Awaited<ReturnType<typeof createClinicFixture>>;

export async function insertFixtureSlot(db: Database, fixture: ClinicFixture, options: Partial<typeof schema.clinicSlots.$inferInsert> = {}) {
  const slotDate = options.slotDate ?? "2026-10-15";
  const values = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const [slot] = await db.insert(schema.clinicSlots).values({ organizationId: fixture.organization.id, doctorId: fixture.doctor.id,
    slotDate, dayOfWeek: values[new Date(`${slotDate}T00:00:00Z`).getUTCDay()]!, startTime: "09:00", endTime: "09:15", ...options }).returning();
  if (!slot) throw new Error("Fixture slot missing");
  return slot;
}

export async function removeClinicFixtures(db: Database, organizationIds: string[]) {
  if (!organizationIds.length) return;
  await db.transaction(async (tx) => {
    await tx.delete(schema.agents).where(inArray(schema.agents.organizationId, organizationIds));
    await tx.delete(schema.clinicRescheduleHistory).where(inArray(schema.clinicRescheduleHistory.organizationId, organizationIds));
    await tx.delete(schema.clinicMutationReceipts).where(inArray(schema.clinicMutationReceipts.organizationId, organizationIds));
    await tx.delete(schema.clinicTokenCounters).where(inArray(schema.clinicTokenCounters.organizationId, organizationIds));
    await tx.delete(schema.clinicAppointments).where(inArray(schema.clinicAppointments.organizationId, organizationIds));
    await tx.delete(schema.clinicBlockedDates).where(inArray(schema.clinicBlockedDates.organizationId, organizationIds));
    await tx.delete(schema.clinicSlots).where(inArray(schema.clinicSlots.organizationId, organizationIds));
    await tx.delete(schema.clinicDoctors).where(inArray(schema.clinicDoctors.organizationId, organizationIds));
    await tx.delete(schema.clinicPeople).where(inArray(schema.clinicPeople.organizationId, organizationIds));
    await tx.delete(schema.clinicSettings).where(inArray(schema.clinicSettings.organizationId, organizationIds));
    await tx.delete(schema.organizations).where(inArray(schema.organizations.id, organizationIds));
  });
}

export { schema, and, eq, clinicDayOfWeekEnum };
