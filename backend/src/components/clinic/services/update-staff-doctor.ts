import { and, eq } from "drizzle-orm";
import type { UpdateDoctor } from "../contracts/staff.js";
import { clinicError } from "../contracts/errors.js";
import { clinicAppointments, clinicDoctors, clinicPeople } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { getStaffDoctor } from "./get-staff-doctor.js";

export async function updateStaffDoctor(runtime: ClinicRuntime, doctorId: string, input: UpdateDoctor) {
  runtime.requireOperator();
  await runtime.deps.transaction(async tx => {
    const clinic = await runtime.requireClinic(tx, true);
    const scope = and(eq(clinicDoctors.organizationId, runtime.identity.organizationId), eq(clinicDoctors.id, doctorId));
    const [doctor] = await tx.select().from(clinicDoctors).where(scope).for("update");
    if (!doctor) clinicError("DOCTOR_NOT_FOUND");
    if (input.isActive === false) {
      const appointments = await tx.select().from(clinicAppointments).where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.doctorId, doctorId), eq(clinicAppointments.status, "booked")));
      if (appointments.some(a => runtime.appointmentInstant(a.appointmentDate, a.appointmentTime, clinic.timezone) > runtime.now())) clinicError("DOCTOR_HAS_BOOKINGS");
    }
    const personScope = and(eq(clinicPeople.organizationId, runtime.identity.organizationId), eq(clinicPeople.id, doctor.personId), eq(clinicPeople.role, "doctor"));
    if (input.phoneNumber !== undefined) {
      // Serialize competing phone changes/creations via the unique index; on conflict roll back the entire profile edit.
      const [duplicate] = await tx.select({ id: clinicPeople.id }).from(clinicPeople).where(and(eq(clinicPeople.organizationId, runtime.identity.organizationId), eq(clinicPeople.phoneNumber, input.phoneNumber)));
      if (duplicate && duplicate.id !== doctor.personId) clinicError("DOCTOR_PHONE_CONFLICT");
    }
    try {
      if (input.name !== undefined || input.phoneNumber !== undefined) await tx.update(clinicPeople).set({ ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}), updatedAt: runtime.now() }).where(personScope);
    } catch (error) {
      const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") clinicError("DOCTOR_PHONE_CONFLICT");
      throw error;
    }
    const { name: _name, phoneNumber: _phone, ...profile } = input;
    await tx.update(clinicDoctors).set({ ...profile, updatedAt: runtime.now() }).where(scope);
  });
  return getStaffDoctor(runtime, doctorId);
}
