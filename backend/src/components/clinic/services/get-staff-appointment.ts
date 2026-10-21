import { and, asc, eq, lte } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import { clinicAppointments, clinicRescheduleHistory } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { appointmentDto } from "./staff-common.js";

export async function getStaffAppointment(runtime: ClinicRuntime, appointmentId: string) {
  const clinic = await runtime.requireClinic();
  const [a] = await runtime.deps.db.select().from(clinicAppointments).where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.id, appointmentId)));
  if (!a) clinicError("APPOINTMENT_NOT_FOUND");
  const rows = await runtime.deps.db.select().from(clinicRescheduleHistory).where(and(eq(clinicRescheduleHistory.organizationId, runtime.identity.organizationId), eq(clinicRescheduleHistory.appointmentId, appointmentId), lte(clinicRescheduleHistory.version, a.version)))
    .orderBy(asc(clinicRescheduleHistory.version), asc(clinicRescheduleHistory.id));
  return { ...appointmentDto(a, clinic.timezone), history: rows.map(h => ({ id: h.id, actorId: h.actorId, previousSlotId: h.previousSlotId, newSlotId: h.newSlotId,
    previousDate: h.previousDate, newDate: h.newDate, previousTime: h.previousTime.slice(0, 5), newTime: h.newTime.slice(0, 5),
    previousToken: h.previousToken, newToken: h.newToken, version: h.version, reason: h.reason, createdAt: h.createdAt.toISOString() })) };
}
