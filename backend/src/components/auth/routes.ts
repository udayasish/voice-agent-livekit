import type { Route } from "../../types.js";
import { loginSchema, refreshSchema } from "./schema.js";
import {
  getMeHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
} from "./controllers.js";

export const authRoutes: Route[] = [
  {
    path: "/auth/login",
    method: "post",
    handler: loginHandler,
    schema: loginSchema,
    isPublic: true,
  },
  {
    path: "/auth/refresh",
    method: "post",
    handler: refreshHandler,
    schema: refreshSchema,
    isPublic: true,
  },
  {
    path: "/auth/logout",
    method: "post",
    handler: logoutHandler,
    isPublic: false,
  },
  {
    path: "/me",
    method: "get",
    handler: getMeHandler,
    isPublic: false,
  },
];

export default authRoutes;
