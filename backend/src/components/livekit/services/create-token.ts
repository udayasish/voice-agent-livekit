import { AccessToken } from "livekit-server-sdk";
import env from "../../../lib/env.js";
import type { AuthOrganization, AuthUser } from "../../../types.js";
import type { CreateTokenInput } from "../schema.js";

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
  const defaultRoomPrefix = `room-${organization.id.substring(0, 8)}`;
  const roomName = input.roomName
    ? input.roomName.trim()
    : `${defaultRoomPrefix}-${input.agentId ? input.agentId.substring(0, 8) : "sandbox"}`;

  const participantName = input.participantName?.trim() || user.name || "Participant";
  // Unique session identity avoids kicking existing tabs when multiple tabs connect
  const sessionSuffix = Date.now().toString(36);
  const participantIdentity = `user-${user.id.substring(0, 8)}-${sessionSuffix}`;

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    ttl: "15m",
    metadata: JSON.stringify({
      organizationId: organization.id,
      userId: user.id,
      agentId: input.agentId ?? null,
    }),
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
