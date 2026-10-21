/** Select complete model-written sentences; critical readbacks never pass here. */
export function conciseClinicSpeech(text: string, fallback: () => string): { text: string; fallback: boolean } {
  const sentences = text.trim().split(/(?<=[।!?])\s*|(?<!\b[Dd]r\.)(?<=[^\d]\.)\s+(?=[\p{Lu}\p{Script=Bengali}])/u).filter(Boolean);
  const short = (value: string) => value.split(/\s+/u).length <= 28;
  const first = sentences.slice(0, 2).join(" ");
  if (first && short(first)) return { text: first, fallback: false };
  const question = [...sentences].reverse().find(sentence => /[?？]$/u.test(sentence));
  if (question && short(question)) return { text: question, fallback: false };
  return { text: fallback(), fallback: true };
}
