import { z } from "zod";
import * as s from "../contracts/staff.js";
import * as i from "../contracts/inputs.js";
import * as o from "../contracts/results.js";
import { ClinicRuntime, type ClinicDependencies } from "./runtime.js";
import { listStaffDoctors } from "./list-staff-doctors.js";
import { getStaffDoctor } from "./get-staff-doctor.js";
import { createStaffDoctor } from "./create-staff-doctor.js";
import { updateStaffDoctor } from "./update-staff-doctor.js";
import { listStaffSlots } from "./list-staff-slots.js";
import { updateStaffSlot } from "./update-staff-slot.js";
import { listBlockedDates } from "./list-blocked-dates.js";
import { getStaffAppointment } from "./get-staff-appointment.js";
import { listStaffAppointments } from "./list-staff-appointments.js";
import { mutateAppointment } from "./mutate-appointment.js";
import { createAppointmentFromBooking } from "./create-appointment.js";
import { getOrCreatePatient } from "./get-or-create-patient.js";
import { generateSlots } from "./generate-slots.js";
import { blockDoctorDate, unblockDoctorDate } from "./block-date.js";
import { listAvailableDates } from "./list-available-dates.js";
import { listAvailableSlots } from "./list-available-slots.js";
import { clinicError } from "../contracts/errors.js";

const { doctorId: _doctorId, ...generationFields } = i.generateSlotsInputSchema.shape;
const staffGenerationSchema = z.object(generationFields).strict().refine(v => v.startTime < v.endTime);

