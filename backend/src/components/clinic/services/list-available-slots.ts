// Adapted from slots/services/list-available-slots.ts; actual capacity and local time are checked.
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { clinicAppointments, clinicBlockedDates, clinicSlots } from "../models/index.js";
import type { SlotSummary } from "../contracts/results.js";
import { clinicLocalDate, zonedTimeToUtc } from "../timezone.js";
import type { ClinicRuntime } from "./runtime.js";

export async function availableSlots(runtime: ClinicRuntime, doctorId: string, date?: string): Promise<SlotSummary[]> {
  const clinic = await runtime.requireClinic();
  await runtime.requireDoctor(doctorId);
  const now = runtime.now();
  const rows = await runtime.deps.db.select({ slot: clinicSlots, bookedCount: sql<number>`count(${clinicAppointments.id})::int` })
    .from(clinicSlots)
    .leftJoin(clinicAppointments, and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.slotId, clinicSlots.id), eq(clinicAppointments.status, "booked")))
    .leftJoin(clinicBlockedDates, and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId), eq(clinicBlockedDates.doctorId, doctorId), eq(clinicBlockedDates.blockedDate, clinicSlots.slotDate)))
    .where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, doctorId), eq(clinicSlots.status, "available"),
      date ? eq(clinicSlots.slotDate, date) : gte(clinicSlots.slotDate, clinicLocalDate(now, clinic.timezone)), isNull(clinicBlockedDates.id)))
    .groupBy(clinicSlots.id).orderBy(clinicSlots.slotDate, clinicSlots.startTime);
  return rows.flatMap(({ slot, bookedCount }) => {
    const remainingCapacity = slot.maxPatients - Number(bookedCount);
    if (remainingCapacity <= 0) return [];
    // Invalid/ambiguous DST times are not offered as bookable facts.
    try { if (zonedTimeToUtc(slot.slotDate, slot.startTime, clinic.timezone).getTime() <= now.getTime()) return []; }
    catch { return []; }
    return [{ id: slot.id, slotDate: slot.slotDate, startTime: slot.startTime, endTime: slot.endTime, maxPatients: slot.maxPatients, remainingCapacity }];
  });
}

export async function listAvailableSlots(runtime: ClinicRuntime, doctorId: string, date: string) {
  return availableSlots(runtime, doctorId, date);
}
