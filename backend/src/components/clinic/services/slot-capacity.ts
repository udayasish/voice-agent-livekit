import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../../../lib/db/transaction-with-hooks.js";
import { clinicAppointments, clinicSlots } from "../models/index.js";
import type { ClinicConnection, ClinicRuntime } from "./runtime.js";

export async function bookedCount(connection: ClinicConnection, organizationId: string, slotId: string) {
  const [row] = await connection.select({ count: sql<number>`count(*)::int` }).from(clinicAppointments).where(and(
    eq(clinicAppointments.organizationId, organizationId), eq(clinicAppointments.slotId, slotId), eq(clinicAppointments.status, "booked")));
  return Number(row?.count ?? 0);
}
/** Caller holds the doctor/date and slot locks. Terminal/blocked slots never reopen here. */
export async function refreshSlot(tx: Transaction, runtime: ClinicRuntime, slot: typeof clinicSlots.$inferSelect) {
  if (slot.status !== "available" && slot.status !== "booked") return;
  const count = await bookedCount(tx, runtime.identity.organizationId, slot.id);
  await tx.update(clinicSlots).set({ status: count >= slot.maxPatients ? "booked" : "available", updatedAt: runtime.now() })
    .where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.id, slot.id)));
}
