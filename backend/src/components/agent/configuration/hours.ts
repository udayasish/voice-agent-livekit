import type { WorkingHours } from "./schema.js";
export function isOpen(hours: WorkingHours, timezone: string, now = new Date()): boolean {
  // Converting an actual instant has no ambiguous/nonexistent-local-time guess.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  if (hours.mode === "always_open") return true;
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  const day = get("weekday").toLowerCase() as keyof typeof hours.days;
  const clock = `${get("hour")}:${get("minute")}`;
  return hours.days[day].some(interval => interval.start <= clock && clock < interval.end);
}
