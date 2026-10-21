import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import env from "../src/lib/env.js";
import { db, pool, transactionWithHooks } from "../src/lib/db/db.js";
import { organizations, organizationMembers, clinicPeople, clinicDoctors, clinicDayOfWeekEnum } from "../src/lib/db/models/index.js";
import { createClinicServices } from "../src/components/clinic/index.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";
import { voiceProfilesSchema, type VoiceProfile } from "../src/components/agent/profiles.js";
import { importDoctorMetadata, doctorMetadataReadiness } from "../src/components/clinic/services/doctor-metadata.js";

// Explicit local-development setup. Unlike setup:clinic:voice, this targets the
// configured application DB so the existing staff login/frontend can use the data.
const output = fileURLToPath(new URL("../config/voice-agents.local.json", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
try {
  const url = new URL(env.DATABASE_URL);
  if (env.NODE_ENV !== "development" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/voice_agent") {
    throw new Error("Development voice setup requires NODE_ENV=development and the local voice_agent database.");
  }
  if (env.VOICE_AGENT_PROFILES_PATH && resolve(env.VOICE_AGENT_PROFILES_PATH) !== resolve(output)) {
    throw new Error("An existing custom profile is configured; refusing to replace it.");
  }
  const candidates = await db.select().from(organizations).where(and(eq(organizations.name, "Brahmaputra Health Clinic"),
    eq(organizations.businessType, "clinic"), eq(organizations.status, "active")));
  if (candidates.length !== 1) throw new Error("Expected exactly one active Brahmaputra Health Clinic; no organization or login will be created.");
  const organization = candidates[0]!;
  if (!(await db.select({ id: organizationMembers.id }).from(organizationMembers).where(eq(organizationMembers.organizationId, organization.id))).length) {
    throw new Error("The clinic needs an existing staff membership.");
  }
  let profiles: VoiceProfile[] = [];
  try { profiles = voiceProfilesSchema.parse(JSON.parse(await readFile(output, "utf8"))); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const additions: VoiceProfile[] = ["default", "agent-clinic-opd-01"].map(agentId => ({
    organizationId: organization.id, agentId, business: "clinic", appointmentsEnabled: true, enabledTools: [...clinicToolNames],
  }));
  for (const addition of additions) {
    const existing = profiles.find(p => p.organizationId === addition.organizationId && p.agentId === addition.agentId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(addition)) throw new Error("An agent profile already has a different policy; refusing to replace it.");
    if (!existing) profiles.push(addition);
  }
  voiceProfilesSchema.parse(profiles);
  // Apply only this repository's existing additive migration history.
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle/migrations", import.meta.url)) });
  const doctors = await db.transaction(async tx => {
    const results: Array<{ id: string; name: string }> = [];
    for (const [phoneNumber, name, specialization] of [
      ["9000000090", "ডাঃ বৰুৱা (Voice Test)", "General Medicine — voice test"],
      ["9000000091", "Dr. Asha Basu (Voice Test)", "General Medicine — voice test"],
    ] as const) {
      const [created] = await tx.insert(clinicPeople).values({ organizationId: organization.id, phoneNumber, name, role: "doctor" })
        .onConflictDoNothing({ target: [clinicPeople.organizationId, clinicPeople.phoneNumber] }).returning();
      const person = created ?? (await tx.select().from(clinicPeople).where(and(eq(clinicPeople.organizationId, organization.id), eq(clinicPeople.phoneNumber, phoneNumber))))[0];
      if (!person || person.role !== "doctor" || person.name !== name) throw new Error("Synthetic doctor phone conflicts with another contact; no record was overwritten.");
      const [inserted] = await tx.insert(clinicDoctors).values({ organizationId: organization.id, personId: person.id, specialization })
        .onConflictDoNothing({ target: clinicDoctors.personId }).returning();
      const doctor = inserted ?? (await tx.select().from(clinicDoctors).where(and(eq(clinicDoctors.organizationId, organization.id), eq(clinicDoctors.personId, person.id))))[0];
      if (!doctor?.isActive) throw new Error("Synthetic doctor is inactive; refusing to change its status.");
      results.push({ id: doctor.id, name });
    }
    return results;
  });
  const services = createClinicServices({ organizationId: organization.id, source: "manual" }, { db, transaction: transactionWithHooks, logger });
  await importDoctorMetadata({ organizationId: organization.id, doctors: doctors.map((doctor, index) => ({ doctorId: doctor.id,
    nameEn: index === 0 ? "Dr. Baruah (Voice Test)" : "Dr. Asha Basu (Voice Test)", nameAs: index === 0 ? "ডাঃ বৰুৱা (Voice Test)" : null,
    searchAliases: index === 0 ? ["Baruah", "Boruah", "বৰুৱা"] : ["Asha Basu", "আশা বসু"],
  })) }, { db, transaction: transactionWithHooks, logger }, false);
  console.log(JSON.stringify({ doctorReferenceData: await doctorMetadataReadiness(organization.id, { db, transaction: transactionWithHooks, logger }) }));
  const availability: Array<{ name: string; newlyCreatedSlots: number; availableDates: string[]; firstTimes: string[] }> = [];
  for (const doctor of doctors) {
    const generated = await services.generateSlots({ doctorId: doctor.id, weekdays: [...clinicDayOfWeekEnum.enumValues],
      startTime: "09:00", endTime: "12:00", durationMinutes: 15, horizonDays: 14, maxPatients: 5 });
    if (!generated.success) throw new Error(generated.error.code);
    const dates = await services.listAvailableDates({ doctorId: doctor.id, maxDates: 14 });
    if (!dates.success || !dates.data.length) throw new Error("No future dates were generated.");
    const times = await services.listAvailableSlots({ doctorId: doctor.id, date: dates.data[0]! });
    if (!times.success || !times.data.length) throw new Error("No future times were generated.");
    availability.push({ name: doctor.name, newlyCreatedSlots: generated.data.createdCount, availableDates: dates.data, firstTimes: times.data.map(slot => slot.startTime) });
  }
  await writeFile(output, JSON.stringify(profiles, null, 2) + "\n", "utf8");
  const content = await readFile(envPath, "utf8");
  const entry = `VOICE_AGENT_PROFILES_PATH=${JSON.stringify(output.replaceAll("\\", "/"))}`;
  await writeFile(envPath, /^VOICE_AGENT_PROFILES_PATH\s*=/m.test(content)
    ? content.replace(/^VOICE_AGENT_PROFILES_PATH\s*=.*$/m, entry)
    : `${content.trimEnd()}\n\n# Local frontend voice-booking test profile\n${entry}\n`, "utf8");
  console.log(JSON.stringify({ database: url.pathname.slice(1), clinic: organization.name, timezone: organization.timezone,
    doctors: availability, profileFile: output, agentIds: additions.map(p => p.agentId), capacityPerSlot: 5,
    appointmentsCreated: 0, messagesSent: 0, frontend: "http://localhost:3000/agents/default/testing",
    next: "Restart the API and voice worker to load the profile; the existing staff login and database are retained." }, null, 2));
} finally { await pool.end(); }
