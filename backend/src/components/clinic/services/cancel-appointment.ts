// Adapted from appointments/services/mark-appointment-status.ts; derive slot and enforce patient scope.
import { and, eq, sql } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import { clinicAppointments, clinicSlots } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function cancelAppointment(runtime: ClinicRuntime, appointmentId: string, reason: string) {
  const patientId = runtime.identity.patientId;
  if (!patientId) clinicError("PATIENT_SCOPE_REQUIRED");
  return runtime.deps.transaction(async (tx) => {
    await runtime.requireClinic(tx, true);
    await runtime.requirePatient(patientId, tx);
    const scope = and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.id, appointmentId), eq(clinicAppointments.patientId, patientId));
    const [initial] = await tx.select().from(clinicAppointments).where(scope);
    if (!initial) clinicError("APPOINTMENT_NOT_FOUND");
    await runtime.lockDoctorDate(tx, initial.doctorId, initial.appointmentDate);
    const slotScope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, initial.doctorId), eq(clinicSlots.id, initial.slotId));
    const [slot] = await tx.select().from(clinicSlots).where(slotScope).for("update");
    const [appointment] = await tx.select().from(clinicAppointments).where(scope).for("update");
    if (!appointment || !slot) clinicError("APPOINTMENT_NOT_FOUND");
    if (appointment.status === "cancelled") return { appointmentId, status: "cancelled" as const, alreadyCancelled: true };
    if (appointment.status !== "booked") clinicError("APPOINTMENT_NOT_CANCELLABLE");
    await tx.update(clinicAppointments).set({ status: "cancelled", cancelReason: reason, updatedAt: runtime.now() }).where(scope);
    if (slot.status === "available" || slot.status === "booked") {
      const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(clinicAppointments)
        .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.slotId, slot.id), eq(clinicAppointments.status, "booked")));
      await tx.update(clinicSlots).set({ status: Number(count?.count ?? 0) < slot.maxPatients ? "available" : "booked", updatedAt: runtime.now() }).where(slotScope);
    }
    return { appointmentId, status: "cancelled" as const, alreadyCancelled: false };
  });
}
