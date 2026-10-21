import { readFile } from "node:fs/promises";
import env from "../src/lib/env.js";
import { db, pool, transactionWithHooks } from "../src/lib/db/db.js";
import logger from "../src/lib/logger.js";
import { doctorMetadataImportSchema, importDoctorMetadata, doctorMetadataReadiness } from "../src/components/clinic/services/doctor-metadata.js";

// Explicit local operator command; cannot be invoked by model tools.
try {
  const url = new URL(env.DATABASE_URL);
  if (env.NODE_ENV !== "development" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/voice_agent(?:_clinic_test(?:_[a-z0-9_]+)?)?$/u.test(url.pathname)) throw new Error("Requires the local development voice database");
  const args = process.argv.slice(2);
  const file = args.find(value => !value.startsWith("--"));
  if (!file || args.some(value => value.startsWith("--") && value !== "--apply")) throw new Error("Usage: npm run clinic:doctor-metadata -- manifest.json [--apply]; default is dry-run");
  const manifest = doctorMetadataImportSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const deps = { db, transaction: transactionWithHooks, logger };
  const result = await importDoctorMetadata(manifest, deps, !args.includes("--apply"));
  console.log(JSON.stringify({ ...result, readiness: await doctorMetadataReadiness(manifest.organizationId, deps) }));
} catch { console.error("Doctor metadata import failed. Check the local database, manifest schema and organization/doctor relationships; no partial import is committed."); process.exitCode = 1; }
finally { await pool.end(); }
