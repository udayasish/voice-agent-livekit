// Adapted from appointments/services/create-appointment.ts. Preserve advisory -> slot row locking.
import { and, eq, sql } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import type { BookingInput } from "../contracts/inputs.js";
import type { AppointmentSummary, NotificationOutcomes } from "../contracts/results.js";
import { clinicAppointments, clinicBlockedDates, clinicSlots } from "../models/index.js";
import { scheduleReminder } from "../notifications/schedule-reminder.js";
import { scheduleBookingAlert } from "../notifications/schedule-booking-alert.js";
import type { ClinicRuntime } from "./runtime.js";

export async function createAppointmentFromBooking(runtime: ClinicRuntime, input: BookingInput): Promise<AppointmentSummary> {
  return runtime.deps.transaction(async (tx) => {
    const clinic = await runtime.requireClinic(tx, true);
    await runtime.requireDoctor(input.doctorId, tx);
    await runtime.requirePatient(input.patientId, tx);
    const scope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, input.doctorId), eq(clinicSlots.id, input.slotId));
    const [initial] = await tx.select().from(clinicSlots).where(scope);
    if (!initial) clinicError("SLOT_UNAVAILABLE");
    await runtime.lockDoctorDate(tx, input.doctorId, initial.slotDate);
    const [slot] = await tx.select().from(clinicSlots).where(scope).for("update");
    if (!slot || slot.slotDate !== initial.slotDate || slot.status !== "available") clinicError("SLOT_UNAVAILABLE");
    if (runtime.appointmentInstant(slot.slotDate, slot.startTime, clinic.timezone).getTime() <= runtime.now().getTime()) clinicError("SLOT_UNAVAILABLE");
    const [blocked] = await tx.select({ id: clinicBlockedDates.id }).from(clinicBlockedDates)
      .where(and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId), eq(clinicBlockedDates.doctorId, input.doctorId), eq(clinicBlockedDates.blockedDate, slot.slotDate)));
    if (blocked) clinicError("SLOT_UNAVAILABLE");

    const [count] = await tx.select({ activeCount: sql<number>`count(*)::int` }).from(clinicAppointments)
      .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.slotId, slot.id), eq(clinicAppointments.status, "booked")));
    const currentBooked = Number(count?.activeCount ?? 0);
    if (currentBooked >= slot.maxPatients) clinicError("SLOT_UNAVAILABLE");

    const [maximum] = await tx.select({ maxToken: sql<number>`coalesce(max(${clinicAppointments.tokenNumber}), 0)` }).from(clinicAppointments)
      .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.doctorId, input.doctorId), eq(clinicAppointments.appointmentDate, slot.slotDate)));
    const tokenNumber = Number(maximum?.maxToken ?? 0) + 1;
    if (currentBooked + 1 >= slot.maxPatients) await tx.update(clinicSlots).set({ status: "booked", updatedAt: runtime.now() }).where(scope);
    const [appointment] = await tx.insert(clinicAppointments).values({
      organizationId: runtime.identity.organizationId, doctorId: input.doctorId, patientId: input.patientId, slotId: slot.id,
      tokenNumber, appointmentDate: slot.slotDate, appointmentTime: slot.startTime,
      patientName: input.patientName, patientAge: input.patientAge, complaint: input.complaint ?? null,
      source: runtime.identity.source, callId: runtime.identity.callId ?? null,
    }).returning();
    if (!appointment) clinicError("CLINIC_OPERATION_FAILED");

    const notifications: NotificationOutcomes = { reminder: "unconfigured", doctorAlert: "unconfigured" };
    tx.onCommit(async () => {
      const deps = { now: runtime.now, logger: runtime.deps.logger, ...(runtime.deps.scheduler ? { scheduler: runtime.deps.scheduler } : {}) };
      try {
        [notifications.reminder, notifications.doctorAlert] = await Promise.all([
          scheduleReminder(appointment, clinic.timezone, clinic.remindersEnabled, deps),
          scheduleBookingAlert(appointment, clinic.notificationsEnabled, deps),
        ]);
      } catch {
        notifications.reminder = "failed";
        notifications.doctorAlert = "failed";
        runtime.deps.logger.error("Clinic post-commit scheduling failed", { organizationId: runtime.identity.organizationId, appointmentId: appointment.id, errorCode: "NOTIFICATION_SCHEDULING_FAILED" });
      }
    });
    return { appointmentId: appointment.id, doctorId: appointment.doctorId, patientId: appointment.patientId, slotId: appointment.slotId,
      tokenNumber, appointmentDate: appointment.appointmentDate, appointmentTime: appointment.appointmentTime, timezone: clinic.timezone, status: "booked", notifications };
  });
}
