import { z } from "zod";
import { dateSchema, patientInputSchema } from "./inputs.js";
import { clinicAppointmentStatusEnum, clinicSlotStatusEnum, clinicBlockedDateReasonEnum } from "../models/enums.js";
import { doctorMetadataSchema } from "../services/doctor-metadata.js";

const id = z.uuid();
const name = z.string().trim().min(2).max(100);
const pageFields = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const pagingSchema = z.object(pageFields).strict();
export const rangeFields = { from: dateSchema.optional(), to: dateSchema.optional() };
export const rangeListSchema = z.object({ ...pageFields, ...rangeFields }).strict();
export const doctorListSchema = z.object({ ...pageFields, search: z.string().trim().min(1).max(100).optional(), active: z.enum(["true", "false"]).optional() }).strict();
const metadata = doctorMetadataSchema.shape;
const doctorFields = {
  name, phoneNumber: patientInputSchema.shape.phoneNumber,
  specialization: z.string().trim().min(1).max(255).nullable().optional(),
  consultationDurationMinutes: z.number().int().min(1).max(1440).default(15),
  nameEn: metadata.nameEn.nullable().optional(), nameAs: metadata.nameAs.optional(),
  searchAliases: metadata.searchAliases.default([]),
};
export const createDoctorSchema = z.object(doctorFields).strict().superRefine((v, ctx) => {
  const result = doctorMetadataSchema.safeParse({ doctorId: "00000000-0000-4000-8000-000000000001", nameEn: v.nameEn ?? "Reviewed", nameAs: v.nameAs ?? null, searchAliases: v.searchAliases });
  if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export const updateDoctorSchema = z.object({ ...doctorFields,
  consultationDurationMinutes: z.number().int().min(1).max(1440), searchAliases: metadata.searchAliases,
  isActive: z.boolean() }).partial().strict()
  .refine(v => Object.keys(v).length > 0).superRefine((v, ctx) => {
    if (v.searchAliases) {
      const result = doctorMetadataSchema.safeParse({ doctorId: "00000000-0000-4000-8000-000000000001", nameEn: "Reviewed", nameAs: null, searchAliases: v.searchAliases });
      if (!result.success) ctx.addIssue({ code: "custom", path: ["searchAliases"], message: "Aliases must have distinct normalized names" });
    }
  });
export const updateSlotSchema = z.object({ maxPatients: z.number().int().min(1).max(1000).optional(), status: z.literal("cancelled").optional() }).strict()
  .refine(v => v.maxPatients !== undefined || v.status !== undefined);
export const appointmentListSchema = z.object({ ...pageFields, ...rangeFields, doctorId: id.optional(), patientId: id.optional(), status: z.enum(clinicAppointmentStatusEnum.enumValues).optional() }).strict();
const actionFields = { expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(500) };
export const appointmentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), ...actionFields }).strict(),
  z.object({ action: z.literal("reschedule"), ...actionFields, targetSlotId: id }).strict(),
]);
export type AppointmentAction = z.infer<typeof appointmentActionSchema>;
export type CreateDoctor = z.infer<typeof createDoctorSchema>;
export type UpdateDoctor = z.infer<typeof updateDoctorSchema>;
export type RangeList = z.infer<typeof rangeListSchema>;
export const doctorParamsSchema = z.object({ doctorId: id }).strict();
export const slotParamsSchema = doctorParamsSchema.extend({ slotId: id }).strict();
export const blockParamsSchema = doctorParamsSchema.extend({ blockedDateId: id }).strict();
export const appointmentParamsSchema = z.object({ appointmentId: id }).strict();
export const doctorDtoSchema = z.object({ id, personId: id, name: z.string(), phoneNumber: z.string(), specialization: z.string().nullable(),
  consultationDurationMinutes: z.number().int().positive(), isActive: z.boolean(), nameEn: z.string().nullable(), nameAs: z.string().nullable(), searchAliases: z.array(z.string()) }).strict();
export const slotDtoSchema = z.object({ id, doctorId: id, slotDate: dateSchema, startTime: z.string(), endTime: z.string(),
  status: z.enum(clinicSlotStatusEnum.enumValues), maxPatients: z.number().int().positive(), bookedCount: z.number().int().nonnegative(), remainingCapacity: z.number().int().nonnegative() }).strict();
export const blockedDtoSchema = z.object({ id, doctorId: id, blockedDate: dateSchema, reason: z.enum(clinicBlockedDateReasonEnum.enumValues), notes: z.string().nullable() }).strict();
export const staffAppointmentSchema = z.object({ appointmentId: id, doctorId: id, patientId: id, slotId: id, tokenNumber: z.number().int().positive(),
  appointmentDate: dateSchema, appointmentTime: z.string(), timezone: z.string(), patientName: z.string(), patientAge: z.number().int(), complaint: z.string().nullable(),
  status: z.enum(clinicAppointmentStatusEnum.enumValues), cancelReason: z.string().nullable(), source: z.enum(["manual", "voice", "whatsapp"]), callId: id.nullable(), version: z.number().int().positive() }).strict();
export const historyDtoSchema = z.object({ id, actorId: id, previousSlotId: id, newSlotId: id, previousDate: dateSchema, newDate: dateSchema,
  previousTime: z.string(), newTime: z.string(), previousToken: z.number().int(), newToken: z.number().int(), version: z.number().int(), reason: z.string(), createdAt: z.string() }).strict();
export const appointmentDetailSchema = staffAppointmentSchema.extend({ history: z.array(historyDtoSchema) }).strict();
export const paginationSchema = z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).strict();
export function pageSchema<T extends z.ZodType>(item: T) { return z.object({ items: z.array(item), pagination: paginationSchema }).strict(); }
