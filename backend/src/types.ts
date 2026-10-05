import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export type Route = {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  handler: RequestHandler;
  schema?: ZodTypeAny;
  middlewares?: RequestHandler[];
  isPublic?: boolean;
};

export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

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

declare global {
  namespace Express {
    interface Request {
      ctx?: {
        user?: AuthUser;
        organization?: AuthOrganization;
      };
    }
  }
}
