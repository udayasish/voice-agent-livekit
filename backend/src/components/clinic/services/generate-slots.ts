// Adapted from slots/services/generate-slots.ts. Civil-day iteration is independent of server timezone.
import { and, eq } from "drizzle-orm";
import type { GenerateSlotsInput } from "../contracts/inputs.js";
import { clinicBlockedDates, clinicSlots } from "../models/index.js";
import type { ClinicDayOfWeek } from "../models/enums.js";
import { addCalendarDays, clinicLocalDate } from "../timezone.js";
import type { ClinicRuntime } from "./runtime.js";
import { clinicError } from "../contracts/errors.js";

const weekdays: ClinicDayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

export async function generateSlots(runtime: ClinicRuntime, input: GenerateSlotsInput) {
  runtime.requireOperator();
  return runtime.deps.transaction(async (tx) => {
    const clinic = await runtime.requireClinic(tx, true);
    await runtime.requireDoctor(input.doctorId, tx);
    const today = clinicLocalDate(runtime.now(), clinic.timezone);
    const wanted = new Set(input.weekdays);
    let createdCount = 0;
    for (let offset = 0; offset < input.horizonDays; offset++) {
      const slotDate = addCalendarDays(today, offset);
      const dayOfWeek = weekdays[new Date(`${slotDate}T00:00:00Z`).getUTCDay()]!;
      if (!wanted.has(dayOfWeek)) continue;
      await runtime.lockDoctorDate(tx, input.doctorId, slotDate);
      const [blocked] = await tx.select({ id: clinicBlockedDates.id }).from(clinicBlockedDates)
        .where(and(eq(clinicBlockedDates.organizationId, runtime.identity.organizationId), eq(clinicBlockedDates.doctorId, input.doctorId), eq(clinicBlockedDates.blockedDate, slotDate)));
      const rows: (typeof clinicSlots.$inferInsert)[] = [];
      const existing = await tx.select().from(clinicSlots).where(and(eq(clinicSlots.organizationId, runtime.identity.organizationId),
        eq(clinicSlots.doctorId, input.doctorId), eq(clinicSlots.slotDate, slotDate)));
      for (let cursor = minutes(input.startTime); cursor + input.durationMinutes <= minutes(input.endTime); cursor += input.durationMinutes) {
        const startTime = format(cursor);
        const endTime = format(cursor + input.durationMinutes);
        runtime.appointmentInstant(slotDate, startTime, clinic.timezone);
        runtime.appointmentInstant(slotDate, endTime, clinic.timezone);
        const same = existing.find(slot => slot.startTime.slice(0, 5) === startTime);
        if (same) {
          if (same.endTime.slice(0, 5) !== endTime || same.maxPatients !== input.maxPatients) clinicError("SLOT_CONFLICT");
          continue;
        }
        if (existing.some(slot => slot.status !== "cancelled" && slot.startTime.slice(0, 5) < endTime && slot.endTime.slice(0, 5) > startTime)) clinicError("SLOT_CONFLICT");
        rows.push({ organizationId: runtime.identity.organizationId, doctorId: input.doctorId, slotDate, dayOfWeek,
          startTime, endTime, maxPatients: input.maxPatients, status: blocked ? "blocked" : "available" });
      }
      if (rows.length) {
        const created = await tx.insert(clinicSlots).values(rows).onConflictDoNothing({ target: [clinicSlots.doctorId, clinicSlots.slotDate, clinicSlots.startTime] }).returning({ id: clinicSlots.id });
        createdCount += created.length;
      }
    }
    return { createdCount };
  });
}
