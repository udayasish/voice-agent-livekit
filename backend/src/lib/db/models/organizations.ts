import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { commonFields } from "./common.js";
import { users } from "./users.js";

export const businessTypeEnum = pgEnum("business_type", [
  "clinic",
  "hotel",
  "restaurant",
  "salon",
  "generic",
]);

export const organizationStatusEnum = pgEnum("organization_status", [
  "active",
  "suspended",
]);

export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "member",
]);

export const organizations = pgTable("organizations", {
  ...commonFields,
  name: varchar("name", { length: 255 }).notNull(),
  businessType: businessTypeEnum("business_type").notNull().default("clinic"),
  status: organizationStatusEnum("status").notNull().default("active"),
  timezone: varchar("timezone", { length: 100 }).notNull().default("Asia/Kolkata"),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export const organizationMembers = pgTable(
  "organization_members",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
  },
  (t) => [
    index("org_members_user_id_idx").on(t.userId),
    index("org_members_org_id_idx").on(t.organizationId),
    unique("unique_user_per_org").on(t.organizationId, t.userId),
  ]
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

export const organizationRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
}));

export const organizationMemberRelations = relations(
  organizationMembers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMembers.userId],
      references: [users.id],
    }),
  })
);
