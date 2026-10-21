import { addCalendarDays, isValidDate } from "../timezone.js";
import { clockNumberText } from "./spoken-numbers.js";

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export function calendarDate(date: string, timezone: string) {
  if (!isValidDate(date)) throw new Error("Invalid clinic date");
  const instant = new Date(`${date}T12:00:00Z`);
  return { date, weekday: weekdays[instant.getUTCDay()]!, labelEn: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(instant), timezone };
}
export function spokenDate(date: string, language: string, includeYear = true) {
  if (!isValidDate(date)) throw new Error("Invalid clinic date");
  return new Intl.DateTimeFormat(language === "as" ? "as-IN" : language === "hi" ? "hi-IN" : "en-GB", {
    timeZone: "UTC", day: "numeric", month: "long", ...(includeYear ? { year: "numeric" as const } : {}), weekday: "long",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function spokenTime(time: string, language: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/u.exec(time);
  if (!match) throw new Error("Invalid clinic time");
  return new Intl.DateTimeFormat(language === "as" ? "as-IN" : language === "hi" ? "hi-IN" : "en-GB", {
    timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(`2000-01-01T${match[1]}:${match[2]}:00Z`));
}
export interface CalendarRequest { date?: string; times?: string[]; ambiguous?: boolean; conflicting?: boolean }
const normalizeCalendarText = (value: string) => value.normalize("NFKC").toLowerCase()
  .replace(/’/gu, "'")
  .replace(/[০-৯]/gu, d => String(d.charCodeAt(0) - 0x09e6)).replace(/[०-९]/gu, d => String(d.charCodeAt(0) - 0x0966));
let referenceLabels: { weekdays: string[][]; months: string[][] } | undefined;
function calendarLabels() {
  // Stable language labels only; these reference instants are never availability.
  const locales = ["as-IN", "en-GB", "hi-IN"];
  referenceLabels ??= {
    weekdays: Array.from({ length: 7 }, (_, day) => locales.map(locale => normalizeCalendarText(new Intl.DateTimeFormat(locale,
      { timeZone: "UTC", weekday: "long" }).format(new Date(Date.UTC(2000, 0, 2 + day)))))),
    months: Array.from({ length: 12 }, (_, month) => locales.flatMap(locale => {
      const label = normalizeCalendarText(new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(2000, month, 1))));
      return [label, label.replace(/'$/u, "")];
    })),
  };
  return referenceLabels;
}

/** Bounded guard for explicit numeric dates; not a universal semantic verifier. */
export function hasUnverifiedNumericDate(text: string, verifiedDates: readonly string[]): boolean {
  const value = normalizeCalendarText(text);
  if ([...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)].some(match => !verifiedDates.includes(match[0]))) return true;
  return calendarLabels().months.some((labels, month) => labels.some(label => {
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\d])(?:(\\d{1,2})(?:st|nd|rd|th)?\\s*${label}|${label}\\s+(\\d{1,2}))(?![\\p{L}\\p{M}\\d])`, "gu");
    return [...value.matchAll(pattern)].some(match => !verifiedDates.some(date => Number(date.slice(5, 7)) === month + 1 && Number(date.slice(8)) === Number(match[1] ?? match[2])));
  }));
}

/** Resolve a reference against returned options, never manufacture a bookable date. */
export function offeredDateChoice(text: string, offered: readonly string[]): { status: "none" | "matched" | "ambiguous" | "unavailable"; date?: string } {
  let value = normalizeCalendarText(text);
  const days = ["one|first|এক", "two|second|দুই", "three|third|তিনি", "four|fourth|চাৰি", "five|fifth|পাঁচ", "six|sixth|ছয়", "seven|seventh|সাত", "eight|eighth|আঠ", "nine|ninth|নয়", "ten|tenth|দহ", "eleven|eleventh|এঘাৰ", "twelve|twelfth|বাৰ", "thirteen|thirteenth|তেৰ", "fourteen|fourteenth|চৈধ্য", "fifteen|fifteenth|পোন্ধৰ", "sixteen|sixteenth|ষোল্ল", "seventeen|seventeenth|সোতৰ", "eighteen|eighteenth|ওঠৰ|আঠাৰ|अठारह", "nineteen|nineteenth|ঊনৈশ", "twenty|twentieth|বিশ", "twenty.one|twenty.first|একৈশ", "twenty.two|twenty.second|বাইশ", "twenty.three|twenty.third|তেইশ", "twenty.four|twenty.fourth|চৌবিশ", "twenty.five|twenty.fifth|পঁচিশ", "twenty.six|twenty.sixth|ছাব্বিশ", "twenty.seven|twenty.seventh|সাতাইশ", "twenty.eight|twenty.eighth|আঠাইশ", "twenty.nine|twenty.ninth|ঊনত্ৰিশ", "thirty|thirtieth|ত্ৰিশ", "thirty.one|thirty.first|একত্ৰিশ"];
  // Long compound numbers must be consumed before their component words.
  for (let index = days.length - 1; index >= 0; index--) value = value.replace(new RegExp(`(^|[^\\p{L}\\p{M}])(?:${days[index]})(?=$|[^\\p{L}\\p{M}])`, "gu"), `$1${index + 1}`);
  value = value.replace(/\d{1,2}(?::[0-5]\d)?\s*(?:am\b|pm\b|o'clock|বজাত|बजे)/gu, " ");
  const numbers = [...value.matchAll(/\b\d{1,2}\b/gu)].map(m => Number(m[0])).filter(n => n >= 1 && n <= 31);
  const names = calendarLabels();
  const labels = offered.map(date => ({ date, instant: new Date(`${date}T12:00:00Z`) }));
  const mentioned = (labels: string[]) => labels.some(label => value.includes(label));
  const weekdayMentioned = (instant: Date) => mentioned(names.weekdays[instant.getUTCDay()]!);
  const monthMentioned = (instant: Date) => mentioned(names.months[instant.getUTCMonth()]!);
  const hasWeekday = names.weekdays.some(mentioned), hasMonth = names.months.some(mentioned);
  if (!hasWeekday && !hasMonth) return { status: "none" };
  const matches = labels.filter(v => (!hasWeekday || weekdayMentioned(v.instant)) && (!hasMonth || monthMentioned(v.instant))
    && (!numbers.length || numbers.includes(v.instant.getUTCDate())));
  return matches.length === 1 ? { status: "matched", date: matches[0]!.date } : { status: matches.length ? "ambiguous" : "unavailable" };
}
/** Supported literal expressions only. Unknown/ambiguous speech stays unresolved. */
export function calendarRequest(text: string, localDate: string, expectTime = false): CalendarRequest {
  let value = normalizeCalendarText(text);
  const result: CalendarRequest = {};
  const explicit = value.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
  if (explicit && isValidDate(explicit)) result.date = explicit;
  else if (/day after tomorrow|পৰহি(?:লৈ|লে)?|পরশু|परसों/u.test(value)) result.date = addCalendarDays(localDate, 2);
  else if (/tomorrow|কাইলৈ|কাইলে|(?:^|\s)कल(?:\s|$)/u.test(value)) result.date = addCalendarDays(localDate, 1);
  else if (/today|আজি|आज/u.test(value)) result.date = localDate;
  // A calendar date is not a clock time.
  value = value.replace(/\d{4}-\d{2}-\d{2}/gu, " ");
  value = clockNumberText(value);
  value = value.replace(/(\d{1,2})\s*(?:बजकर|বাজি)\s*(\d{1,2})/gu, (_all, hour: string, minute: string) => `${hour}:${minute.padStart(2, "0")}`);
  const morningWords = /(?<![\p{L}\p{M}])am\b|a\.m\.|morning|এএম|एएम|ৰাতিপুৱা|সকাল|सुबह/gu;
  const eveningWords = /(?<![\p{L}\p{M}])pm\b|p\.m\.|afternoon|evening|পিএম|पीएम|বিয়লি|আবেলি|দুপৰ|संध्या|शाम|दोपहर/gu;
  const morning = new RegExp(morningWords).test(value);
  const evening = new RegExp(eveningWords).test(value) || (!morning && /ৰাতি|night|रात/u.test(value));
  const clockContext = expectTime || morning || evening || /\bat\b/u.test(value);
  const bare = value.replace(morningWords, " ").replace(eveningWords, " ").replace(/[?।!]+$/u, "").trim();
  if (clockContext && /^(\d{1,2})(?:\s+\1)*$/u.test(bare)) value = `${bare.split(/\s+/u)[0]} o'clock`;
  const minutePart = clockContext ? "|\\s+([0-5]?\\d)(?!\\d)" : "";
  const pattern = new RegExp(`(?<!\\d)(\\d{1,2})(?::([0-5]\\d)${minutePart}|\\s*(?:বজা(?:ত|লৈ)?|টাবলৈ|টা(?=$|\\s)|o'clock|am\\b|pm\\b|a\\.m\\.|p\\.m\\.|এএম|পিএম|एएम|पीएम|বাজে|बजे|बजकर))`, "gu");
  const matches = [...value.matchAll(pattern)];
  const clocks = [...new Set(matches.map(m => `${m[1]}:${(m[2] ?? m[3] ?? "00").padStart(2, "0")}`))];
  if (!clocks.length) return result;
  const alternatives = /\b(?:or|instead|actually)\b|\s(?:বা|অথবা|या)\s/u.test(value) && /\d/u.test(value.replace(pattern, " "));
  if (clocks.length > 1 || alternatives || /\b(?:not|don't)\b|নহয়|নহয়|নালাগ|नहीं/u.test(value)) return { ...result, conflicting: true };
  const [hourText, minute] = clocks[0]!.split(":");
  let hour = Number(hourText);
  if (hour > 23 || Number(minute) > 59) return result;
  if (morning && evening) return { ...result, ambiguous: true };
  if (evening && hour < 12) hour += 12;
  if (morning && hour === 12) hour = 0;
  result.times = [`${String(hour).padStart(2, "0")}:${minute}`];
  if (!morning && !evening && hour >= 1 && hour <= 12) {
    result.times = [hour === 12 ? `00:${minute}` : result.times[0]!, hour === 12 ? `12:${minute}` : `${hour + 12}:${minute}`];
    result.ambiguous = true;
  }
  return result;
}
