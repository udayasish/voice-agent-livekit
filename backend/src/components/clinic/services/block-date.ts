// Adapted from doctors/services/block-date.ts. Transport sends removed; all domain changes are atomic.
import { and, eq, ne, sql } from "drizzle-orm";
import { clinicError } from "../contracts/errors.js";
import type { BlockDateInput } from "../contracts/inputs.js";
import { clinicAppointments, clinicBlockedDates, clinicSlots } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";

export async function blockDoctorDate(runtime: ClinicRuntime, input: BlockDateInput) {
  runtime.requireOperator();
  return runtime.deps.transaction(async (tx) => {
    await runtime.requireClinic(tx, true);
    await runtime.requireDoctor(input.doctorId, tx, false);
    await runtime.lockDoctorDate(tx, input.doctorId, input.date);
    const [blocked] = await tx.insert(clinicBlockedDates).values({ organizationId: runtime.identity.organizationId,
      doctorId: input.doctorId, blockedDate: input.date, reason: input.reason, notes: input.notes ?? null })
      .onConflictDoNothing({ target: [clinicBlockedDates.doctorId, clinicBlockedDates.blockedDate] }).returning();
    if (!blocked) clinicError("DATE_ALREADY_BLOCKED");
    const slotScope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, input.doctorId), eq(clinicSlots.slotDate, input.date), ne(clinicSlots.status, "cancelled"));
    await tx.select({ id: clinicSlots.id }).from(clinicSlots).where(slotScope).orderBy(clinicSlots.id).for("update");
    const affectedSlots = await tx.update(clinicSlots).set({ status: "blocked", updatedAt: runtime.now() }).where(slotScope).returning({ id: clinicSlots.id });
    const cancelled = await tx.update(clinicAppointments).set({ status: "cancelled", cancelReason: "Doctor unavailable on this date", updatedAt: runtime.now() })
      .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.doctorId, input.doctorId), eq(clinicAppointments.appointmentDate, input.date), eq(clinicAppointments.status, "booked")))
      .returning({ id: clinicAppointments.id });
    return { blockedDateId: blocked.id, affectedSlots: affectedSlots.length, cancelledAppointments: cancelled.length };
  });
}

export async function unblockDoctorDate(runtime: ClinicRuntime, doctorId: string, blockedDateId: string) {
  runtime.requireOperator();
  return runtime.deps.transaction(async (tx) => {
    await runtime.requireClinic(tx, true);
    await runtime.requireDoctor(doctorId, tx, false);
    const scope = and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId), eq(clinicBlockedDates.doctorId, doctorId), eq(clinicBlockedDates.id, blockedDateId));
    const [initial] = await tx.select().from(clinicBlockedDates).where(scope);
    if (!initial) clinicError("BLOCKED_DATE_NOT_FOUND");
    await runtime.lockDoctorDate(tx, doctorId, initial.blockedDate);
    const [blocked] = await tx.select().from(clinicBlockedDates).where(scope).for("update");
    if (!blocked) clinicError("BLOCKED_DATE_NOT_FOUND");
    const slots = await tx.select().from(clinicSlots)
      .where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, doctorId), eq(clinicSlots.slotDate, blocked.blockedDate), eq(clinicSlots.status, "blocked")))
      .orderBy(clinicSlots.id).for("update");
    for (const slot of slots) {
      const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(clinicAppointments)
        .where(and(eq(clinicAppointments.organizationId, runtime.identity.organizationId), eq(clinicAppointments.slotId, slot.id), eq(clinicAppointments.status, "booked")));
      await tx.update(clinicSlots).set({ status: Number(count?.count ?? 0) >= slot.maxPatients ? "booked" : "available", updatedAt: runtime.now() })
        .where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.id, slot.id)));
    }
    await tx.delete(clinicBlockedDates).where(scope);
    return { unblockedDate: blocked.blockedDate, reopenedSlots: slots.length };
  });
}
