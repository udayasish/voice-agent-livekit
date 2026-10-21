import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { updateSlotSchema } from "../contracts/staff.js";
import { clinicError } from "../contracts/errors.js";
import { clinicSlots } from "../models/index.js";
import type { ClinicRuntime } from "./runtime.js";
import { bookedCount } from "./slot-capacity.js";

export async function updateStaffSlot(runtime: ClinicRuntime, doctorId: string, slotId: string, input: z.infer<typeof updateSlotSchema>) {
  runtime.requireOperator();
  return runtime.deps.transaction(async tx => {
    await runtime.requireClinic(tx, true); await runtime.requireDoctor(doctorId, tx, false);
    const scope = and(eq(clinicSlots.organizationId, runtime.identity.organizationId), eq(clinicSlots.doctorId, doctorId), eq(clinicSlots.id, slotId));
    const [initial] = await tx.select().from(clinicSlots).where(scope); if (!initial) clinicError("SLOT_NOT_FOUND");
    await runtime.lockDoctorDate(tx, doctorId, initial.slotDate);
    const [slot] = await tx.select().from(clinicSlots).where(scope).for("update"); if (!slot) clinicError("SLOT_NOT_FOUND");
    const count = await bookedCount(tx, runtime.identity.organizationId, slotId);
    if (input.status === "cancelled" && count > 0) clinicError("SLOT_HAS_BOOKINGS");
    if (input.maxPatients !== undefined && (input.maxPatients < count || slot.status === "blocked" || slot.status === "cancelled")) clinicError("SLOT_CONFLICT");
    const maxPatients = input.maxPatients ?? slot.maxPatients;
    const status = input.status ?? (slot.status === "available" || slot.status === "booked" ? (count >= maxPatients ? "booked" : "available") : slot.status);
    await tx.update(clinicSlots).set({ maxPatients, status, updatedAt: runtime.now() }).where(scope);
    return { id: slot.id, doctorId, slotDate: slot.slotDate, startTime: slot.startTime.slice(0, 5), endTime: slot.endTime.slice(0, 5),
      status, maxPatients, bookedCount: count, remainingCapacity: Math.max(0, maxPatients - count) };
  });
}
