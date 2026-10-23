import { z } from "zod";
export const voiceStatusSchema = z.object({ category: z.enum(["admission_failed", "listening_ready", "speech_unclear", "no_transcript", "no_input", "provider_failure", "playback_failure", "recognition_failure", "recognition_recovery", "recognition_conflict", "input_mode_changed"]),
  inputMode: z.enum(["conversation", "english-digits"]).optional() });
export const turnVoiceSchema = z.object({ inputMode: z.enum(["conversation", "english-digits"]).optional(),
  failureCategory: z.enum(["request_limit", "rate_limit", "authentication", "unavailable", "network", "timeout", "protocol", "http", "sdk_limit", "sdk_or_provider", "interpretation_failed"]).optional(),
  providerTtftMs: z.number().nonnegative().optional(),
  confirmationStage: z.enum(["none", "phone", "action", "confirmed"]).optional(), recoveryCategory: z.enum(["speech_unclear", "no_transcript", "no_input", "provider_failure"]).optional() });
export function voiceStatusLabel(category: string) {
  return ({ admission_failed: "Agent unavailable or settings changed. End this session and start again.", listening_ready: "Agent listening — you can speak", speech_unclear: "Speech unclear — please repeat", no_transcript: "Speech detected — no transcript", no_input: "Waiting for your response",
    provider_failure: "Response processing failed", request_limit: "Response request limit reached", rate_limit: "Response service rate limited",
    authentication: "Response provider configuration failed", unavailable: "Response provider unavailable", timeout: "Response timed out",
    network: "Response connection failed", protocol: "Invalid provider response", http: "Response request rejected",
    sdk_limit: "Tool conversation limit reached", sdk_or_provider: "Response generation failed", interpretation_failed: "Could not process the details yet",
    playback_failure: "Audio delivery failed", recognition_failure: "Speech recognition unavailable",
    recognition_recovery: "Checking speech in conversation language", recognition_conflict: "Recognition disagreed — please clarify", input_mode_changed: "Listening mode updated" } as Record<string, string>)[category] ?? "";
}

export const toolActivitiesSchema = z.array(z.object({ name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u), success: z.boolean(),
  code: z.string().regex(/^[A-Z_]{1,64}$/u).optional(), resultCount: z.number().int().nonnegative().optional(),
  outcome: z.enum(["confirmation_required", "booked", "unavailable", "cancelled", "listed", "matched", "ambiguous", "not_found", "inactive", "dates_available", "times_available", "no_availability", "service_error", "disabled"]).optional() }).strict());
export const selectedDoctorSchema = z.object({ id: z.string().uuid(), name: z.string(), nameEn: z.string().nullable().optional(), nameAs: z.string().nullable().optional() });
export function toolActivityLabel(tool: z.infer<typeof toolActivitiesSchema>[number]) {
  const success = tool.success && !["unavailable", "not_found", "inactive", "no_availability", "service_error", "disabled"].includes(tool.outcome ?? "");
  return `${success ? "✓" : "!"} ${tool.name}${tool.outcome ? ` · ${tool.outcome.replaceAll("_", " ")}` : ""}${tool.resultCount !== undefined ? ` · ${tool.resultCount} result${tool.resultCount === 1 ? "" : "s"}` : ""}${tool.code ? ` · ${tool.code}` : ""}`;
}
export function replyBadge(source?: string, reason?: string) {
  if (source === "verified_tool") return { label: "Verified reply", title: "Reply rendered from verified business state or tool results." };
  return { label: "Recovery", title: reason === "empty_output" ? "The AI returned no usable spoken reply. Executed tool sequences are never restarted for speech."
    : reason === "provider_error" ? "Model generation failed; a recovery reply was used."
      : reason === "repeated_response" ? "A repeated reply was replaced." : "A recovery response was used." };
}
