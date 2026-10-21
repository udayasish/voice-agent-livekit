// Adapted from appointments/services/mark-appointment-status.ts; derive slot and enforce patient scope.
import { and, eq } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import { clinicAppointments, clinicSlots, type ClinicAppointment } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import type { Transaction } from "../../../lib/db/transaction-with-hooks.js";
import { refreshSlot } from "./slot-capacity.js";

/** Shared mutation after the channel adapter has authorized and locked the current appointment/slot. */
export async function cancelLockedAppointment(runtime: ClinicRuntime, tx: Transaction, appointment: ClinicAppointment, slot: typeof clinicSlots.$inferSelect, reason: string) {
  if (appointment.status !== "booked") clinicError("APPOINTMENT_NOT_CANCELLABLE");
  const [updated] = await tx.update(clinicAppointments).set({ status: "cancelled", cancelReason: reason, version: appointment.version + 1, updatedAt: runtime.now() })
    .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.id, appointment.id))).returning();
  if (!updated) clinicError("APPOINTMENT_NOT_FOUND");
  await refreshSlot(tx, runtime, slot);
  return updated;
}

export async function cancelAppointment(runtime: ClinicRuntime, appointmentId: string, reason: string) {
  const patientId = runtime.identity.patientId;
  if (!patientId) clinicError("PATIENT_SCOPE_REQUIRED");
  return runtime.deps.transaction(async (tx) => {
    const clinic = await runtime.requireClinic(tx, true);
    await runtime.requirePatient(patientId, tx);
    const scope = and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.id, appointmentId), eq(clinicAppointments.patientId, patientId));
    const [initial] = await tx.select().from(clinicAppointments).where(scope);
    if (!initial) clinicError("APPOINTMENT_NOT_FOUND");
    await runtime.requireDoctor(initial.doctorId, tx, false);
    await runtime.lockDoctorDate(tx, initial.doctorId, initial.appointmentDate);
    const slotScope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, initial.doctorId), eq(clinicSlots.id, initial.slotId));
    const [slot] = await tx.select().from(clinicSlots).where(slotScope).for("update");
    const [appointment] = await tx.select().from(clinicAppointments).where(scope).for("update");
    if (!appointment || !slot) clinicError("APPOINTMENT_NOT_FOUND");
    if (appointment.slotId !== initial.slotId || appointment.version !== initial.version) clinicError("APPOINTMENT_VERSION_CONFLICT");
    if (runtime.identity.appointmentExpectation && appointment.version !== runtime.identity.appointmentExpectation.version) clinicError("APPOINTMENT_VERSION_CONFLICT");
    const expected = runtime.identity.slotExpectation;
    if (expected && (appointment.appointmentDate !== expected.date || appointment.appointmentTime.slice(0, 5) !== expected.startTime || clinic.timezone !== expected.timezone)) clinicError("APPOINTMENT_VERSION_CONFLICT");
    if (appointment.status === "cancelled") return { appointmentId, status: "cancelled" as const, alreadyCancelled: true };
    await cancelLockedAppointment(runtime, tx, appointment, slot, reason);
    return { appointmentId, status: "cancelled" as const, alreadyCancelled: false };
  });
}
