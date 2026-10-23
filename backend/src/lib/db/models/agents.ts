import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { commonFields } from "./common.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import type { AgentSettings, AgentSnapshot } from "../../../components/agent/configuration/schema.js";
export const agents = pgTable("agents", {
  ...commonFields,
  organizationId: uuid("organization_id").notNull().references(() => organizations.id), legacyKey: varchar("legacy_key", { length: 100 }),
  name: text("name").notNull(), isActive: boolean("is_active").notNull().default(true), business: varchar("business", { length: 20 }).notNull(),
  instructions: text("instructions").notNull().default(""), greeting: text("greeting").notNull().default(""),
  languages: text("languages").array().notNull().$type<AgentSettings["languages"]>(), defaultLanguage: varchar("default_language", { length: 2 }).notNull().$type<AgentSettings["defaultLanguage"]>(),
  enabledTools: text("enabled_tools").array().notNull().$type<AgentSettings["enabledTools"]>(), appointmentsEnabled: boolean("appointments_enabled").notNull().default(false),
  workingHours: jsonb("working_hours").notNull().$type<AgentSettings["workingHours"]>(), humanContact: jsonb("human_contact").notNull().$type<AgentSettings["humanContact"]>(),
  contextLimits: jsonb("context_limits").$type<AgentSnapshot["contextLimits"]>(), version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }), updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
}, t => [unique("agents_org_legacy_unique").on(t.organizationId, t.legacyKey), unique("agents_org_id_unique").on(t.organizationId, t.id),
  index("agents_org_created_idx").on(t.organizationId, t.createdAt, t.id), index("agents_org_active_created_idx").on(t.organizationId, t.isActive, t.createdAt, t.id),
  check("agents_version_positive", sql`${t.version} > 0`), check("agents_business_valid", sql`${t.business} in ('clinic','generic')`),
  check("agents_languages_valid", sql`cardinality(${t.languages}) between 1 and 3 and ${t.languages} <@ ARRAY['as','hi','en']::text[] and ${t.defaultLanguage} = ANY(${t.languages})`),
]);
