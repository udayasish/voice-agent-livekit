// Adapted from doctors/services/find-doctor-by-name.ts.
import { and, eq, ilike } from "drizzle-orm";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function findDoctorsByName(runtime: ClinicRuntime, namePart: string) {
  await runtime.requireClinic();
  // Escape LIKE wildcards: search the supplied name, rather than advertising all doctors.
  const escaped = namePart.replace(/[\\%_]/g, (value) => `\\${value}`);
  const rows = await runtime.deps.db.select({ id: clinicDoctors.id, name: clinicPeople.name, isActive: clinicDoctors.isActive })
    .from(clinicDoctors).innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicPeople.role, "doctor"), ilike(clinicPeople.name, `%${escaped}%`)))
    .orderBy(clinicPeople.name);
  return rows.map((row) => ({ ...row, name: row.name ?? "Doctor" }));
}
