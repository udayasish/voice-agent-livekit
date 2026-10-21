import type { CreateDoctor } from "../contracts/staff.js";
import { clinicError } from "../contracts/errors.js";
import { clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { getStaffDoctor } from "./get-staff-doctor.js";

export async function createStaffDoctor(runtime: ClinicRuntime, input: CreateDoctor) {
  runtime.requireOperator();
  const doctorId = await runtime.deps.transaction(async tx => {
    await runtime.requireClinic(tx, true);
    const [person] = await tx.insert(clinicPeople).values({ organizationId: runtime.identity.organizationId, role: "doctor", phoneNumber: input.phoneNumber, name: input.name })
      .onConflictDoNothing({ target: [clinicPeople.organizationId, clinicPeople.phoneNumber] }).returning();
    if (!person) clinicError("DOCTOR_PHONE_CONFLICT");
    const [doctor] = await tx.insert(clinicDoctors).values({ organizationId: runtime.identity.organizationId, personId: person.id,
      specialization: input.specialization ?? null, consultationDurationMinutes: input.consultationDurationMinutes,
      nameEn: input.nameEn ?? null, nameAs: input.nameAs ?? null, searchAliases: input.searchAliases }).returning();
    if (!doctor) clinicError("CLINIC_OPERATION_FAILED"); return doctor.id;
  });
  return getStaffDoctor(runtime, doctorId);
}
