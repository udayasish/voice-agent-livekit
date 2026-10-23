import { and, count, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, organizations, organizationMembers, users, clinicSettings } from "../../../lib/db/models/index.js";
import type { Database, Transaction } from "../../../lib/db/transaction-with-hooks.js";
import { AppError, ForbiddenError } from "../../../lib/errors.js";
import { clinicToolNames } from "../../clinic/voice/names.js";
import { editableSchema, listSchema, snapshotSchema, toolDependencies, toolPolicyError, updateSchema, type AgentSettings } from "./schema.js";
import { isOpen } from "./hours.js";

export interface AgentActor { organizationId: string; actorId: string; role: "owner" | "admin" | "member" }
export interface AgentDependencies { db: Database; now?: () => Date; logger: { info(message: string, meta: Record<string, unknown>): unknown } }
type Connection = Database | Transaction;
type Row = typeof agents.$inferSelect;
const fail = (code: string, message: string, status = 409): never => { throw new AppError(message, status, code); };
function admin(actor: AgentActor) { if (actor.role === "member") throw new ForbiddenError("Agent administration requires owner or admin", "AGENT_ACCESS_DENIED"); }
function scope(organizationId: string, id: string) { return and(eq(agents.organizationId, organizationId), z.uuid().safeParse(id).success ? eq(agents.id, id) : eq(agents.legacyKey, id)); }
function settings(row: Row): AgentSettings { return editableSchema.parse(Object.fromEntries(Object.keys(editableSchema.shape).map(key => [key, row[key as keyof Row]]))); }
function validatePolicy(value: AgentSettings, business: string, enabled: boolean) { const error = toolPolicyError(value.enabledTools, business, enabled); if (error) fail("INVALID_AGENT_TOOLS", error, 400); }
async function organization(tx: Connection, id: string, lock = false) {
  const query = tx.select().from(organizations).where(eq(organizations.id, id));
  const [org] = await (lock ? query.for("share") : query);
  if (!org || org.status !== "active") throw new ForbiddenError("Organization is unavailable", "ORGANIZATION_UNAVAILABLE");
  try { new Intl.DateTimeFormat("en", { timeZone: org.timezone }); } catch { fail("AGENT_CONFIGURATION_INVALID", "Organization timezone is invalid", 500); }
  return org;
}
async function capability(tx: Connection, organizationId: string, business: string) {
  if (business !== "clinic") return false;
  const [row] = await tx.select({ id: clinicSettings.organizationId }).from(clinicSettings).where(eq(clinicSettings.organizationId, organizationId));
  return Boolean(row);
}
function summary(row: Row) { return { id: row.id, name: row.name, isActive: row.isActive, languages: row.languages, defaultLanguage: row.defaultLanguage,
  version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function detail(row: Row, timezone: string) { return { ...summary(row), ...settings(row), business: row.business, appointmentsEnabled: row.appointmentsEnabled, timezone, legacyKey: row.legacyKey }; }
export async function listAgents(actor: AgentActor, raw: unknown, deps: AgentDependencies) {
  const input = listSchema.parse(raw); await organization(deps.db, actor.organizationId);
  const where = and(eq(agents.organizationId, actor.organizationId), input.active === undefined ? undefined : eq(agents.isActive, input.active === "true"),
    input.search ? ilike(agents.name, `%${input.search.replace(/[\\%_]/gu, "\\$&")}%`) : undefined);
  return deps.db.transaction(async tx => {
    const rows = await tx.select().from(agents).where(where).orderBy(desc(agents.createdAt), desc(agents.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
    const [total] = await tx.select({ value: count() }).from(agents).where(where);
    return { items: rows.map(summary), pagination: { page: input.page, pageSize: input.pageSize, total: total!.value, totalPages: Math.ceil(total!.value / input.pageSize) } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function agentOptions(actor: AgentActor, deps: AgentDependencies) {
  const org = await organization(deps.db, actor.organizationId);
  const enabled = await capability(deps.db, org.id, org.businessType);
  return { timezone: org.timezone, languages: ["as", "hi", "en"], business: org.businessType === "clinic" ? "clinic" : "generic", appointmentsEnabled: enabled,
    permissions: { canEdit: actor.role !== "member", canTest: true }, tools: enabled ? clinicToolNames.map(name => ({ name, requires: toolDependencies[name] ?? [],
      requiresDoctorDiscovery: ["get_available_dates", "get_available_times", "check_my_appointments"].includes(name) })) : [],
    defaults: editableSchema.parse({ name: "New agent" }) };
}
export async function getAgent(actor: AgentActor, id: string, deps: AgentDependencies) {
  const org = await organization(deps.db, actor.organizationId);
  const [row] = await deps.db.select().from(agents).where(scope(org.id, id));
  if (!row) return fail("AGENT_NOT_FOUND", "Agent not found", 404);
  return detail(row, org.timezone);
}
export async function createAgent(actor: AgentActor, raw: unknown, deps: AgentDependencies) {
  admin(actor); const input = editableSchema.parse(raw);
  const result = await deps.db.transaction(async tx => {
    const org = await organization(tx, actor.organizationId, true);
    const business = org.businessType === "clinic" ? "clinic" : "generic";
    const appointmentsEnabled = await capability(tx, org.id, business); validatePolicy(input, business, appointmentsEnabled);
    const [row] = await tx.insert(agents).values({ ...input, organizationId: org.id, business, appointmentsEnabled, createdBy: actor.actorId, updatedBy: actor.actorId }).returning();
    return detail(row!, org.timezone);
  });
  deps.logger.info("agent_created", { organizationId: actor.organizationId, actorId: actor.actorId, agentId: result.id, version: result.version }); return result;
}
export async function updateAgent(actor: AgentActor, id: string, raw: unknown, deps: AgentDependencies) {
  admin(actor); const { expectedVersion, ...patch } = updateSchema.parse(raw);
  const result = await deps.db.transaction(async tx => {
    const org = await organization(tx, actor.organizationId, true);
    const [row] = await tx.select().from(agents).where(scope(org.id, z.uuid().parse(id))).for("update");
    if (!row) return fail("AGENT_NOT_FOUND", "Agent not found", 404);
    if (row.version !== expectedVersion) return fail("AGENT_VERSION_CONFLICT", "Agent changed. Reload its settings before saving.");
    const current = settings(row); const merged = editableSchema.parse({ ...current, ...patch });
    validatePolicy(merged, row.business, row.appointmentsEnabled && await capability(tx, org.id, row.business));
    if (JSON.stringify(current) === JSON.stringify(merged)) return detail(row, org.timezone);
    const [updated] = await tx.update(agents).set({ ...merged, version: sql`${agents.version} + 1`, updatedAt: deps.now?.() ?? new Date(), updatedBy: actor.actorId })
      .where(and(scope(org.id, id), eq(agents.version, expectedVersion))).returning();
    if (!updated) return fail("AGENT_VERSION_CONFLICT", "Agent changed. Reload its settings before saving.");
    return detail(updated, org.timezone);
  });
  deps.logger.info("agent_saved", { organizationId: actor.organizationId, actorId: actor.actorId, agentId: result.id, version: result.version }); return result;
}

/** Shared admission boundary. Locks coordinate edits/deactivation with session admission. */
export async function resolveAgentRuntime(organizationId: string, actorId: string, id: string | undefined, deps: AgentDependencies, expectedVersion?: number) {
  return deps.db.transaction(async tx => {
    const org = await organization(tx, organizationId, true);
    const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, actorId)).for("share");
    const [member] = await tx.select({ id: organizationMembers.id }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, actorId))).for("share");
    if (!user || user.status !== "active" || !member) throw new ForbiddenError("Agent access unavailable", "AGENT_NOT_AVAILABLE");
    const [row] = await tx.select().from(agents).where(scope(org.id, id ?? "default")).for("share");
    if (!row) throw new ForbiddenError("Agent is not configured for this organization", "AGENT_NOT_AVAILABLE");
    if (!row.isActive) return fail("AGENT_INACTIVE", "This agent is inactive");
    if (expectedVersion !== undefined && row.version !== expectedVersion) return fail("AGENT_CONFIG_CHANGED", "Agent settings changed. Start a new session.");
    let config;
    try { config = snapshotSchema.parse({ ...settings(row), organizationId: org.id, agentId: row.id, version: row.version, business: row.business,
      appointmentsEnabled: row.appointmentsEnabled, timezone: org.timezone, businessName: org.name, ...(row.contextLimits ? { contextLimits: row.contextLimits } : {}) }); }
    catch { return fail("AGENT_CONFIGURATION_INVALID", "Saved agent settings are invalid", 500); }
    if (toolPolicyError(config.enabledTools, config.business, config.appointmentsEnabled && await capability(tx, org.id, config.business))) return fail("AGENT_CONFIGURATION_INVALID", "Saved agent tools are unavailable", 500);
    if (!isOpen(config.workingHours, org.timezone, deps.now?.() ?? new Date())) return fail("AGENT_CLOSED", "This agent is outside its working hours");
    return config;
  });
}
