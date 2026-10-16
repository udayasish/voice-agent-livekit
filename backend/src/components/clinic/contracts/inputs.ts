import { z } from "zod";
import { clinicBlockedDateReasonEnum, clinicDayOfWeekEnum, clinicAppointmentSourceEnum } from "../models/enums.js";
import { isValidDate } from "../timezone.js";

export const clinicIdentitySchema = z.object({
  organizationId: z.uuid(),
  source: z.enum(clinicAppointmentSourceEnum.enumValues),
  callId: z.uuid().optional(),
  // Verified patient identity from a server adapter; a phone number alone is not authentication.
  patientId: z.uuid().optional(),
}).strict();
export type ClinicIdentity = Readonly<z.infer<typeof clinicIdentitySchema>>;

export const dateSchema = z.string().refine(isValidDate);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const emptyInputSchema = z.object({}).strict();
export const doctorInputSchema = z.object({ doctorId: z.uuid() }).strict();
export const findDoctorsInputSchema = z.object({ namePart: z.string().trim().min(1).max(100) }).strict();
export const datesInputSchema = z.object({ doctorId: z.uuid(), maxDates: z.number().int().min(1).max(90).default(7) }).strict();
export const slotsInputSchema = z.object({ doctorId: z.uuid(), date: dateSchema }).strict();
export const patientInputSchema = z.object({
  // Source contacts are digits-only; do not infer a country code or missing digits.
  phoneNumber: z.string().trim().regex(/^\+?[0-9]{10,15}$/).transform((value) => value.replace(/^\+/, "")),
}).strict();
export const bookingInputSchema = z.object({
  doctorId: z.uuid(), patientId: z.uuid(), slotId: z.uuid(),
  patientName: z.string().trim().min(2).max(100),
  patientAge: z.number().int().min(0).max(120),
  complaint: z.string().trim().min(3).max(500).nullable().optional(),
}).strict();
export const upcomingInputSchema = z.object({ patientId: z.uuid() }).strict();
export const cancelInputSchema = z.object({ appointmentId: z.uuid(), reason: z.string().trim().min(1).max(500) }).strict();
export const generateSlotsInputSchema = z.object({
  doctorId: z.uuid(), weekdays: z.array(z.enum(clinicDayOfWeekEnum.enumValues)).min(1).max(7),
  startTime: timeSchema, endTime: timeSchema,
  durationMinutes: z.number().int().min(1).max(1440),
  horizonDays: z.number().int().min(1).max(90),
  maxPatients: z.number().int().min(1).max(1000).default(30),
}).strict().refine((value) => value.startTime < value.endTime);
export const blockDateInputSchema = z.object({
  doctorId: z.uuid(), date: dateSchema,
  reason: z.enum(clinicBlockedDateReasonEnum.enumValues).default("leave"),
  notes: z.string().trim().max(500).optional(),
}).strict();
export const unblockDateInputSchema = z.object({ doctorId: z.uuid(), blockedDateId: z.uuid() }).strict();

export type BookingInput = z.infer<typeof bookingInputSchema>;
export type GenerateSlotsInput = z.infer<typeof generateSlotsInputSchema>;
export type BlockDateInput = z.infer<typeof blockDateInputSchema>;
