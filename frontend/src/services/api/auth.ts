import { apiGet, apiPost } from "./client";
import type { LoginResponse, RefreshResponse, MeResponse } from "@/types/auth";

export const authApi = {
  login: async (credentials: { email: string; password: string }): Promise<LoginResponse> => {
    return apiPost<{ email: string; password: string }, LoginResponse>(
      "/api/v1/auth/login",
      credentials,
    );
  },

  refresh: async (): Promise<RefreshResponse> => {
    return apiPost<Record<string, unknown>, RefreshResponse>(
      "/api/v1/auth/refresh",
      {},
    );
  },

  logout: async (): Promise<{ message: string }> => {
    return apiPost<Record<string, unknown>, { message: string }>(
      "/api/v1/auth/logout",
      {},
    );
  },

  getMe: async (): Promise<MeResponse> => {
    return apiGet<MeResponse>("/api/v1/me");
  },
};
