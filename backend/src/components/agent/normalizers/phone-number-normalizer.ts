/**
 * Assamese & English phonetic phone number normalization module.
 * Converts spoken digit words, phonetic transliterations (e.g. "ছেভেন ডাবল জিৰ'..."),
 * and Indic numeral sequences into validated, formatted 10-digit telephone strings.
 */

export interface PhoneNumberResult {
  isValid: boolean;
  digits: string;
  formatted: string;
  rawText: string;
  digitCount: number;
  hasRepeatedDigits: boolean;
}

/**
 * Mapping of Assamese phonetic, native Assamese, and English digit words to single ASCII digits.
 */
const DIGIT_WORD_MAP: Readonly<Record<string, string>> = {
  // English words transliterated into Assamese script
  "জিৰ'": "0",
  "জিৰো": "0",
  "জীৰ'": "0",
  "জীৰো": "0",
  "ৱান": "1",
  "ওয়ান": "1",
  "টু": "2",
  "টূ": "2",
  "থ্ৰী": "3",
  "থ্রি": "3",
  "ফ'ৰ": "4",
  "ফোৰ": "4",
  "ফোর": "4",
  "ফাইভ": "5",
  "ছিক্স": "6",
  "সিক্স": "6",
  "ছেভেন": "7",
  "সেভেন": "7",
  "এইট": "8",
  "নাইন": "9",

  // Native Assamese numeral words
  "শূন্য": "0",
  "হুণ্য": "0",
  "এক": "1",
  "দুই": "2",
  "তিনি": "3",
  "চাৰি": "4",
  "পাঁচ": "5",
  "পাচ": "5",
  "ছয়": "6",
  "ছয়": "6",
  "সাত": "7",
  "আঠ": "8",
  "ন": "9",
  "নও": "9",

  // English words
  "zero": "0",
  "one": "1",
  "two": "2",
  "three": "3",
  "four": "4",
  "five": "5",
  "six": "6",
  "seven": "7",
  "eight": "8",
  "nine": "9",

  // Assamese / Bengali script numerals (U+09E6 to U+09EF)
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

/**
 * Recognizes repeat multipliers such as "double" or "triple".
 */
const MULTIPLIER_MAP: Readonly<Record<string, number>> = {
  "ডাবল": 2,
  "ডবল": 2,
  "double": 2,
  "ট্ৰিপল": 3,
  "ট্রিপল": 3,
  "triple": 3,
};

/**
 * Normalizes input text containing spoken phonetic phone numbers into digits.
 */
export function normalizePhoneNumber(text: string): PhoneNumberResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      isValid: false,
      digits: "",
      formatted: "",
      rawText: text,
      digitCount: 0,
      hasRepeatedDigits: false,
    };
  }

  // Pre-clean punctuation while keeping token boundaries
  // Remove danda, commas, periods, quotes, but keep alphanumeric + Assamese characters
  const cleaned = trimmed
    .replace(/[।॥,;:"?!=+()[\]{}]/g, " ")
    .replace(/\s+/g, " ");

  const rawTokens = cleaned.split(" ").filter((t) => t.length > 0);
  const digitAcc: string[] = [];
  let pendingMultiplier = 1;
  let hasRepeatedDigits = false;

  for (let i = 0; i < rawTokens.length; i++) {
    const rawToken = rawTokens[i]!;
    // Strip trailing apostrophes (e.g. জিৰ' -> জিৰ', but clean trailing quotes)
    const token = rawToken.toLowerCase();

    // Check if token is a multiplier
    const multiplier = MULTIPLIER_MAP[token];
    if (multiplier !== undefined) {
      pendingMultiplier = multiplier;
      hasRepeatedDigits = true;
      continue;
    }

    // Check if token matches our digit word map
    const mappedDigit = DIGIT_WORD_MAP[token];
    if (mappedDigit !== undefined) {
      for (let m = 0; m < pendingMultiplier; m++) {
        digitAcc.push(mappedDigit);
      }
      pendingMultiplier = 1;
      continue;
    }

    // Check if token is already ASCII digits (e.g. "70020", "2", "9544")
    if (/^\d+$/.test(token)) {
      if (pendingMultiplier > 1 && token.length === 1) {
        for (let m = 0; m < pendingMultiplier; m++) {
          digitAcc.push(token);
        }
      } else {
        digitAcc.push(token);
      }
      pendingMultiplier = 1;
      continue;
    }

    // Token did not match a digit or multiplier; reset pending multiplier
    pendingMultiplier = 1;
  }

  let finalDigits = digitAcc.join("");

  // Remove leading country code if present (+91 or 91 with 12 total digits, or leading 0 with 11 digits)
  if (finalDigits.length === 12 && finalDigits.startsWith("91")) {
    finalDigits = finalDigits.slice(2);
  } else if (finalDigits.length === 11 && finalDigits.startsWith("0")) {
    finalDigits = finalDigits.slice(1);
  }

  // Standard Indian mobile number validation: 10 digits starting with 6, 7, 8, or 9
  const isValid = /^[6-9]\d{9}$/.test(finalDigits);

  // Group into readable pairs/blocks (e.g. "70020 59544") for clear TTS pronunciation
  let formatted = finalDigits;
  if (finalDigits.length === 10) {
    formatted = `${finalDigits.slice(0, 5)} ${finalDigits.slice(5)}`;
  }

  return {
    isValid,
    digits: finalDigits,
    formatted,
    rawText: text,
    digitCount: finalDigits.length,
    hasRepeatedDigits,
  };
}

/**
 * Checks whether an utterance appears to contain a phone number or numeric contact sequence.
 */
export function containsPhoneNumberCandidate(text: string): boolean {
  const lower = text.toLowerCase();
  // Check for common Assamese or English phone keyword markers
  const hasPhoneMarker =
    lower.includes("ফোন") ||
    lower.includes("নম্বৰ") ||
    lower.includes("নম্বর") ||
    lower.includes("phone") ||
    lower.includes("mobile") ||
    lower.includes("number");

  // Check for digit words or numeric characters
  const hasDigitTokens =
    /\d/.test(lower) ||
    lower.includes("ছেভেন") ||
    lower.includes("সেভেন") ||
    lower.includes("জিৰ'") ||
    lower.includes("নাইন") ||
    lower.includes("ফাইভ") ||
    lower.includes("ফ'ৰ") ||
    lower.includes("টু") ||
    lower.includes("শূন্য") ||
    lower.includes("ডাবল") ||
    lower.includes("double");

  return hasPhoneMarker || hasDigitTokens;
}

/**
 * Formats a normalized phone number into phonetic Assamese readout words for natural speech synthesis.
 * e.g. "7002059544" -> "সাত শূন্য শূন্য দুই শূন্য, পাঁচ নয় পাঁচ চাৰি চাৰি"
 */
export function formatPhoneNumberForSpeech(digits: string): string {
  const DIGIT_SPEECH_MAP: Readonly<Record<string, string>> = {
    "0": "শূন্য",
    "1": "এক",
    "2": "দুই",
    "3": "তিনি",
    "4": "চাৰি",
    "5": "পাঁচ",
    "6": "ছয়",
    "7": "সাত",
    "8": "আঠ",
    "9": "ন",
  };

  if (!/^\d+$/.test(digits)) {
    return digits;
  }

  const words = Array.from(digits).map((d) => DIGIT_SPEECH_MAP[d] ?? d);
  if (words.length === 10) {
    const firstGroup = words.slice(0, 5).join(" ");
    const secondGroup = words.slice(5).join(" ");
    return `${firstGroup}, ${secondGroup}`;
  }

  return words.join(" ");
}

/**
 * Convenience extractor that extracts and normalizes a 10-digit phone number, or returns null if invalid.
 */
export function extractAssamesePhoneNumber(text: string): string | null {
  const result = normalizePhoneNumber(text);
  return result.isValid ? result.digits : null;
}

/**
 * Convenience normalizer returning the extracted digits string directly.
 */
export function normalizeAssamesePhoneNumber(text: string): string {
  const result = normalizePhoneNumber(text);
  return result.digits;
}
