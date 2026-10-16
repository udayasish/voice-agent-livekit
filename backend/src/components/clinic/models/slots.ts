// Adapted from whatsapp-appointment-platform: src/lib/db/models/slots.ts.
import { relations, sql } from "drizzle-orm";
import {
  date,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { clinicDayOfWeekEnum, clinicSlotStatusEnum } from "./enums.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { clinicDoctors } from "./doctors.js";

// A single concrete bookable slot (one doctor, one date, one start time) —
// generated in bulk by the staff SLOT command, never a recurring template.
export const clinicSlots = pgTable(
  "clinic_slots",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => clinicDoctors.id),
    slotDate: date("slot_date", { mode: "string" }).notNull(),
    dayOfWeek: clinicDayOfWeekEnum("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    status: clinicSlotStatusEnum("status").notNull().default("available"),
    maxPatients: integer("max_patients").notNull().default(30),
  },
  (t) => [
    unique("clinic_slots_scoped_doctor_id_unique").on(t.organizationId, t.doctorId, t.id),
    foreignKey({ columns: [t.organizationId, t.doctorId], foreignColumns: [clinicDoctors.organizationId, clinicDoctors.id], name: "clinic_slots_scoped_doctor_fk" }),
    check("clinic_slots_positive_capacity", sql`${t.maxPatients} > 0`),
    check("clinic_slots_valid_interval", sql`${t.startTime} < ${t.endTime}`),
    unique("clinic_slots_doctor_date_start_unique").on(
      t.doctorId,
      t.slotDate,
      t.startTime
    ),
    index("clinic_slots_organization_id_idx").on(t.organizationId),
    index("clinic_slots_status_idx").on(t.status),
    index("clinic_slots_slot_date_idx").on(t.slotDate),
  ]
);

export const clinicSlotsRelations = relations(clinicSlots, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicSlots.organizationId],
    references: [organizations.id],
  }),
  doctor: one(clinicDoctors, {
    fields: [clinicSlots.doctorId],
    references: [clinicDoctors.id],
  }),
}));

export type ClinicSlot = typeof clinicSlots.$inferSelect;
