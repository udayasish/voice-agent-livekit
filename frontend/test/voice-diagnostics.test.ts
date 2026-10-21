import assert from "node:assert/strict";
import { test } from "node:test";
import { toolActivitiesSchema, selectedDoctorSchema, toolActivityLabel, replyBadge, voiceStatusSchema, turnVoiceSchema, voiceStatusLabel } from "../src/lib/voice-diagnostics.js";

test("execution success does not display an empty doctor lookup as a match", () => {
  const tools = toolActivitiesSchema.parse([{ name: "find_doctor", success: true, outcome: "not_found", resultCount: 0 }, { name: "find_doctor", success: true, outcome: "matched", resultCount: 1 }]);
  assert.equal(toolActivityLabel(tools[0]!), "! find_doctor · not found · 0 results");
  assert.equal(toolActivityLabel(tools[1]!), "✓ find_doctor · matched · 1 result");
  assert.equal(toolActivitiesSchema.safeParse([{ name: "find_doctor", success: true, resultCount: -1 }]).success, false);
  assert.equal(toolActivitiesSchema.safeParse([{ name: "find_doctor", success: true, transcript: "private" }]).success, false);
});
test("legacy tool messages remain valid and reviewed doctor names parse independently", () => {
  assert.equal(toolActivitiesSchema.safeParse([{ name: "find_doctor", success: true }]).success, true);
  assert.equal(selectedDoctorSchema.parse({ id: "d93d955f-7355-4604-8b4f-4e29b56b9a96", name: "ডাঃ বৰুৱা", nameEn: "Dr. Baruah", nameAs: "ডাঃ বৰুৱা" }).nameEn, "Dr. Baruah");
  assert.equal(toolActivityLabel({ name: "book_appointment", success: true, outcome: "unavailable" }).startsWith("!"), true);
});
test("verified tool replies and generation recovery have distinct truthful labels", () => {
  assert.equal(replyBadge("verified_tool", "empty_output").label, "Verified reply");
  assert.equal(replyBadge("recovery", "provider_error").label, "Recovery");
  assert.doesNotMatch(replyBadge("recovery", "empty_output").title, /after one retry/u);
});


test("recovery and confirmation diagnostics accept only safe known categories", () => {
  assert.equal(voiceStatusSchema.safeParse({ category: "recognition_recovery", inputMode: "english-digits" }).success, true);
  assert.equal(voiceStatusSchema.safeParse({ category: "private provider body" }).success, false);
  assert.equal(turnVoiceSchema.parse({ confirmationStage: "phone" }).confirmationStage, "phone");
  assert.match(voiceStatusLabel("playback_failure"), /failed/u);
  assert.match(voiceStatusLabel("speech_unclear"), /repeat/u);
  assert.equal(voiceStatusLabel("untrusted"), "");
});

test("provider limit categories are distinct from unclear speech and TTFT is optional", () => {
  const turn = turnVoiceSchema.parse({ failureCategory: "request_limit" });
  assert.equal(turn.providerTtftMs, undefined);
  assert.match(voiceStatusLabel(turn.failureCategory!), /request limit/u);
  assert.match(voiceStatusLabel("rate_limit"), /rate limited/u);
  assert.equal(turnVoiceSchema.safeParse({ failureCategory: "private error body" }).success, false);
});

test("listening readiness is a distinct safe status, not inferred from room connection", () => {
  assert.equal(voiceStatusSchema.safeParse({ category: "listening_ready" }).success, true);
  assert.match(voiceStatusLabel("listening_ready"), /can speak/u);
});

test("a worker transcript packet retains provider diagnostics without copying its private payload", () => {
  const diagnostics = turnVoiceSchema.parse({ type: "transcript_turn", turnId: 7,
    userText: "synthetic patient details", responseText: "Please try again later",
    failureCategory: "rate_limit", providerTtftMs: 125, confirmationStage: "phone", inputMode: "conversation" });
  assert.equal(diagnostics.failureCategory, "rate_limit");
  assert.equal(diagnostics.providerTtftMs, 125);
  assert.equal(diagnostics.confirmationStage, "phone");
  assert.equal("userText" in diagnostics, false);
  assert.equal("responseText" in diagnostics, false);
  assert.equal(turnVoiceSchema.safeParse({ failureCategory: "raw provider body" }).success, false);
});
