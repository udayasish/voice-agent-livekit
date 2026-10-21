/** Shared phone-readback interpretation; negation takes precedence over affirmations. */
export function phoneConfirmation(text: string): "yes" | "no" | undefined {
  const words = text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const negative = new Set(["নহয়", "নহয়", "নো", "নৌ", "নাই", "ভুল", "অশুদ্ধ", "no", "not", "incorrect", "wrong", "নहीं", "नहीं", "गलत"]);
  if (words.some(word => negative.has(word))) return "no";
  if (/[?？]/u.test(text) || words.some(word => ["হয়তো", "হয়তো", "maybe", "perhaps", "unsure", "शायद"].includes(word))) return undefined;
  const positive = new Set(["হয়", "হয়", "হঁয়", "ঠিক", "শুদ্ধ", "yes", "correct", "right", "हाँ", "हां", "सही"]);
  return words.some(word => positive.has(word)) ? "yes" : undefined;
}
