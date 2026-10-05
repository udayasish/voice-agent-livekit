import type { Route } from "../../types.js";
import { requireOrganization } from "../../middlewares/organization.js";
import {
  getMyOrganizationsHandler,
  getOrganizationByIdHandler,
} from "./controllers.js";

export const organizationRoutes: Route[] = [
  {
    path: "/organizations",
    method: "get",
    handler: getMyOrganizationsHandler,
    isPublic: false,
  },
  {
    path: "/organizations/:organizationId",
    method: "get",
    middlewares: [requireOrganization],
    handler: getOrganizationByIdHandler,
    isPublic: false,
  },
];

export default organizationRoutes;
