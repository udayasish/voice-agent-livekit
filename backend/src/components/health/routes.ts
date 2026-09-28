import type { Route } from "../../types.js";
import { getHealth } from "./controllers.js";

const routes: Route[] = [
  {
    path: "/health",
    method: "get",
    handler: getHealth,
    isPublic: true,
  },
];

export default routes;
