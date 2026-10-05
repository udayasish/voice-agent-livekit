import { apiGet } from "./client";
import type { AuthOrganization } from "@/types/auth";

export const organizationApi = {
  getOrganizations: async (): Promise<AuthOrganization[]> => {
    return apiGet<AuthOrganization[]>("/api/v1/organizations");
  },

  getOrganization: async (organizationId: string): Promise<AuthOrganization> => {
    return apiGet<AuthOrganization>(`/api/v1/organizations/${organizationId}`);
  },
};
