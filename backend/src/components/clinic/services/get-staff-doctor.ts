import { and, eq } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function getStaffDoctor(runtime: ClinicRuntime, doctorId: string) {
  await runtime.requireClinic(); await runtime.requireDoctor(doctorId, runtime.deps.db, false);
  const [row] = await runtime.deps.db.select({ doctor: clinicDoctors, person: clinicPeople }).from(clinicDoctors)
    .innerJoin(clinicPeople, and(eq(clinicPeople.id, clinicDoctors.personId), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicDoctors.id, doctorId)));
  if (!row) clinicError("DOCTOR_NOT_FOUND");
  const { doctor: d, person: p } = row;
  return { id: d.id, personId: p.id, name: p.name ?? "", phoneNumber: p.phoneNumber, specialization: d.specialization,
    consultationDurationMinutes: d.consultationDurationMinutes, isActive: d.isActive, nameEn: d.nameEn, nameAs: d.nameAs, searchAliases: d.searchAliases };
}
