import type { Route } from "../../types.js";
import { requireOrganization } from "../../middlewares/organization.js";
import { createTokenHandler } from "./controllers.js";
import { createTokenSchema } from "./schema.js";

export const livekitRoutes: Route[] = [
  {
    path: "/livekit/token",
    method: "post",
    middlewares: [requireOrganization],
    schema: createTokenSchema,
    handler: createTokenHandler,
    isPublic: false,
  },
];

export default livekitRoutes;
