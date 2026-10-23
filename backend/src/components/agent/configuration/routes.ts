import type { Request, Response } from "express";
import { z } from "zod";
import type { Route } from "../../../types.js";
import { asyncHandler } from "../../../lib/async-handler.js";
import { successResponse } from "../../../lib/response.js";
import { requireOrganization } from "../../../middlewares/organization.js";
import { db } from "../../../lib/db/db.js";
import logger from "../../../lib/logger.js";
import { ForbiddenError } from "../../../lib/errors.js";
import { readParams, updateParams } from "./schema.js";
import { agentOptions, createAgent, getAgent, listAgents, updateAgent, type AgentActor } from "./services.js";
export const agentOrganizationHeader = asyncHandler(async (req, _res, next) => { z.uuid().parse(req.headers["x-organization-id"]); next(); });
const deps = { db, logger };
function actor(req: Request): AgentActor { if (!req.ctx?.user || !req.ctx.organization) throw new ForbiddenError(); return { actorId: req.ctx.user.id, organizationId: req.ctx.organization.id, role: req.ctx.organization.role }; }
const route = (method: Route["method"], path: string, handler: (req: Request, res: Response) => Promise<void>): Route => ({ method, path, isPublic: false,
  middlewares: [agentOrganizationHeader, requireOrganization], handler: asyncHandler(handler) });
export const agentRoutes: Route[] = [
  route("get", "/agents", async (req, res) => { res.json(successResponse(await listAgents(actor(req), req.query, deps))); }),
  route("get", "/agents/options", async (req, res) => { z.object({}).strict().parse(req.query); res.json(successResponse(await agentOptions(actor(req), deps))); }),
  route("get", "/agents/:agentId", async (req, res) => { z.object({}).strict().parse(req.query); res.json(successResponse(await getAgent(actor(req), readParams.parse(req.params).agentId, deps))); }),
  route("post", "/agents", async (req, res) => { z.object({}).strict().parse(req.query); res.status(201).json(successResponse(await createAgent(actor(req), req.body, deps))); }),
  route("patch", "/agents/:agentId", async (req, res) => { z.object({}).strict().parse(req.query); res.json(successResponse(await updateAgent(actor(req), updateParams.parse(req.params).agentId, req.body, deps))); }),
];
