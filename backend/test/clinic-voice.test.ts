import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { confirmation, normalizeDoctorName } from "../src/components/clinic/voice/confirmation.js";
import { ClinicVoiceRuntime } from "../src/components/clinic/voice/runtime.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";
import { voiceProfilesSchema, selectVoiceProfile } from "../src/components/agent/profiles.js";
import { issueRuntimeBinding, consumeRuntimeBinding, type BindingStore } from "../src/components/agent/runtime-binding.js";
import { ToolExecutor } from "../src/components/agent/tools/executor.js";
import type { Database } from "../src/lib/db/transaction-with-hooks.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { MockLLMProvider } from "../src/components/agent/providers/llm/mock.js";

test("clinic voice adapters reuse service contracts without SQL/client/transport imports", () => {
  const root = fileURLToPath(new URL("../src/components/clinic/voice/", import.meta.url));
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith(".ts")) continue;
    const source = readFileSync(join(root, entry), "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/gu)) assert.doesNotMatch(match[1]!, /drizzle-orm|^pg$|\/lib\/db\/db|livekit|whatsapp-appointment-platform|env\.js/u);
    assert.doesNotMatch(source, /\.(?:select|insert|update|delete)\(\)\.from\(/u);
  }
});

test("confirmation accepts Assamese, Hindi and English and rejects negation, corrections and uncertainty", () => {
  for (const text of ["হয় শুদ্ধ।", "হয়, বুক কৰক।", "yes please", "हाँ सही"]) assert.equal(confirmation(text), "yes", text);
  for (const text of ["হয় নহয়", "no", "गलत", "not correct"]) assert.equal(confirmation(text), "no", text);
  for (const text of ["maybe", "yes tomorrow", "হয় ১১ বজাত", "correct?", ""]) assert.equal(confirmation(text), undefined, text);
});
test("spoken titles normalize without fuzzy doctor selection", () => {
  assert.equal(normalizeDoctorName(" Dr.  Asha   Basu ".trim()), "Asha Basu");
  assert.equal(normalizeDoctorName("ডঃ বৰুৱা"), "বৰুৱা");
  assert.equal(normalizeDoctorName("অচিনাকি"), "অচিনাকি");
  assert.equal(normalizeDoctorName("Dravid Baruah"), "Dravid Baruah");
  assert.equal(normalizeDoctorName("Dr.Asha"), "Asha");
});
test("profiles are tenant scoped, default empty, capability intersected, and reject invalid definitions", () => {
  const organizationId = randomUUID();
  const profile = { organizationId, agentId: "default", business: "clinic", appointmentsEnabled: true, enabledTools: [...clinicToolNames] };
  const profiles = voiceProfilesSchema.parse([profile]);
  assert.deepEqual(selectVoiceProfile([], organizationId, "hotel").enabledTools, []);
  assert.equal(selectVoiceProfile(profiles, organizationId, "clinic").enabledTools.length, 8);
  assert.deepEqual(selectVoiceProfile(voiceProfilesSchema.parse([{ ...profile, appointmentsEnabled: false }]), organizationId, "clinic").enabledTools, []);
  assert.throws(() => selectVoiceProfile(profiles, randomUUID(), "clinic", "default"));
  assert.throws(() => selectVoiceProfile(profiles, organizationId, "hotel"));
  for (const value of [[profile, profile], [{ ...profile, enabledTools: ["query_database"] }], [{ ...profile, secret: true }], [{ ...profile, enabledTools: ["list_doctors", "list_doctors"] }]]) assert.equal(voiceProfilesSchema.safeParse(value).success, false);
});
test("one-use binding contains server identity, expires and rejects cross-room/participant or forged metadata", async () => {
  const records = new Map<string, string>();
  let expiry = 0;
  const store: BindingStore = { set: async (key, value, options) => { records.set(key, value); expiry = options.EX; },
    getDel: async key => { const value = records.get(key); records.delete(key); return value ?? null; }, del: async key => { records.delete(key); } };
  const organizationId = randomUUID();
  const agentId = randomUUID();
  const binding = { schemaVersion: 2 as const, organizationId, userId: randomUUID(), agentId, sessionId: randomUUID(), callId: randomUUID(), conversationId: randomUUID(),
    roomName: "scoped-room", participantIdentity: "caller", profile: { organizationId, agentId, version: 1, name: "Clinic receptionist", isActive: true,
      instructions: "", greeting: "", languages: ["as" as const], defaultLanguage: "as" as const, enabledTools: [...clinicToolNames],
      workingHours: { mode: "always_open" as const }, humanContact: { mode: "disabled" as const }, business: "clinic" as const,
      appointmentsEnabled: true, timezone: "Asia/Kolkata", businessName: "Clinic" } };
  const id = await issueRuntimeBinding(store, binding);
  assert.equal(expiry, 900);
  assert.deepEqual(await consumeRuntimeBinding(store, JSON.stringify({ runtimeBindingId: id }), "scoped-room", "caller"), binding);
  await assert.rejects(consumeRuntimeBinding(store, JSON.stringify({ runtimeBindingId: id }), "scoped-room", "caller"));
  const other = await issueRuntimeBinding(store, binding);
  await assert.rejects(consumeRuntimeBinding(store, JSON.stringify({ runtimeBindingId: other }), "another-room", "caller"));
  const third = await issueRuntimeBinding(store, binding);
  await assert.rejects(consumeRuntimeBinding(store, JSON.stringify({ runtimeBindingId: third }), "scoped-room", "intruder"));
  await assert.rejects(consumeRuntimeBinding(store, JSON.stringify({ runtimeBindingId: third, organizationId }), "scoped-room", "caller"));
});
test("clinic registers exactly eight strict tools; extra fields, spoofed context, disabled and unknown tools fail before database access", async () => {
  const context = { organizationId: randomUUID(), agentId: "test", sessionId: randomUUID() };
  const callId = randomUUID(), conversationId = randomUUID();
  const runtime = new ClinicVoiceRuntime(context, callId, conversationId, { db: {} as Database,
    transaction: async () => { throw new Error("Database must not execute"); }, logger: { info() {}, warn() {}, error() {} } });
  assert.equal(runtime.registry.enabled([...clinicToolNames]).length, 8);
  runtime.behavior.onTurn?.("hello", 1);
  const executor = new ToolExecutor(runtime.registry, [], { ...context, callId, conversationId, turnId: 1 }, new AbortController().signal);
  assert.equal((await executor.execute("list_doctors", {}, "disabled")).success, false);
  assert.equal((await executor.execute("run_sql", {}, "unknown")).success, false);
  for (const name of clinicToolNames) assert.throws(() => runtime.registry.get(name)!.validate({ organizationId: randomUUID() }));
  const allowed = new ToolExecutor(runtime.registry, ["list_doctors"], { ...context, organizationId: randomUUID(), callId, conversationId, turnId: 1 }, new AbortController().signal);
  const result = await allowed.execute("list_doctors", {}, "spoof");
  assert.equal(result.success, false);
  assert.equal(JSON.stringify(result).includes("Database must"), false);
});

