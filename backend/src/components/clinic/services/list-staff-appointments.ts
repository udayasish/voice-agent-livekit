import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { appointmentListSchema } from "../contracts/staff.js";
import { clinicAppointments } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { appointmentDto, dateRange, page } from "./staff-common.js";

export async function listStaffAppointments(runtime: ClinicRuntime, input: z.infer<typeof appointmentListSchema>) {
  const { from, to, clinic } = await dateRange(runtime, input);
  if (input.doctorId) await runtime.requireDoctor(input.doctorId, runtime.deps.db, false);
  if (input.patientId) await runtime.requirePatient(input.patientId);
  const scope = and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), gte(clinicAppointments.appointmentDate, from), lte(clinicAppointments.appointmentDate, to),
    input.doctorId ? eq(clinicAppointments.doctorId, input.doctorId) : undefined,
    input.patientId ? eq(clinicAppointments.patientId, input.patientId) : undefined,
    input.status ? eq(clinicAppointments.status, input.status) : undefined);
  const [count] = await runtime.deps.db.select({ total: sql<number>`count(*)::int` }).from(clinicAppointments).where(scope);
  const rows = await runtime.deps.db.select().from(clinicAppointments).where(scope).orderBy(asc(clinicAppointments.appointmentDate), asc(clinicAppointments.appointmentTime), asc(clinicAppointments.id))
    .limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  return page(rows.map(a => appointmentDto(a, clinic.timezone)), Number(count?.total ?? 0), { page: input.page, pageSize: input.pageSize });
}
