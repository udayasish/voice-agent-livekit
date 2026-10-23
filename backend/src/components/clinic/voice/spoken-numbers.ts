import { normalizePhoneNumber } from "../../agent/normalizers/index.js";

/** Bounded cardinal grammar, not a transcript correction or language detector. */
const cardinals: Readonly<Record<string, number>> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  টেন: 10, টুৱেণ্টি: 20, টুৱেনটি: 20, থাৰ্টি: 30, থার্টি: 30, ঠার্তি: 30,
  দহ: 10, দহা: 10, এঘাৰ: 11, বাৰ: 12, তেৰ: 13, চৈধ্য: 14, পোন্ধৰ: 15, ষোল্ল: 16, সোতৰ: 17, ওঠৰ: 18, ঊনৈশ: 19,
  বিশ: 20, একৈশ: 21, বাইশ: 22, তেইশ: 23, চৌবিশ: 24, পঁচিশ: 25, ছাব্বিশ: 26, ছাব্বিছ: 26, সাতাইশ: 27, আঠাইশ: 28, ঊনত্ৰিশ: 29,
  ত্ৰিশ: 30, চল্লিশ: 40, পঞ্চাশ: 50, ষাঠি: 60, সত্তৰ: 70, আশী: 80, নব্বৈ: 90, এশ: 100,
  शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9,
  दस: 10, ग्यारह: 11, बारह: 12, तेरह: 13, चौदह: 14, पंद्रह: 15, सोलह: 16, सत्रह: 17, अठारह: 18, उन्नीस: 19,
  बीस: 20, इक्कीस: 21, बाईस: 22, तेईस: 23, चौबीस: 24, पच्चीस: 25, छब्बीस: 26, सत्ताईस: 27, अट्ठाईस: 28, उनतीस: 29,
  तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80, नब्बे: 90, सौ: 100, ट्वेंटी: 20,
};
export const asciiNumberText = (text: string): string => text.normalize("NFKC").toLowerCase()
  .replace(/[০-৯]/gu, c => String(c.charCodeAt(0) - 0x09e6)).replace(/[०-९]/gu, c => String(c.charCodeAt(0) - 0x0966));

export function spokenNumberToken(token: string): number | undefined {
  const value = asciiNumberText(token);
  if (/^\d+$/u.test(value)) return Number(value);
  if (cardinals[value] !== undefined) return cardinals[value];
  // Reuse existing English/Assamese/phonetic digit vocabulary without its
  // telephone multipliers or assumptions about a complete phone number.
  const digit = normalizePhoneNumber(value);
  return digit.digitCount === 1 && !digit.unrecognizedTokens.length && !digit.hasPendingMultiplier ? Number(digit.digits) : undefined;
}
export type SpokenNumber = { kind: "value"; value: number } | { kind: "invalid" | "unknown" };
export function spokenNumber(text: string): SpokenNumber {
  const normalized = asciiNumberText(text).trim().replace(/[?？!।]+$/u, "")
    .replace(/\s*(?:years?(?:\s+old)?|বছৰ|वर्ष|साल)\s*$/u, "").trim();
  if (/\d[.,]\d/u.test(normalized) || /^\s*-\s*\d/u.test(normalized)) return { kind: "invalid" };
  const tokens = normalized.replace(/([\p{L}\p{M}])(\d)|(\d)([\p{L}\p{M}])/gu, "$1$3 $2$4")
    .replace(/[-,]/gu, " ").split(/\s+/u).filter(token => token && token !== "and");
  const values = tokens.map(spokenNumberToken);
  if (!tokens.length || values.some(v => v === undefined)) return { kind: "unknown" };
  const nums = values as number[];
  if (nums.length === 1) return { kind: "value", value: nums[0]! };
  if (nums.every(n => n < 10)) return { kind: "value", value: Number(nums.join("")) };
  const tail = (parts: number[]): number | undefined => {
    if (parts.length === 1) return parts[0];
    if (parts.length === 2 && parts[0]! >= 20 && parts[0]! % 10 === 0 && parts[1]! < 10) return parts[0]! + parts[1]!;
    return undefined;
  };
  let value: number | undefined;
  if (nums[1] === 100 && nums[0]! >= 1 && nums[0]! < 10) {
    const remainder = nums.length === 2 ? 0 : tail(nums.slice(2));
    if (remainder !== undefined) value = nums[0]! * 100 + remainder;
  } else if (!/^\d/u.test(tokens[0]!)) value = tail(nums);
  return value === undefined ? { kind: "invalid" } : { kind: "value", value };
}

/** Normalize known cardinal words in clock expressions, preserving other text. */
export function clockNumberText(text: string): string {
  const value = asciiNumberText(text);
  const tokens = [...value.matchAll(/\d+|[\p{L}\p{M}]+/gu)];
  let result = "", end = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!, raw = token[0], number = spokenNumberToken(raw.replace(/টা$/u, ""));
    result += value.slice(end, token.index);
    const next = tokens[i + 1], unit = next ? spokenNumberToken(next[0]) : undefined;
    if (number !== undefined && number >= 20 && number < 100 && number % 10 === 0 && !/^\d/u.test(raw)
      && next && unit !== undefined && unit < 10 && /^[\s-]*$/u.test(value.slice(token.index + raw.length, next.index))) {
      result += String(number + unit); end = next.index + next[0].length; i++;
    } else { result += number === undefined ? raw : String(number); end = token.index + raw.length; }
  }
  return result + value.slice(end);
}
