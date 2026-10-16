// Adapted from doctors/services/list-active-doctors.ts.
import { and, eq } from "drizzle-orm";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function listActiveDoctors(runtime: ClinicRuntime) {
  await runtime.requireClinic();
  const rows = await runtime.deps.db.select({ id: clinicDoctors.id, name: clinicPeople.name, specialization: clinicDoctors.specialization })
    .from(clinicDoctors).innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicDoctors.isActive, true), eq(clinicPeople.role, "doctor")))
    .orderBy(clinicPeople.name);
  return rows.map((row) => ({ ...row, name: row.name ?? "Doctor" }));
}