test("tool-free clinic agents use a grounded capability reply instead of model-invented services", async () => {
  const context = { organizationId: randomUUID(), agentId: randomUUID(), sessionId: randomUUID() };
  const runtime = new ClinicVoiceRuntime(context, randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("Database must not execute"); }, logger: { info() {}, warn() {}, error() {} } },
    "Asia/Kolkata", undefined, undefined, []);
  for (const [turnId, utterance] of ["হেল্ল'", "ক্লিনিকত কি সেৱা আছে?", "এপইণ্টমেণ্ট বুক কৰক"].entries()) {
    const options = await runtime.behavior.onTurn?.(utterance, turnId + 1);
    const reply = runtime.behavior.preparedReply?.("as");
    assert.deepEqual(options, { allowedTools: [] });
    assert.equal(reply?.source, "verified_tool");
    assert.match(reply?.text ?? "", /সক্ৰিয় কৰা হোৱা নাই/u);
    assert.doesNotMatch(reply?.text ?? "", /লেব|হৃদ|শিশু|কোন.*ডাক্তৰ/u);
  }
});

test("a model-spoken phone question enables digit listening and captures fragments without a resolver call", async () => {
  const context = { organizationId: randomUUID(), agentId: "test", sessionId: randomUUID() };
  const runtime = new ClinicVoiceRuntime(context, randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("No database operation is authorized"); }, logger: { info() {}, warn() {}, error() {} } });
  const session = new AgentSession({ agentId: context.agentId, name: "Reception", businessName: "Test clinic", instructions: "Ask one question.",
    languages: ["as", "en"], defaultLanguage: "as" }, context,
    new MockLLMProvider({ fixedResponse: "ঠিক আছে। প্ৰথমে আপোনাৰ ফোন নম্বৰটো দিব পাৰিবনে?" }), runtime.behavior);
  try {
    await session.processUserUtterance("হেল্ল'");
    assert.equal(runtime.snapshot().collectingPhone, true);
    assert.equal(session.getState().businessState.collectingPhone, true);
    const partial = await session.processUserUtterance("7 double 0 2 0", { responseLanguage: "as" });
    assert.match(partial.text, /5টা/u);
    assert.equal(runtime.snapshot().collectingPhone, true);
    const complete = await session.processUserUtterance("5 9 5 double 4", { responseLanguage: "as" });
    assert.equal(runtime.snapshot().slots.phoneNumber, "7002059544");
    assert.equal(runtime.snapshot().collectingPhone, false);
    assert.equal(runtime.snapshot().phoneConfirmed, false);
    assert.equal(runtime.snapshot().patientId, null);
    assert.match(complete.text, /শুদ্ধনে/u);
  } finally { await session.close(); }
});

test("mentioning a phone without asking for it does not activate dictation", () => {
  const context = { organizationId: randomUUID(), agentId: "test", sessionId: randomUUID() };
  const runtime = new ClinicVoiceRuntime(context, randomUUID(), randomUUID(), { db: {} as Database,
    transaction: async () => { throw new Error("No database operation is authorized"); }, logger: { info() {}, warn() {}, error() {} } });
  const state = runtime.behavior.onResponse!("Your phone is confirmed.", runtime.snapshot());
  assert.equal(state.collectingPhone, false);
  assert.equal(state.phoneConfirmed, false);
  assert.equal(state.patientId, null);
});
