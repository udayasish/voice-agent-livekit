import { readFile } from "node:fs/promises";
import { z } from "zod";
import { clinicToolNames } from "../clinic/voice/names.js";
import { ForbiddenError } from "../../lib/errors.js";
import { agentConfigSchema } from "./engine/config.js";

export const voiceProfileSchema = z.object({
  organizationId: z.uuid(), agentId: z.string().min(1).max(100),
  business: z.enum(["clinic", "clinic-demo", "generic"]),
  appointmentsEnabled: z.boolean().default(false),
  enabledTools: z.array(z.enum(clinicToolNames)).default([]),
  contextLimits: agentConfigSchema.shape.contextLimits.unwrap().optional(),
}).strict().refine(p => new Set(p.enabledTools).size === p.enabledTools.length)
  .refine(p => p.business === "clinic" || p.enabledTools.length === 0);
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export const voiceProfilesSchema = z.array(voiceProfileSchema).refine(profiles =>
  new Set(profiles.map(p => `${p.organizationId}:${p.agentId}`)).size === profiles.length);
export async function loadVoiceProfiles(path?: string): Promise<VoiceProfile[]> {
  return path ? voiceProfilesSchema.parse(JSON.parse(await readFile(path, "utf8"))) : [];
}
export function selectVoiceProfile(profiles: readonly VoiceProfile[], organizationId: string, businessType: string, agentId?: string): VoiceProfile {
  const profile = profiles.find(p => p.organizationId === organizationId && p.agentId === (agentId ?? "default"));
  if (!profile) {
    if (agentId) throw new ForbiddenError("Agent is not configured for this organization", "AGENT_NOT_AVAILABLE");
    return { organizationId, agentId: "default", business: "generic", appointmentsEnabled: false, enabledTools: [] };
  }
  if ((profile.business === "clinic" || profile.business === "clinic-demo") && businessType !== "clinic") {
    throw new ForbiddenError("Business module is not available", "AGENT_NOT_AVAILABLE");
  }
  return voiceProfileSchema.parse({ ...profile, enabledTools: profile.appointmentsEnabled ? profile.enabledTools : [] });
}
