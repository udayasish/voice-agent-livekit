// Adapted from doctors/services/find-doctor-by-name.ts.
import { and, eq } from "drizzle-orm";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { doctorSearchKey } from "../doctor-names.js";

export async function findDoctorsByName(runtime: ClinicRuntime, namePart: string) {
  await runtime.requireClinic();
  const key = doctorSearchKey(namePart);
  if (!key) return [];
  const rows = await runtime.deps.db.select({ id: clinicDoctors.id, name: clinicPeople.name, isActive: clinicDoctors.isActive,
    nameEn: clinicDoctors.nameEn, nameAs: clinicDoctors.nameAs, searchAliases: clinicDoctors.searchAliases, specialization: clinicDoctors.specialization })
    .from(clinicDoctors).innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicPeople.role, "doctor")))
    .orderBy(clinicPeople.name, clinicDoctors.id);
  // Normalize both sides identically, including legacy rows. Scoped catalog sizes
  // are small; no unreviewed transliteration, wildcard interpretation or fuzzy selection.
  return rows.filter(row => [row.name, row.nameEn, row.nameAs, ...row.searchAliases]
    .some(value => value && (doctorSearchKey(value).includes(key) || `${doctorSearchKey(value)}ৰ` === key
      || `${doctorSearchKey(value)}ক` === key))).map(row => ({ ...row, name: row.name ?? "Doctor" }));
}
