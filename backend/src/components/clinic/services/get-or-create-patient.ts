// Adapted from booking/services/get-or-create-patient.ts; no caller-supplied ORM row is trusted.
import { and, eq } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import { clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function getOrCreatePatient(runtime: ClinicRuntime, phoneNumber: string) {
  return runtime.deps.transaction(async (tx) => {
    await runtime.requireClinic(tx, true);
    if (runtime.identity.patientId) {
      const patient = await runtime.requirePatient(runtime.identity.patientId, tx);
      if (patient.phoneNumber !== phoneNumber) clinicError("CLINIC_ACCESS_DENIED");
      return { id: patient.id, phoneNumber: patient.phoneNumber, role: "patient" as const };
    }
    const [created] = await tx.insert(clinicPeople).values({ organizationId: runtime.identity.organizationId, phoneNumber, role: "patient" })
      .onConflictDoNothing({ target: [clinicPeople.organizationId, clinicPeople.phoneNumber] }).returning();
    const patient = created ?? (await tx.select().from(clinicPeople)
      .where(and(eq(clinicPeople.organizationId, runtime.identity.organizationId), eq(clinicPeople.phoneNumber, phoneNumber))))[0];
    if (!patient) clinicError("PATIENT_NOT_FOUND");
    if (patient.role !== "patient") clinicError("PATIENT_ROLE_CONFLICT");
    return { id: patient.id, phoneNumber: patient.phoneNumber, role: "patient" as const };
  });
}
