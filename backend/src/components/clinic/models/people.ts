// Adapted from whatsapp-appointment-platform: src/lib/db/models/users.ts.
import { relations } from "drizzle-orm";
import { index, pgTable, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { clinicPersonRoleEnum } from "./enums.js";
import { organizations } from "../../../lib/db/models/organizations.js";

// Clinic contacts, scoped by organization and phone; separate from dashboard login accounts.
export const clinicPeople = pgTable(
  "clinic_people",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
    role: clinicPersonRoleEnum("role").notNull(),
    name: varchar("name", { length: 255 }),
    languagePreference: varchar("language_preference", { length: 10 }).default(
      "en"
    ),
  },
  (t) => [
    unique("clinic_people_organization_id_unique").on(t.organizationId, t.id),
    unique("clinic_people_organization_phone_unique").on(t.organizationId, t.phoneNumber),
    index("clinic_people_organization_id_idx").on(t.organizationId),
    index("clinic_people_phone_number_idx").on(t.phoneNumber),
  ]
);

export const clinicPeopleRelations = relations(clinicPeople, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicPeople.organizationId],
    references: [organizations.id],
  }),
}));

export type ClinicPerson = typeof clinicPeople.$inferSelect;
