import { createConfirmationInterpreter, type ConfirmationInput } from "../../src/components/clinic/voice/interpreter.js";
import { ScriptedProvider } from "./scripted-provider.js";
import { normalizePhoneNumber } from "../../src/components/agent/normalizers/index.js";

/** Deterministic model fixture, not production language interpretation. Exercises the real SDK. */
export const fixtureInterpreter = createConfirmationInterpreter(new ScriptedProvider(messages => {
  const input = JSON.parse(messages[0]!.content) as ConfirmationInput;
  const text = input.text;
  const targetId = input.draft?.id ?? input.activeCandidateId;
  const number = normalizePhoneNumber(text);
  let intent = "unclear", replacementText: string | null = null;
  if (number.isValid && !number.unrecognizedTokens.length) { intent = "replace_number"; replacementText = text; }
  else if (["হয় শুদ্ধ, নম্বৰটো শুদ্ধ।", "হয় শুদ্ধ।", "হয়।", "yes", "yes please", "হয় শুদ্ধ, বুক কৰক।", "হয় বুক কৰক।", "হয় বাতিল কৰক।", "হয় শুদ্ধ", "হয়, শুদ্ধ।", "हाँ सही"].includes(text)) intent = "confirm";
  else if (["no", "not correct", "হয় নহয়"].includes(text)) intent = "reject";
  return [{ type: "text", delta: JSON.stringify({ intent, targetId: intent === "unclear" ? null : targetId,
    evidence: intent === "unclear" ? "" : text, replacementText }) }, { type: "done" }];
}));
