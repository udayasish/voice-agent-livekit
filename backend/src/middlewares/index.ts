import { ZodError, type ZodTypeAny } from "zod";
import { asyncHandler, errors, logger } from "../lib/index.js";
import type { ErrorRequestHandler, RequestHandler } from "express";

export { auth } from "./auth.js";
export { requireOrganization } from "./organization.js";

export const validateBody = (schema: ZodTypeAny): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    const result = schema.parse(req.body ?? {});
    req.body = result;
    next();
  });

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      },
    });
    return;
  }

  if (err instanceof errors.AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  logger.error("Unhandled Server Error:", err);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};

export const routeNotFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
};
