import { z } from "zod";
import type { SessionContext } from "../components/agent/engine/config.js";
import { createTokenSchema } from "../components/livekit/schema.js";

const metadataSchema = z.object({ organizationId: z.uuid(), userId: z.uuid(), agentId: createTokenSchema.shape.agentId.unwrap().nullable() });
/** Use token-service-issued participant metadata, never transcript/data packets. */
export function participantSessionContext(metadata: string, sessionId: string): SessionContext {
  const parsed = metadataSchema.parse(JSON.parse(metadata));
  return { organizationId: parsed.organizationId, agentId: parsed.agentId ?? "clinic-demo", sessionId };
}
