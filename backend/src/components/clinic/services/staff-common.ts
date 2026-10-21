import type { ClinicAppointment } from "../models/index.js";
import { addCalendarDays, clinicLocalDate } from "../timezone.js";
import type { RangeList } from "../contracts/staff.js";
import { clinicError } from "../contracts/errors.js";
import type { ClinicRuntime } from "./runtime.js";

export function page<T>(items: T[], total: number, input: { page: number; pageSize: number }) {
  return { items, pagination: { ...input, total, totalPages: Math.ceil(total / input.pageSize) } };
}
export async function dateRange(runtime: ClinicRuntime, input: Pick<RangeList, "from" | "to">) {
  const clinic = await runtime.requireClinic();
  const from = input.from ?? clinicLocalDate(runtime.now(), clinic.timezone);
  const to = input.to ?? addCalendarDays(from, 29);
  if (to < from || to > addCalendarDays(from, 89)) clinicError("INVALID_CLINIC_INPUT");
  return { from, to, clinic };
}
export function appointmentDto(a: ClinicAppointment, timezone: string) {
  return { appointmentId: a.id, doctorId: a.doctorId, patientId: a.patientId, slotId: a.slotId, tokenNumber: a.tokenNumber,
    appointmentDate: a.appointmentDate, appointmentTime: a.appointmentTime.slice(0, 5), timezone, patientName: a.patientName,
    patientAge: a.patientAge, complaint: a.complaint, status: a.status, cancelReason: a.cancelReason, source: a.source, callId: a.callId, version: a.version };
}
