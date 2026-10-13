import type { AgentConfig, AgentLanguage } from "./config.js";
import type { LLMChunk } from "../providers/llm/types.js";

export function normalizeSpokenText(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/giu, "")
    .replace(/<[^>]*>/gu, "")
    .replace(/^\s*(?:[-*#]+|\d+\.)\s+/gmu, "")
    .replace(/[*#`_]/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/gu, " ").trim();
}
export function recoveryResponse(config: AgentConfig, language: AgentLanguage, previous?: string): string {
  const primary = config.recoveryMessages[language];
  if (primary !== previous) return primary;
  return {
    as: "মই আপোনাৰ কথাটো স্পষ্টকৈ বুজিব পৰা নাই। অনুগ্ৰহ কৰি অলপ ধীৰে আকৌ কওক।",
    hi: "मैं आपकी बात समझ नहीं पाया। कृपया थोड़ा धीरे दोबारा बताएं।",
    en: "I haven't understood your request. Please say it again a little more slowly.",
  }[language];
}
export function applyResponsePolicy(text: string, config: AgentConfig, language: AgentLanguage): string {
  return normalizeSpokenText(text) || config.recoveryMessages[language];
}
/** Speech only sees approved text, including when a policy replaces model output. */
export async function* replayResponse(text: string): AsyncIterable<LLMChunk> {
  const words = text.match(/\S+\s*/gu) ?? [];
  for (const delta of words) yield { type: "text", delta };
  yield { type: "done" };
}
