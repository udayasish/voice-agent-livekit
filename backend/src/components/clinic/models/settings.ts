// Adapted from tenants.ts: identity/timezone live in the existing organizations table.
import { relations } from "drizzle-orm";
import { boolean, pgTable, uuid } from "drizzle-orm/pg-core";
import { organizations } from "../../../lib/db/models/organizations.js";

export const clinicSettings = pgTable("clinic_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id),
  remindersEnabled: boolean("reminders_enabled").notNull().default(true),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
});

export const clinicSettingsRelations = relations(clinicSettings, ({ one }) => ({
  organization: one(organizations, { fields: [clinicSettings.organizationId], references: [organizations.id] }),
}));
