/** Deliberately conservative: reject corrections, mixed requests and uncertainty. */
export function confirmation(text: string): "yes" | "no" | undefined {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[।.!,'’]/gu, " ").trim();
  const words = normalized.split(/\s+/u);
  if (words.some(w => ["নহয়", "নহয়", "নাই", "ভুল", "no", "not", "wrong", "नहीं", "गलत"].includes(w))) return "no";
  if (/[?？\d০-৯]/u.test(normalized)) return undefined;
  const yes = new Set(["হয়", "হয়", "শুদ্ধ", "ঠিক", "কৰক", "কৰি", "দিয়ক", "নিশ্চিত", "বুক", "বাতিল", "yes", "correct", "right", "confirm", "please", "book", "it", "cancel", "হাঁ", "हाँ", "हां", "सही"]);
  return words.length > 0 && words.every(w => yes.has(w)) ? "yes" : undefined;
}
export { normalizeDoctorName } from "../doctor-names.js";

/** Bounded speech safeguard; it does not interpret or authorize caller actions. */
export function containsCompletionClaim(text: string, confirmedPhone = false): boolean {
  let positive = text.replace(/\b(?:not|never)(?:\s+(?:yet|been|already|successfully|has|have|was|is)){0,4}\s+(?:booked|cancelled|canceled|confirmed)\b/giu, "")
    .replace(/বুক\s*হোৱা\s*নাই|বাতিল\s*কৰা\s*হোৱা\s*নাই|নিশ্চিত\s*কৰা\s*হোৱা\s*নাই/gu, "")
    .replace(/बुक\s*(?:हुआ|हो)\s*नहीं|रद्द\s*(?:हुआ|किया)\s*नहीं/gu, "");
  // A verified phone acknowledgement is not an appointment outcome. Only
  // exempt phone-only sentences when server state has actually confirmed it.
  if (confirmedPhone) positive = positive.split(/(?<=[.!?।])\s*/u).map(sentence =>
    /\b(?:phone|mobile)\b|ফোন|মোবাইল/iu.test(sentence)
      && !/\b(?:appointment|booking|reservation)\b|এপইণ্ট|বুকিং|অ্যাপয়েন্ট/iu.test(sentence)
      ? sentence.replace(/\bconfirmed\b|নিশ্চিত কৰা/giu, "") : sentence).join(" ");
  return /\b(?:booked|cancelled|canceled|confirmed)\b|বুক হ|বাতিল কৰা|নিশ্চিত কৰা|बुक हो|बुक हुआ|रद्द कर/iu.test(positive);
}
