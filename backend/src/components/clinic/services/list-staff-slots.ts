import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { RangeList } from "../contracts/staff.js";
import { clinicAppointments, clinicSlots } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { dateRange, page } from "./staff-common.js";

export async function listStaffSlots(runtime: ClinicRuntime, doctorId: string, input: RangeList) {
  const range = await dateRange(runtime, input); await runtime.requireDoctor(doctorId, runtime.deps.db, false);
  const scope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, doctorId), gte(clinicSlots.slotDate, range.from), lte(clinicSlots.slotDate, range.to));
  const [count] = await runtime.deps.db.select({ total: sql<number>`count(*)::int` }).from(clinicSlots).where(scope);
  // Count occupancy in the page query, rather than opening a query/connection for every slot.
  const rows = await runtime.deps.db.select({ slot: clinicSlots, bookedCount: sql<number>`count(${clinicAppointments.id})::int` })
    .from(clinicSlots).leftJoin(clinicAppointments, and(eq(clinicAppointments.organizationId, runtime.identity.organizationId),
      eq(clinicAppointments.slotId, clinicSlots.id), eq(clinicAppointments.status, "booked")))
    .where(scope).groupBy(clinicSlots.id).orderBy(asc(clinicSlots.slotDate), asc(clinicSlots.startTime), asc(clinicSlots.id))
    .limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  const items = rows.map(({ slot, bookedCount }) => {
    const count = Number(bookedCount);
    return { id: slot.id, doctorId, slotDate: slot.slotDate, startTime: slot.startTime.slice(0, 5), endTime: slot.endTime.slice(0, 5),
      status: slot.status, maxPatients: slot.maxPatients, bookedCount: count, remainingCapacity: Math.max(0, slot.maxPatients - count) };
  });
  return page(items, Number(count?.total ?? 0), { page: input.page, pageSize: input.pageSize });
}
