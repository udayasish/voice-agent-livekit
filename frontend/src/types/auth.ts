export type AuthUser = {
  id: string;
  email: string;
  name: string;
  status: "active" | "suspended";
};

export type AuthOrganization = {
  id: string;
  name: string;
  businessType: string;
  role: "owner" | "admin" | "member";
};

export type LoginResponse = {
  user: AuthUser;
  organizations: AuthOrganization[];
  currentOrganization: AuthOrganization | null;
  accessToken: string;
};

export type RefreshResponse = {
  user: AuthUser;
  accessToken: string;
};

export type MeResponse = {
  user: AuthUser;
  organizations: AuthOrganization[];
};
