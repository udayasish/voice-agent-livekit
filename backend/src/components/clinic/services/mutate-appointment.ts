import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppointmentAction } from "../contracts/staff.js";
import type { NotificationOutcomes } from "../contracts/results.js";
import { clinicError } from "../contracts/errors.js";
import { clinicAppointments, clinicBlockedDates, clinicMutationReceipts, clinicRescheduleHistory, clinicSlots } from "../models/index.js";
import { scheduleReminder } from "../notifications/schedule-reminder.js";
import { scheduleBookingAlert } from "../notifications/schedule-booking-alert.js";
import type { ClinicRuntime } from "./runtime.js";
import { allocateToken } from "./token-counter.js";
import { appointmentDto } from "./staff-common.js";
import { bookedCount, refreshSlot } from "./slot-capacity.js";
import { cancelLockedAppointment } from "./cancel-appointment.js";

export async function mutateAppointment(runtime: ClinicRuntime, actorId: string, requestKey: string, appointmentId: string, input: AppointmentAction) {
  runtime.requireOperator();
  return runtime.deps.transaction(async tx => {
    const clinic = await runtime.requireClinic(tx, true);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${runtime.identity.organizationId}:${requestKey}`}))`);
    const fingerprint = createHash("sha256").update(JSON.stringify([appointmentId, input.action, input.expectedVersion, input.reason,
      input.action === "reschedule" ? input.targetSlotId : null])).digest("hex");
    const scope = and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.id, appointmentId));
    const [initial] = await tx.select().from(clinicAppointments).where(scope);
    if (!initial) clinicError("APPOINTMENT_NOT_FOUND");
    const [receipt] = await tx.select().from(clinicMutationReceipts).where(and(eq(clinicMutationReceipts.organizationId, runtime.identity.organizationId), eq(clinicMutationReceipts.requestKey, requestKey)));
    // Booking and mutation keys share the organization's request namespace.
    const [bookingKey] = await tx.select({ id: clinicAppointments.id }).from(clinicAppointments).where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.requestKey, requestKey)));
    if (bookingKey) clinicError("MUTATION_REQUEST_CONFLICT");
    if (receipt && (receipt.fingerprint !== fingerprint || receipt.appointmentId !== appointmentId)) clinicError("MUTATION_REQUEST_CONFLICT");
    await runtime.requireDoctor(initial.doctorId, tx, input.action === "reschedule");
    const targetId = input.action === "reschedule" ? input.targetSlotId : initial.slotId;
    const [targetInitial] = await tx.select().from(clinicSlots).where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.id, targetId)));
    if (!targetInitial) clinicError("SLOT_NOT_FOUND");
    if (targetInitial.doctorId !== initial.doctorId) clinicError("SAME_DOCTOR_REQUIRED");
    for (const date of [...new Set([initial.appointmentDate, targetInitial.slotDate])].sort()) await runtime.lockDoctorDate(tx, initial.doctorId, date);
    const slots = await tx.select().from(clinicSlots).where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId),
      eq(clinicSlots.doctorId, initial.doctorId), inArray(clinicSlots.id, [...new Set([initial.slotId, targetId])]))).orderBy(asc(clinicSlots.id)).for("update");
    const oldSlot = slots.find(s => s.id === initial.slotId); const target = slots.find(s => s.id === targetId);
    if (!oldSlot || !target) clinicError("SLOT_NOT_FOUND");
    const [appointment] = await tx.select().from(clinicAppointments).where(scope).for("update");
    if (!appointment) clinicError("APPOINTMENT_NOT_FOUND");
    if (appointment.slotId !== initial.slotId || appointment.version !== initial.version) clinicError("APPOINTMENT_VERSION_CONFLICT");
    const notifications: NotificationOutcomes = { reminder: "not_repeated", doctorAlert: "not_repeated" };
    if (receipt) {
      if (receipt.resultingVersion !== appointment.version) clinicError("MUTATION_REQUEST_CONFLICT");
      return { ...appointmentDto(appointment, clinic.timezone), replayed: true, notifications };
    }
    if (appointment.version !== input.expectedVersion) clinicError("APPOINTMENT_VERSION_CONFLICT");
    if (appointment.status !== "booked") clinicError(input.action === "cancel" ? "APPOINTMENT_NOT_CANCELLABLE" : "APPOINTMENT_NOT_RESCHEDULABLE");
    const version = appointment.version + 1;
    let updated = appointment;
    if (input.action === "cancel") {
      updated = await cancelLockedAppointment(runtime, tx, appointment, oldSlot, input.reason);
    } else {
      if (target.id === oldSlot.id) clinicError("RESCHEDULE_NO_CHANGE");
      if (runtime.appointmentInstant(appointment.appointmentDate, appointment.appointmentTime, clinic.timezone) <= runtime.now()) clinicError("APPOINTMENT_NOT_RESCHEDULABLE");
      if (target.status !== "available" || runtime.appointmentInstant(target.slotDate, target.startTime, clinic.timezone) <= runtime.now()
        || await bookedCount(tx, runtime.identity.organizationId, target.id) >= target.maxPatients) clinicError("SLOT_UNAVAILABLE");
      const [blocked] = await tx.select({ id: clinicBlockedDates.id }).from(clinicBlockedDates).where(and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId),
        eq(clinicBlockedDates.doctorId, appointment.doctorId), eq(clinicBlockedDates.blockedDate, target.slotDate)));
      if (blocked) clinicError("SLOT_UNAVAILABLE");
      const tokenNumber = target.slotDate === appointment.appointmentDate ? appointment.tokenNumber : await allocateToken(tx, runtime.identity.organizationId, appointment.doctorId, target.slotDate);
      const [result] = await tx.update(clinicAppointments).set({ slotId: target.id, appointmentDate: target.slotDate, appointmentTime: target.startTime,
        tokenNumber, version, reminderSent: false, updatedAt: runtime.now() }).where(scope).returning();
      if (!result) clinicError("CLINIC_OPERATION_FAILED"); updated = result;
      await tx.insert(clinicRescheduleHistory).values({ organizationId: runtime.identity.organizationId, appointmentId, doctorId: appointment.doctorId,
        actorId, reason: input.reason, previousSlotId: oldSlot.id, newSlotId: target.id, previousDate: appointment.appointmentDate, newDate: target.slotDate,
        previousTime: appointment.appointmentTime, newTime: target.startTime, previousToken: appointment.tokenNumber, newToken: tokenNumber, version });
      notifications.reminder = "unconfigured"; notifications.doctorAlert = "unconfigured";
      const current = updated;
      tx.onCommit(async () => {
        const deps = { now: runtime.now, logger: runtime.deps.logger, ...(runtime.deps.scheduler ? { scheduler: runtime.deps.scheduler } : {}) };
        [notifications.reminder, notifications.doctorAlert] = await Promise.all([
          scheduleReminder(current, clinic.timezone, clinic.remindersEnabled, deps), scheduleBookingAlert(current, clinic.notificationsEnabled, deps)]);
      });
    }
    if (input.action === "reschedule") { await refreshSlot(tx, runtime, oldSlot); await refreshSlot(tx, runtime, target); }
    await tx.insert(clinicMutationReceipts).values({ organizationId: runtime.identity.organizationId, appointmentId, actorId,
      operation: input.action, requestKey, fingerprint, resultingVersion: version });
    return { ...appointmentDto(updated, clinic.timezone), replayed: false, notifications };
  });
}
