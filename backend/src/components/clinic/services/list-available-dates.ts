// Adapted from slots/services/list-available-dates.ts.
import { availableSlots } from "./list-available-slots.js";
import type { ClinicRuntime } from "./runtime.js";

export async function listAvailableDates(runtime: ClinicRuntime, doctorId: string, maxDates: number) {
  return [...new Set((await availableSlots(runtime, doctorId)).map((slot) => slot.slotDate))].slice(0, maxDates);
}
