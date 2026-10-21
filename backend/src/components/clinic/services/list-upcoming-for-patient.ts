// Adapted from appointments/services/list-upcoming-for-patient.ts; scope and local day are enforced.
import { and, eq, gte } from "drizzle-orm";
import { clinicAppointments, clinicDoctors, clinicPeople } from "../models/index.js";
import { clinicLocalDate } from "../timezone.js";
import type { ClinicRuntime } from "./runtime.js";

export async function listUpcomingAppointmentsForPatient(runtime: ClinicRuntime, patientId: string) {
  const clinic = await runtime.requireClinic();
  await runtime.requirePatient(patientId);
  const now = runtime.now();
  const rows = await runtime.deps.db.select({ appointmentId: clinicAppointments.id, doctorId: clinicDoctors.id, doctorName: clinicPeople.name,
    version: clinicAppointments.version, tokenNumber: clinicAppointments.tokenNumber, appointmentDate: clinicAppointments.appointmentDate, appointmentTime: clinicAppointments.appointmentTime })
    .from(clinicAppointments)
    .innerJoin(clinicDoctors, and(eq(clinicAppointments.doctorId, clinicDoctors.id), eq(clinicDoctors.organizationId, runtime.identity.organizationId)))
    .innerJoin(clinicPeople, and(eq(clinicDoctors.personId, clinicPeople.id), eq(clinicPeople.organizationId, runtime.identity.organizationId)))
    .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.patientId, patientId), eq(clinicAppointments.status, "booked"), gte(clinicAppointments.appointmentDate, clinicLocalDate(now, clinic.timezone))))
    .orderBy(clinicAppointments.appointmentDate, clinicAppointments.appointmentTime);
  return rows.filter((row) => runtime.appointmentInstant(row.appointmentDate, row.appointmentTime, clinic.timezone).getTime() > now.getTime())
    .map((row) => ({ ...row, doctorName: row.doctorName ?? "Doctor", timezone: clinic.timezone }));
}
