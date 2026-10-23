import { and, eq } from "drizzle-orm";
import type { Database } from "../../../lib/db/transaction-with-hooks.js";
import { agents, organizations, clinicSettings } from "../../../lib/db/models/index.js";
import { voiceProfilesSchema } from "../profiles.js";
import { editableSchema, toolPolicyError } from "./schema.js";

/** Explicit operator utility; never called by request handling or server startup. */
export async function importAgentProfiles(db: Database, raw: unknown, apply = false) {
  const profiles = voiceProfilesSchema.parse(raw);
  return db.transaction(async tx => {
    const report: Array<{ organizationId: string; legacyKey: string; outcome: string }> = [];
    const pending: Array<typeof agents.$inferInsert> = [];
    for (const p of profiles) {
      if (p.business === "clinic-demo") throw new Error("Legacy clinic-demo requires explicit operator conversion before import");
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, p.organizationId)).for("share");
      if (!org || (p.business === "clinic" && org.businessType !== "clinic")) throw new Error("Profile organization/module mismatch");
      const [clinic] = await tx.select().from(clinicSettings).where(eq(clinicSettings.organizationId, p.organizationId));
      if (p.business === "clinic" && !clinic) throw new Error("Clinic configuration missing");
      const tools = p.appointmentsEnabled ? p.enabledTools : [];
      const problem = toolPolicyError(tools, p.business, p.appointmentsEnabled);
      if (problem) throw new Error(problem);
      const [existing] = await tx.select().from(agents).where(and(eq(agents.organizationId, p.organizationId), eq(agents.legacyKey, p.agentId)));
      if (existing) {
        const differs = existing.business !== p.business || existing.appointmentsEnabled !== p.appointmentsEnabled || JSON.stringify([...existing.enabledTools].sort()) !== JSON.stringify([...tools].sort());
        report.push({ organizationId: p.organizationId, legacyKey: p.agentId, outcome: differs ? "skipped_existing_difference" : "skipped_existing" }); continue;
      }
      pending.push({ ...editableSchema.parse({ name: p.agentId === "default" ? "Clinic receptionist" : p.agentId, languages: ["as", "hi", "en"], enabledTools: tools }),
        organizationId: p.organizationId, legacyKey: p.agentId, business: p.business, appointmentsEnabled: p.appointmentsEnabled, contextLimits: p.contextLimits ?? null });
      report.push({ organizationId: p.organizationId, legacyKey: p.agentId, outcome: apply ? "imported" : "would_import" });
    }
    if (apply && pending.length) await tx.insert(agents).values(pending);
    return report;
  });
}
