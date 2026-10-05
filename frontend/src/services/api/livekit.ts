import { apiRequest } from "./client";
import { useAuthStore } from "@/store/auth-store";

export type LiveKitTokenResponse = {
  token: string;
  url: string;
  roomName: string;
  participantIdentity: string;
  participantName: string;
};

export type FetchTokenParams = {
  roomName?: string;
  participantName?: string;
  agentId?: string;
  organizationId?: string;
};

export const livekitApi = {
  getToken: async (params?: FetchTokenParams): Promise<LiveKitTokenResponse> => {
    const orgId = params?.organizationId || useAuthStore.getState().activeOrganization?.id;
    if (!orgId) {
      throw new Error("No active organization selected. Please select an organization.");
    }

    return apiRequest<LiveKitTokenResponse>("/api/v1/livekit/token", {
      method: "POST",
      headers: {
        "x-organization-id": orgId,
      },
      body: JSON.stringify({
        roomName: params?.roomName,
        participantName: params?.participantName,
        agentId: params?.agentId,
      }),
    });
  },
};
