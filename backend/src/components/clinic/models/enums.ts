// Adopted clinic subset of whatsapp-appointment-platform src/lib/db/models/enums.ts.
import { pgEnum } from "drizzle-orm/pg-core";

export const clinicPersonRoleEnum = pgEnum("clinic_person_role", [
  "patient",
  "doctor",
  "receptionist",
]);

export const clinicDayOfWeekEnum = pgEnum("clinic_day_of_week", [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const clinicAppointmentStatusEnum = pgEnum("clinic_appointment_status", [
  "booked",
  "completed",
  "cancelled",
  "noshow",
]);

export const clinicSlotStatusEnum = pgEnum("clinic_slot_status", [
  "available",
  "booked",
  "blocked",
  "cancelled",
]);

export const clinicBlockedDateReasonEnum = pgEnum("clinic_blocked_date_reason", [
  "leave",
  "holiday",
  "emergency",
  "other",
]);

export const clinicAppointmentSourceEnum = pgEnum("clinic_appointment_source", ["voice", "whatsapp", "manual"]);
export type ClinicDayOfWeek = (typeof clinicDayOfWeekEnum.enumValues)[number];
