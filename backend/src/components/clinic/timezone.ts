// Adapted from whatsapp-appointment-platform src/common/timezone.ts.
// Retains built-in Intl conversion; validates the actual wall-clock result, including DST.
function wallClockParts(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}T${values["hour"]}:${values["minute"]}:${values["second"]}`;
}

export function clinicLocalDate(instant: Date, timeZone: string): string {
  return wallClockParts(instant, timeZone).slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addCalendarDays(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  if (!isValidDate(dateStr) || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    throw new RangeError("Invalid clinic-local date or time");
  }
  const target = `${dateStr}T${time}`;
  const naive = new Date(`${target}Z`).getTime();
  const candidates = new Set<number>();
  // Sample offsets on both sides of the appointment day to detect DST overlap/gap.
  for (const hours of [-36, 0, 36]) {
    const sample = new Date(naive + hours * 60 * 60 * 1000);
    const offset = new Date(`${wallClockParts(sample, timeZone)}Z`).getTime() - sample.getTime();
    const candidate = naive - offset;
    if (wallClockParts(new Date(candidate), timeZone) === target) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new RangeError("Ambiguous or nonexistent clinic-local time");
  return new Date([...candidates][0]!);
}
