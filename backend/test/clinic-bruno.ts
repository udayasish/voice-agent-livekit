import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { openClinicTestDatabase, removeClinicFixtures, schema } from "./clinic-test-db.js";

const cli = process.env["BRUNO_CLI_PATH"];
if (!cli) throw new Error("Set BRUNO_CLI_PATH to the installed @usebruno/cli src/bru.js entry point");
const database = await openClinicTestDatabase();
const redisUrl = new URL(process.env["CLINIC_TEST_REDIS_URL"] ?? "redis://127.0.0.1:6380/15");
if (!["localhost", "127.0.0.1"].includes(redisUrl.hostname) || redisUrl.pathname !== "/15") throw new Error("Bruno acceptance requires local Redis database 15");
process.env["DATABASE_URL"] = database.url; process.env["REDIS_URL"] = redisUrl.toString();
const { App } = await import("../src/app.js");
const { pool } = await import("../src/lib/db/db.js");
const { redis } = await import("../src/lib/redis.js");
const { hashPassword } = await import("../src/lib/password.js");
const app = new App(); const server = app.app.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); if (!address || typeof address === "string") throw new Error("No API address");
const host = `http://127.0.0.1:${address.port}`;
const organizations: string[] = []; const users: string[] = [];
const temp = await mkdtemp(path.join(tmpdir(), "clinic-bruno-"));
try {
  if (!redis.isReady) await once(redis, "ready");
  for (let n = 0; n < 2; n++) { const [org] = await database.db.insert(schema.organizations).values({ name: "Synthetic Bruno Clinic", businessType: "clinic" }).returning(); if (!org) throw new Error("No clinic"); organizations.push(org.id); }
  const password = "Synthetic-Bruno-password!"; const passwordHash = await hashPassword(password);
  let adminEmail = ""; let memberAccessToken = "";
  for (const role of ["owner", "member"] as const) {
    const email = `${randomUUID()}@test.invalid`; const [user] = await database.db.insert(schema.users).values({ name: "Synthetic Bruno Staff", email, passwordHash }).returning(); if (!user) throw new Error("No staff"); users.push(user.id);
    await database.db.insert(schema.organizationMembers).values({ organizationId: organizations[0]!, userId: user.id, role });
    if (role === "owner") adminEmail = email;
    else { const r = await fetch(`${host}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(r.status, 200); memberAccessToken = z.object({ data: z.object({ accessToken: z.string() }) }).parse(await r.json()).data.accessToken; }
  }
  const envPath = path.join(temp, "environment.json");
  const variables = { host, adminEmail, adminPassword: password, memberAccessToken, otherOrganizationId: organizations[1]! };
  await writeFile(envPath, JSON.stringify({ name: "Phase 16 isolated acceptance", variables: Object.entries(variables).map(([name, value]) => ({ name, value, enabled: true, type: "text" })) }));
  const result = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "run", "Clinic/Acceptance", "--env-file", envPath, "--sandbox=developer", "--disable-cookies", "--noproxy", "--bail"],
      { cwd: fileURLToPath(new URL("../bruno-collection/", import.meta.url)), stdio: "inherit", env: process.env });
    child.on("error", reject); child.on("close", resolve);
  });
  assert.equal(result, 0, "Bruno acceptance failed");
  console.log("Actual Bruno acceptance passed against isolated local fixtures.");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const id of users) for await (const key of redis.scanIterator({ MATCH: `refresh_token:${id}:*` })) await redis.del(key);
  if (redis.isOpen) await redis.quit(); await pool.end();
  try { await removeClinicFixtures(database.db, organizations); if (users.length) await database.db.delete(schema.users).where(inArray(schema.users.id, users)); }
  finally {
    await database.pool.end();
    if (path.dirname(path.resolve(temp)) !== path.resolve(tmpdir()) || !path.basename(temp).startsWith("clinic-bruno-")) throw new Error("Unexpected temporary cleanup path");
    await rm(temp, { recursive: true, force: true });
  }
}
