import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openClinicTestDatabase, createClinicFixture, insertFixtureSlot, removeClinicFixtures, schema, eq } from "./clinic-test-db.js";

test("populated pre-Phase16 database backfills cancelled tokens and appointment versions without altering records", async () => {
  const source = fileURLToPath(new URL("../drizzle/migrations/", import.meta.url));
  const temp = await mkdtemp(path.join(tmpdir(), "clinic-migration-"));
  let database: Awaited<ReturnType<typeof openClinicTestDatabase>> | undefined;
  let organizationId: string | undefined;
  const original = process.env["CLINIC_TEST_DATABASE_URL"];
  try {
    const journal = JSON.parse(await readFile(path.join(source, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    const entries = journal.entries.filter(e => e.idx < 4);
    await mkdir(path.join(temp, "meta")); await writeFile(path.join(temp, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(path.join(source, `${e.tag}.sql`), path.join(temp, `${e.tag}.sql`));
    const url = new URL(original ?? process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres");
    url.pathname = `/voice_agent_clinic_test_migration_${randomUUID().replaceAll("-", "")}`;
    process.env["CLINIC_TEST_DATABASE_URL"] = url.toString();
    database = await openClinicTestDatabase({ migrationsFolder: temp });
    const f = await createClinicFixture(database.db); organizationId = f.organization.id;
    const p = await database.db.insert(schema.clinicPeople).values({ organizationId, role: "patient", phoneNumber: "7000000001" }).returning();
    const slot = await insertFixtureSlot(database.db, f);
    // Parameterized old-schema insert deliberately omits the new version column.
    for (const [token, status] of [[4, "booked"], [9, "cancelled"]] as const) await database.pool.query(
      "INSERT INTO clinic_appointments (organization_id,doctor_id,patient_id,slot_id,token_number,appointment_date,appointment_time,patient_name,patient_age,status,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [organizationId, f.doctor.id, p[0]!.id, slot.id, token, slot.slotDate, slot.startTime, "Synthetic migration patient", 27, status, "manual"]);
    await migrate(database.db, { migrationsFolder: source });
    await migrate(database.db, { migrationsFolder: source }); // Re-running migration is harmless.
    const rows = await database.db.select().from(schema.clinicAppointments).where(eq(schema.clinicAppointments.organizationId, organizationId));
    assert.equal(rows.length, 2); assert.ok(rows.every(a => a.version === 1));
    const [counter] = await database.db.select().from(schema.clinicTokenCounters).where(eq(schema.clinicTokenCounters.organizationId, organizationId)); assert.equal(counter?.lastToken, 9);
    const result = await f.services().createAppointmentFromBooking({ doctorId: f.doctor.id, patientId: p[0]!.id, slotId: slot.id, patientName: "Synthetic migration patient", patientAge: 27 });
    if (!result.success) assert.fail(result.error.code); assert.equal(result.data.tokenNumber, 10);
  } finally {
    if (original === undefined) delete process.env["CLINIC_TEST_DATABASE_URL"]; else process.env["CLINIC_TEST_DATABASE_URL"] = original;
    if (database) { try { if (organizationId) await removeClinicFixtures(database.db, [organizationId]); } finally { await database.pool.end(); } }
    if (path.dirname(path.resolve(temp)) !== path.resolve(tmpdir()) || !path.basename(temp).startsWith("clinic-migration-")) throw new Error("Unexpected migration temp path");
    await rm(temp, { recursive: true, force: true });
  }
});
