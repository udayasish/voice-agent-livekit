// Adapted from whatsapp-appointment-platform: src/lib/db/models/blocked-dates.ts.
import { relations } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  pgTable,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { clinicBlockedDateReasonEnum } from "./enums.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { clinicDoctors } from "./doctors.js";

// A date a given doctor is unavailable (staff BLOCK command). Existing clinicSlots
// on that date are cancelled and affected patients notified.
export const clinicBlockedDates = pgTable(
  "clinic_blocked_dates",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => clinicDoctors.id),
    blockedDate: date("blocked_date", { mode: "string" }).notNull(),
    reason: clinicBlockedDateReasonEnum("reason").notNull().default("other"),
    notes: varchar("notes", { length: 500 }),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.doctorId], foreignColumns: [clinicDoctors.organizationId, clinicDoctors.id], name: "clinic_blocked_dates_scoped_doctor_fk" }),
    unique("clinic_blocked_dates_doctor_date_unique").on(t.doctorId, t.blockedDate),
    index("clinic_blocked_dates_organization_id_idx").on(t.organizationId),
  ]
);

export const clinicBlockedDatesRelations = relations(clinicBlockedDates, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicBlockedDates.organizationId],
    references: [organizations.id],
  }),
  doctor: one(clinicDoctors, {
    fields: [clinicBlockedDates.doctorId],
    references: [clinicDoctors.id],
  }),
}));

export type ClinicBlockedDate = typeof clinicBlockedDates.$inferSelect;
