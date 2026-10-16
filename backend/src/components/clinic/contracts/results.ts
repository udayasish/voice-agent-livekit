import { z } from "zod";
import type { ApiError, ApiSuccess } from "../../../types.js";
import { dateSchema } from "./inputs.js";

export type ClinicResult<T> = ApiSuccess<T> | ApiError;
export const notificationStatusSchema = z.enum(["scheduled", "disabled", "skipped_window", "unconfigured", "failed"]);
export const notificationOutcomesSchema = z.object({ reminder: notificationStatusSchema, doctorAlert: notificationStatusSchema }).strict();
export type NotificationOutcomes = z.infer<typeof notificationOutcomesSchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const doctorSummarySchema = z.object({ id: z.uuid(), name: z.string(), specialization: z.string().nullable() }).strict();
export const doctorMatchSchema = z.object({ id: z.uuid(), name: z.string(), isActive: z.boolean() }).strict();
export const patientSummarySchema = z.object({ id: z.uuid(), phoneNumber: z.string(), role: z.literal("patient") }).strict();
export const slotSummarySchema = z.object({
  id: z.uuid(), slotDate: dateSchema, startTime: z.string(), endTime: z.string(),
  maxPatients: z.number().int().positive(), remainingCapacity: z.number().int().positive(),
}).strict();
export const appointmentSummarySchema = z.object({
  appointmentId: z.uuid(), doctorId: z.uuid(), patientId: z.uuid(), slotId: z.uuid(),
  tokenNumber: z.number().int().positive(), appointmentDate: dateSchema, appointmentTime: z.string(),
  timezone: z.string(), status: z.literal("booked"), notifications: notificationOutcomesSchema,
}).strict();
export const upcomingSummarySchema = z.object({
  appointmentId: z.uuid(), doctorId: z.uuid(), tokenNumber: z.number().int().positive(),
  doctorName: z.string(), appointmentDate: dateSchema, appointmentTime: z.string(), timezone: z.string(),
}).strict();
export const cancellationSchema = z.object({ appointmentId: z.uuid(), status: z.literal("cancelled"), alreadyCancelled: z.boolean() }).strict();
export const generationSchema = z.object({ createdCount: z.number().int().nonnegative() }).strict();
export const blockedDateSchema = z.object({ blockedDateId: z.uuid(), affectedSlots: z.number().int().nonnegative(), cancelledAppointments: z.number().int().nonnegative() }).strict();
export const unblockedDateSchema = z.object({ unblockedDate: dateSchema, reopenedSlots: z.number().int().nonnegative() }).strict();

export type SlotSummary = z.infer<typeof slotSummarySchema>;
export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>;
