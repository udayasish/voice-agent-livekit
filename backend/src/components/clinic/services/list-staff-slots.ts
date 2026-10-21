import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { RangeList } from "../contracts/staff.js";
import { clinicSlots } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { dateRange, page } from "./staff-common.js";
import { bookedCount } from "./slot-capacity.js";

export async function listStaffSlots(runtime: ClinicRuntime, doctorId: string, input: RangeList) {
  const range = await dateRange(runtime, input); await runtime.requireDoctor(doctorId, runtime.deps.db, false);
  const scope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, doctorId), gte(clinicSlots.slotDate, range.from), lte(clinicSlots.slotDate, range.to));
  const [count] = await runtime.deps.db.select({ total: sql<number>`count(*)::int` }).from(clinicSlots).where(scope);
  const rows = await runtime.deps.db.select().from(clinicSlots).where(scope).orderBy(asc(clinicSlots.slotDate), asc(clinicSlots.startTime), asc(clinicSlots.id))
    .limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  const items = await Promise.all(rows.map(async slot => {
    const count = await bookedCount(runtime.deps.db, runtime.identity.organizationId, slot.id);
    return { id: slot.id, doctorId, slotDate: slot.slotDate, startTime: slot.startTime.slice(0, 5), endTime: slot.endTime.slice(0, 5),
      status: slot.status, maxPatients: slot.maxPatients, bookedCount: count, remainingCapacity: Math.max(0, slot.maxPatients - count) };
  }));
  return page(items, Number(count?.total ?? 0), { page: input.page, pageSize: input.pageSize });
}