export interface StaffClinicContext { organizationId: string; actorId: string; role: "owner" | "admin" | "member" }
/** Context is supplied only after authenticated membership verification, never from request JSON. */
export function createStaffClinicServices(context: StaffClinicContext, deps: ClinicDependencies) {
  const trusted = z.object({ organizationId: z.uuid(), actorId: z.uuid(), role: z.enum(["owner", "admin", "member"]) }).strict().parse(context);
  const staffDeps: ClinicDependencies = { ...deps, logger: {
    info: (message, metadata) => deps.logger.info(message, { ...metadata, actorId: trusted.actorId }),
    warn: (message, metadata) => deps.logger.warn(message, { ...metadata, actorId: trusted.actorId }),
    error: (message, metadata) => deps.logger.error(message, { ...metadata, actorId: trusted.actorId }),
  } };
  const runtime = new ClinicRuntime({ organizationId: trusted.organizationId, source: "manual" }, staffDeps);
  const admin = () => { if (trusted.role === "member") clinicError("CLINIC_ACCESS_DENIED"); };
  const actionResult = s.staffAppointmentSchema.extend({ replayed: z.boolean(), notifications: o.notificationOutcomesSchema }).strict();
  return {
    listDoctors: (input: unknown) => runtime.run("staff.listDoctors", input, s.doctorListSchema, s.pageSchema(s.doctorDtoSchema), v => listStaffDoctors(runtime, v)),
    getDoctor: (input: unknown) => runtime.run("staff.getDoctor", input, s.doctorParamsSchema, s.doctorDtoSchema, v => getStaffDoctor(runtime, v.doctorId)),
    createDoctor: (input: unknown) => runtime.run("staff.createDoctor", input, s.createDoctorSchema, s.doctorDtoSchema, v => { admin(); return createStaffDoctor(runtime, v); }),
    updateDoctor: (doctorId: string, input: unknown) => runtime.run("staff.updateDoctor", input, s.updateDoctorSchema, s.doctorDtoSchema, v => { admin(); return updateStaffDoctor(runtime, z.uuid().parse(doctorId), v); }),
    listSlots: (doctorId: string, input: unknown) => runtime.run("staff.listSlots", input, s.rangeListSchema, s.pageSchema(s.slotDtoSchema), v => listStaffSlots(runtime, z.uuid().parse(doctorId), v)),
    generateSlots: (doctorId: string, input: unknown) => runtime.run("staff.generateSlots", input, staffGenerationSchema, o.generationSchema, v => { admin(); return generateSlots(runtime, { ...v, doctorId: z.uuid().parse(doctorId) }); }),
    updateSlot: (doctorId: string, slotId: string, input: unknown) => runtime.run("staff.updateSlot", input, s.updateSlotSchema, s.slotDtoSchema, v => { admin(); return updateStaffSlot(runtime, z.uuid().parse(doctorId), z.uuid().parse(slotId), v); }),
    availableDates: (doctorId: string, input: unknown) => runtime.run("staff.availableDates", input, i.datesInputSchema.omit({ doctorId: true }), z.object({ dates: z.array(i.dateSchema), timezone: z.string() }).strict(), async v => ({ dates: await listAvailableDates(runtime, z.uuid().parse(doctorId), v.maxDates), timezone: (await runtime.requireClinic()).timezone })),
    availableTimes: (doctorId: string, input: unknown) => runtime.run("staff.availableTimes", input, z.object({ date: i.dateSchema }).strict(), z.object({ slots: z.array(o.slotSummarySchema), timezone: z.string() }).strict(), async v => ({ slots: (await listAvailableSlots(runtime, z.uuid().parse(doctorId), v.date)).map(slot => ({ ...slot, startTime: slot.startTime.slice(0, 5), endTime: slot.endTime.slice(0, 5) })), timezone: (await runtime.requireClinic()).timezone })),
    listBlockedDates: (doctorId: string, input: unknown) => runtime.run("staff.listBlockedDates", input, s.rangeListSchema, s.pageSchema(s.blockedDtoSchema), v => listBlockedDates(runtime, z.uuid().parse(doctorId), v)),
    blockDate: (doctorId: string, input: unknown) => runtime.run("staff.blockDate", input, i.blockDateInputSchema.omit({ doctorId: true }), o.blockedDateSchema, v => { admin(); return blockDoctorDate(runtime, { ...v, doctorId: z.uuid().parse(doctorId) }); }),
    unblockDate: (doctorId: string, blockedDateId: string) => runtime.run("staff.unblockDate", { doctorId, blockedDateId }, i.unblockDateInputSchema, o.unblockedDateSchema, v => { admin(); return unblockDoctorDate(runtime, v.doctorId, v.blockedDateId); }),
    resolvePatient: (input: unknown) => runtime.run("staff.resolvePatient", input, i.patientInputSchema, o.patientSummarySchema, v => getOrCreatePatient(runtime, v.phoneNumber)),
    listAppointments: (input: unknown) => runtime.run("staff.listAppointments", input, s.appointmentListSchema, s.pageSchema(s.staffAppointmentSchema), v => listStaffAppointments(runtime, v)),
    getAppointment: (input: unknown) => runtime.run("staff.getAppointment", input, s.appointmentParamsSchema, s.appointmentDetailSchema, v => getStaffAppointment(runtime, v.appointmentId)),
    book: (requestKey: string, input: unknown) => runtime.run("staff.book", input, i.bookingInputSchema, o.appointmentSummarySchema.extend({ version: z.number().int().positive(), replayed: z.boolean() }).strict(), async v => {
      const identity = { organizationId: trusted.organizationId, source: "manual" as const, requestKey: z.uuid().parse(requestKey) };
      const result = await createAppointmentFromBooking(new ClinicRuntime(identity, deps), v);
      return { ...result, appointmentTime: result.appointmentTime.slice(0, 5), version: 1, replayed: result.notifications.reminder === "not_repeated" };
    }),
    mutate: (appointmentId: string, requestKey: string, input: unknown) => runtime.run("staff.mutateAppointment", input, s.appointmentActionSchema, actionResult,
      v => mutateAppointment(runtime, trusted.actorId, z.uuid().parse(requestKey), z.uuid().parse(appointmentId), v)),
  };
}
export type StaffClinicServices = ReturnType<typeof createStaffClinicServices>;
