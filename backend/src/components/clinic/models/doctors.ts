// Adapted from whatsapp-appointment-platform: src/lib/db/models/doctors.ts.
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  uuid,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { clinicPeople } from "./people.js";

// One doctor profile per person (role=doctor). Split from `clinicPeople` because
// clinicDoctors carry scheduling attributes patients/receptionists never need.
export const clinicDoctors = pgTable(
  "clinic_doctors",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => clinicPeople.id)
      .unique(),
    specialization: varchar("specialization", { length: 255 }),
    consultationDurationMinutes: integer("consultation_duration_minutes")
      .notNull()
      .default(15),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    index("clinic_doctors_organization_id_idx").on(t.organizationId),
    unique("clinic_doctors_organization_id_unique").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.personId], foreignColumns: [clinicPeople.organizationId, clinicPeople.id], name: "clinic_doctors_scoped_person_fk" }),
    check("clinic_doctors_positive_duration", sql`${t.consultationDurationMinutes} > 0`),
  ]
);

export const clinicDoctorsRelations = relations(clinicDoctors, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicDoctors.organizationId],
    references: [organizations.id],
  }),
  person: one(clinicPeople, {
    fields: [clinicDoctors.personId],
    references: [clinicPeople.id],
  }),
}));

export type ClinicDoctor = typeof clinicDoctors.$inferSelect;
