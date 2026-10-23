import { AccessToken } from "livekit-server-sdk";
import env from "../../../lib/env.js";
import type { AuthOrganization, AuthUser } from "../../../types.js";
import type { CreateTokenInput } from "../schema.js";
import { randomUUID } from "node:crypto";
import { redis } from "../../../lib/redis.js";
import { resolveAgentRuntime } from "../../agent/configuration/services.js";
import { db } from "../../../lib/db/db.js";
import logger from "../../../lib/logger.js";
import { issueRuntimeBinding } from "../../agent/runtime-binding.js";

export type LiveKitTokenResult = {
  token: string;
  url: string;
  roomName: string;
  participantIdentity: string;
  participantName: string;
};

export const createToken = async (
  input: CreateTokenInput,
  user: AuthUser,
  organization: AuthOrganization,
): Promise<LiveKitTokenResult> => {
  // Determine scoped room name ensuring isolation per organization
  const roomName = `room-${organization.id}-${input.roomName?.trim() || "sandbox"}-${randomUUID()}`;

  const participantName = input.participantName?.trim() || user.name || "Participant";
  // Unique session identity avoids kicking existing tabs when multiple tabs connect
  const sessionSuffix = randomUUID();
  const participantIdentity = `user-${user.id.substring(0, 8)}-${sessionSuffix}`;

  const profile = await resolveAgentRuntime(organization.id, user.id, input.agentId, { db, logger });
  const runtimeBindingId = await issueRuntimeBinding(redis, { schemaVersion: 2, organizationId: organization.id, userId: user.id,
    agentId: profile.agentId, sessionId: randomUUID(), callId: randomUUID(), conversationId: randomUUID(),
    roomName, participantIdentity, profile });
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    ttl: "15m",
    metadata: JSON.stringify({ runtimeBindingId }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();

  return {
    token,
    url: env.LIVEKIT_URL.replace(/^http/, "ws"),
    roomName,
    participantIdentity,
    participantName,
  };
};
