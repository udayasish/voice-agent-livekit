import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeJwt } from "jose";
import { openClinicTestDatabase, createClinicFixture, removeClinicFixtures } from "./clinic-test-db.js";
import { clinicToolNames } from "../src/components/clinic/voice/names.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";

test("token issuer → one-use Redis binding → real worker session factory → SDK clinic tool → Redis cleanup", async () => {
  const database = await openClinicTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "clinic-voice-profile-"));
  const profilePath = join(folder, "profiles.json");
  const fixture = await createClinicFixture(database.db);
  process.env["DATABASE_URL"] = database.url;
  process.env["VOICE_AGENT_PROFILES_PATH"] = profilePath;
  await writeFile(profilePath, JSON.stringify([{ organizationId: fixture.organization.id, agentId: "default", business: "clinic", appointmentsEnabled: true, enabledTools: clinicToolNames }]));
  const { redis, connectRedis } = await import("../src/lib/redis.js");
  const { pool } = await import("../src/lib/db/db.js");
  const { createToken } = await import("../src/components/livekit/services/create-token.js");
  const { consumeRuntimeBinding } = await import("../src/components/agent/runtime-binding.js");
  const { createBoundVoiceSession } = await import("../src/agent/create-session.js");
  const { RedisSessionStore } = await import("../src/components/agent/session-store.js");
  await connectRedis();
  try {
    const token = await createToken({}, { id: randomUUID(), email: "synthetic@example.test", name: "Test operator", status: "active" },
      { id: fixture.organization.id, name: fixture.organization.name, businessType: "clinic", role: "owner" });
    const claims = decodeJwt(token.token);
    assert.equal(typeof claims["metadata"], "string");
    const binding = await consumeRuntimeBinding(redis, String(claims["metadata"]), token.roomName, token.participantIdentity);
    assert.equal(binding.profile.enabledTools.length, 8);
    await assert.rejects(consumeRuntimeBinding(redis, String(claims["metadata"]), token.roomName, token.participantIdentity));
    const provider = new ScriptedProvider(messages => {
      assert.ok(messages.some(message => message.role === "tool"));
      return [{ type: "text", delta: "Asha Basu. Which doctor would you like to see?" }, { type: "done" }];
    });
    const session = await createBoundVoiceSession(provider, binding, new RedisSessionStore(redis));
    try {
      await session.ready;
      await session.processUserUtterance("List doctors", {});
      assert.equal(session.getSnapshot().conversation.toolHistory[0]!.result.success, true);
      assert.equal(session.getSnapshot().context.organizationId, fixture.organization.id);
      assert.deepEqual(provider.options[0]!.tools?.map(tool => tool.name), ["list_doctors"]);
      assert.equal(session.getSnapshot().conversation.toolHistory.length, 1);
      assert.equal(provider.inputs.length, 1);
    } finally { await session.close(); }
    const keys = await redis.keys(`agent-session:${fixture.organization.id}:*`); assert.equal(keys.length, 0);
  } finally {
    await redis.quit(); await pool.end();
    await removeClinicFixtures(database.db, [fixture.organization.id]); await database.pool.end();
    await unlink(profilePath); await rmdir(folder);
  }
});
