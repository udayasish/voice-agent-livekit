import { spawnSync } from "node:child_process";
import { openClinicTestDatabase } from "./clinic-test-db.js";

const selected = process.argv[2];
if (selected !== "auth" && selected !== "livekit") throw new Error("Choose auth or livekit");
const redisUrl = new URL(process.env["CLINIC_TEST_REDIS_URL"] ?? "redis://127.0.0.1:6380/15");
if (!["localhost", "127.0.0.1"].includes(redisUrl.hostname) || redisUrl.pathname !== "/15") {
  throw new Error("Local API regressions require local Redis test database 15");
}
process.env["REDIS_URL"] = redisUrl.toString();
const database = await openClinicTestDatabase();
try {
  process.env["DATABASE_URL"] = database.url;
  const { seedDatabase } = await import("../src/lib/db/seed.js");
  const { pool } = await import("../src/lib/db/db.js");
  try { await seedDatabase(); } finally { await pool.end(); }
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.url };
  delete childEnv["VOICE_AGENT_PROFILES_PATH"];
  const result = spawnSync(process.execPath, ["--import", "tsx", `test/${selected}.test.ts`], { cwd: process.cwd(), env: childEnv, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} finally { await database.pool.end(); }
