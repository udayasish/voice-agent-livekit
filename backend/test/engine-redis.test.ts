import { it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { AgentSession, SESSION_TTL_SECONDS, sessionKey, type SessionSnapshot } from "../src/components/agent/engine/index.js";
import { RedisSessionStore } from "../src/components/agent/session-store.js";
import { createClinicDemoConfig, clinicDemoBehavior, type ClinicDemoState } from "../src/components/agent/business/clinic-demo.js";
import { MockLLMProvider } from "../src/components/agent/providers/llm/mock.js";

it("persists, refreshes and deletes isolated engine state in local Redis", async () => {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379", socket: { reconnectStrategy: false, connectTimeout: 2000 } });
  client.on("error", () => {});
  const config = createClinicDemoConfig("Test Clinic");
  const context = { organizationId: randomUUID(), agentId: config.agentId, sessionId: randomUUID() };
  const key = sessionKey(context);
  let session: AgentSession<ReturnType<typeof clinicDemoBehavior.initialState>> | undefined;
  try {
    await client.connect();
    session = new AgentSession(config, context, new MockLLMProvider(), clinicDemoBehavior, { store: new RedisSessionStore(client) });
    await session.ready;
    assert.ok(await client.exists(key));
    assert.ok(await client.ttl(key) <= SESSION_TTL_SECONDS);
    await client.expire(key, 10);
    await session.processUserUtterance("Dr. Baruah tomorrow");
    assert.ok(await client.ttl(key) >= SESSION_TTL_SECONDS - 2);
    const stored = JSON.parse((await client.get(key)) ?? "{}") as SessionSnapshot<ClinicDemoState>;
    assert.equal(stored.context.organizationId, context.organizationId);
    assert.equal(stored.conversation.businessState.slots.dateOrTime, "tomorrow");
    assert.equal(stored.conversation.history.length, 2);
    await session.notifyInterruption(1);
    const interrupted = JSON.parse((await client.get(key)) ?? "{}") as SessionSnapshot<ClinicDemoState>;
    assert.equal(interrupted.conversation.history[1]?.interrupted, true);
    await session.close(); assert.equal(await client.exists(key), 0);
  } finally {
    await session?.close();
    if (client.isReady) { await client.del(key); await client.quit(); }
    else if (client.isOpen) await client.disconnect();
  }
});
