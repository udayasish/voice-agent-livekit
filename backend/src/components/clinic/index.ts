import { z } from "zod";
import * as inputs from "./contracts/inputs.js";
import * as outputs from "./contracts/results.js";
import { ClinicRuntime, type ClinicDependencies } from "./services/runtime.js";
import { listActiveDoctors } from "./services/list-active-doctors.js";
import { findDoctorsByName } from "./services/find-doctor-by-name.js";
import { listAvailableDates } from "./services/list-available-dates.js";
import { listAvailableSlots } from "./services/list-available-slots.js";
import { getOrCreatePatient } from "./services/get-or-create-patient.js";
import { createAppointmentFromBooking } from "./services/create-appointment.js";
import { listUpcomingAppointmentsForPatient } from "./services/list-upcoming-for-patient.js";
import { cancelAppointment } from "./services/cancel-appointment.js";
import { generateSlots } from "./services/generate-slots.js";
import { blockDoctorDate, unblockDoctorDate } from "./services/block-date.js";

export type { ClinicIdentity } from "./contracts/inputs.js";
export type { ClinicResult, AppointmentSummary, SlotSummary, NotificationOutcomes } from "./contracts/results.js";
export type { ClinicDependencies } from "./services/runtime.js";
export type { ClinicNotificationScheduler, ClinicNotificationJob } from "./notifications/types.js";

// Internal server boundary only. Identity must come from verified server context, never model arguments.
export function createClinicServices(identity: inputs.ClinicIdentity, deps: ClinicDependencies) {
  const runtime = new ClinicRuntime(identity, deps);
  return Object.freeze({
    listActiveDoctors: (input: z.input<typeof inputs.emptyInputSchema> = {}) => runtime.run("listActiveDoctors", input, inputs.emptyInputSchema, z.array(outputs.doctorSummarySchema), () => listActiveDoctors(runtime)),
    findDoctorsByName: (input: z.input<typeof inputs.findDoctorsInputSchema>) => runtime.run("findDoctorsByName", input, inputs.findDoctorsInputSchema, z.array(outputs.doctorMatchSchema), (value) => findDoctorsByName(runtime, value.namePart)),
    listAvailableDates: (input: z.input<typeof inputs.datesInputSchema>) => runtime.run("listAvailableDates", input, inputs.datesInputSchema, z.array(inputs.dateSchema), (value) => listAvailableDates(runtime, value.doctorId, value.maxDates)),
    listAvailableSlots: (input: z.input<typeof inputs.slotsInputSchema>) => runtime.run("listAvailableSlots", input, inputs.slotsInputSchema, z.array(outputs.slotSummarySchema), (value) => listAvailableSlots(runtime, value.doctorId, value.date)),
    getOrCreatePatient: (input: z.input<typeof inputs.patientInputSchema>) => runtime.run("getOrCreatePatient", input, inputs.patientInputSchema, outputs.patientSummarySchema, (value) => getOrCreatePatient(runtime, value.phoneNumber)),
    createAppointmentFromBooking: (input: z.input<typeof inputs.bookingInputSchema>) => runtime.run("createAppointmentFromBooking", input, inputs.bookingInputSchema, outputs.appointmentSummarySchema, (value) => createAppointmentFromBooking(runtime, value)),
    listUpcomingAppointmentsForPatient: (input: z.input<typeof inputs.upcomingInputSchema>) => runtime.run("listUpcomingAppointmentsForPatient", input, inputs.upcomingInputSchema, z.array(outputs.upcomingSummarySchema), (value) => listUpcomingAppointmentsForPatient(runtime, value.patientId)),
    cancelAppointment: (input: z.input<typeof inputs.cancelInputSchema>) => runtime.run("cancelAppointment", input, inputs.cancelInputSchema, outputs.cancellationSchema, (value) => cancelAppointment(runtime, value.appointmentId, value.reason)),
    generateSlots: (input: z.input<typeof inputs.generateSlotsInputSchema>) => runtime.run("generateSlots", input, inputs.generateSlotsInputSchema, outputs.generationSchema, (value) => generateSlots(runtime, value)),
    blockDoctorDate: (input: z.input<typeof inputs.blockDateInputSchema>) => runtime.run("blockDoctorDate", input, inputs.blockDateInputSchema, outputs.blockedDateSchema, (value) => blockDoctorDate(runtime, value)),
    unblockDoctorDate: (input: z.input<typeof inputs.unblockDateInputSchema>) => runtime.run("unblockDoctorDate", input, inputs.unblockDateInputSchema, outputs.unblockedDateSchema, (value) => unblockDoctorDate(runtime, value.doctorId, value.blockedDateId)),
  });
}

export type ClinicServices = ReturnType<typeof createClinicServices>;
