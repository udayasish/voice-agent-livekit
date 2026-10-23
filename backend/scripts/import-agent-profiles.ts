import { readFile } from "node:fs/promises";
import { db, pool } from "../src/lib/db/db.js";
import env from "../src/lib/env.js";
import { importAgentProfiles } from "../src/components/agent/configuration/import-profiles.js";
const args = process.argv.slice(2);
try {
  if (args.some(a => a !== "--apply" && a !== "--dry-run")) throw new Error("Use --dry-run (default) or --apply");
  if (!env.VOICE_AGENT_PROFILES_PATH) throw new Error("Set the existing VOICE_AGENT_PROFILES_PATH for import");
  const report = await importAgentProfiles(db, JSON.parse(await readFile(env.VOICE_AGENT_PROFILES_PATH, "utf8")), args.includes("--apply"));
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", report }, null, 2));
} catch { console.error("Agent import failed. Check profile validation, organization/module compatibility and database access; no partial import was committed."); process.exitCode = 1; }
finally { await pool.end(); }
