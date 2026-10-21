import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { RangeList } from "../contracts/staff.js";
import { clinicBlockedDates } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { dateRange, page } from "./staff-common.js";

export async function listBlockedDates(runtime: ClinicRuntime, doctorId: string, input: RangeList) {
  const range = await dateRange(runtime, input); await runtime.requireDoctor(doctorId, runtime.deps.db, false);
  const scope = and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId), eq(clinicBlockedDates.doctorId, doctorId), gte(clinicBlockedDates.blockedDate, range.from), lte(clinicBlockedDates.blockedDate, range.to));
  const [count] = await runtime.deps.db.select({ total: sql<number>`count(*)::int` }).from(clinicBlockedDates).where(scope);
  const items = await runtime.deps.db.select({ id: clinicBlockedDates.id, doctorId: clinicBlockedDates.doctorId, blockedDate: clinicBlockedDates.blockedDate,
    reason: clinicBlockedDates.reason, notes: clinicBlockedDates.notes }).from(clinicBlockedDates).where(scope)
    .orderBy(asc(clinicBlockedDates.blockedDate), asc(clinicBlockedDates.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  return page(items, Number(count?.total ?? 0), { page: input.page, pageSize: input.pageSize });
}
