import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import env from "./lib/env.js";
import logger from "./lib/logger.js";
import { connectRedis } from "./lib/redis.js";
import { auth, errorHandler, routeNotFoundHandler, validateBody } from "./middlewares/index.js";
import type { Route } from "./types.js";
import { healthRoutes } from "./components/health/index.js";
import { authRoutes } from "./components/auth/index.js";
import { organizationRoutes } from "./components/organizations/index.js";

export class App {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.app.enable("trust proxy");
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.app.use(routeNotFoundHandler);
    this.app.use(errorHandler);

    connectRedis().catch((err) => {
      logger.error("Failed to connect to Redis on startup:", err);
    });
  }

  private initializeMiddlewares() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.use(
      cors({
        credentials: true,
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          if (origin === env.FRONTEND_URL) return callback(null, true);
          if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
          return callback(null, true); // Dev-friendly permissive origin
        },
      }),
    );
  }

  private initializeRoutes() {
    const routes: Route[] = [
      ...healthRoutes,
      ...authRoutes,
      ...organizationRoutes,
      // Future phases register components here:
      // ...agentRoutes,
      // ...callRoutes,
      // ...appointmentRoutes,
    ];

    routes.forEach((route) => {
      const { path: _path, method, handler, schema, middlewares: routeMiddlewares = [], isPublic } = route;
      const prefix = "/api/v1";
      const path = `${prefix}${_path}`;
      const middlewares = [...routeMiddlewares];

      // Auto-inject auth middleware for all protected routes
      if (!isPublic) {
        middlewares.unshift(auth);
      }

      if (schema) {
        middlewares.push(validateBody(schema));
      }

      logger.verbose(`Registering route: ${method.toUpperCase()} ${path}${isPublic ? " (public)" : " (protected)"}`);

      if (method === "get") {
        this.app.get(path, ...middlewares, handler);
      } else if (method === "post") {
        this.app.post(path, ...middlewares, handler);
      } else if (method === "put") {
        this.app.put(path, ...middlewares, handler);
      } else if (method === "patch") {
        this.app.patch(path, ...middlewares, handler);
      } else if (method === "delete") {
        this.app.delete(path, ...middlewares, handler);
      }
    });
  }

  public listen(port: number, callback?: () => void) {
    return this.app.listen(port, () => {
      logger.info(`Server is running on port ${port} in ${env.NODE_ENV} mode`);
      if (callback) callback();
    });
  }
}

export default App;
