import { z } from "zod";
import { doctorResultSchema } from "./dialogue.js";
import { dateSchema } from "../contracts/inputs.js";
import { slotSummarySchema } from "../contracts/results.js";
import { doctorName } from "../doctor-names.js";
import type { AgentLanguage } from "../../agent/engine/index.js";
import { calendarDate } from "./calendar.js";

export const readOffset = z.number().int().min(0).max(10000).optional();
const page = { outcome: z.string(), resultCount: z.number().int().nonnegative(), hasMore: z.boolean(), nextOffset: z.number().int().nullable() };
const doctor = z.object({ id: z.uuid(), name: z.string(), nameEn: z.string().nullable(), specialization: z.string().nullable(), active: z.boolean() }).strict();
export const clinicReadModelSchema = z.union([
  z.object({ ...page, doctors: z.array(doctor).max(5), alternatives: z.array(doctor).max(5), alternativeCount: z.number().int() }).strict(),
  z.object({ ...page, timezone: z.string(), dates: z.array(z.object({ date: dateSchema, weekday: z.string() }).strict()).max(3) }).strict(),
  z.object({ ...page, timezone: z.string(), date: dateSchema, selectedSlotId: z.uuid().nullable(),
    times: z.array(z.object({ id: z.uuid(), time: z.string(), remainingCapacity: z.number() }).strict()).max(8) }).strict(),
]);
export function projectClinicRead(name: string, output: unknown, offset: number, language: AgentLanguage, selectedSlotId: string | null) {
  const paging = (count: number, size: number) => ({ hasMore: offset + size < count, nextOffset: offset + size < count ? offset + size : null });
  if (name === "list_doctors" || name === "find_doctor") {
    const data = doctorResultSchema.parse(output);
    const compact = (d: z.infer<typeof doctorResultSchema>["doctors"][number]) => ({ id: d.id, name: doctorName(d, language), nameEn: d.nameEn ?? null, specialization: d.specialization ?? null, active: d.isActive });
    return { outcome: data.outcome, resultCount: data.resultCount, ...paging(Math.max(data.doctors.length, data.alternatives.length), 5),
      doctors: data.doctors.slice(offset, offset + 5).map(compact), alternatives: data.alternatives.slice(offset, offset + 5).map(compact), alternativeCount: data.alternatives.length };
  }
  if (name === "get_available_dates") {
    const data = z.object({ dates: z.array(dateSchema), timezone: z.string(), outcome: z.string() }).parse(output);
    return { outcome: data.outcome, resultCount: data.dates.length, ...paging(data.dates.length, 3), timezone: data.timezone,
      dates: data.dates.slice(offset, offset + 3).map(date => ({ date, weekday: calendarDate(date, data.timezone).weekday })) };
  }
  const data = z.object({ times: z.array(slotSummarySchema), timezone: z.string(), outcome: z.string(), calendar: z.object({ date: dateSchema }) }).parse(output);
  const selected = selectedSlotId ? data.times.find(s => s.id === selectedSlotId) : undefined;
  return { outcome: data.outcome, resultCount: data.times.length, ...(selected ? { hasMore: false, nextOffset: null } : paging(data.times.length, 8)),
    timezone: data.timezone, date: data.calendar.date, selectedSlotId: selected?.id ?? null,
    times: (selected ? [selected] : data.times.slice(offset, offset + 8)).map(s => ({ id: s.id, time: s.startTime.slice(0, 5), remainingCapacity: s.remainingCapacity })) };
}
