// Adapted from whatsapp-appointment-platform: src/lib/db/models/appointments.ts.
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  date,
  index,
  integer,
  pgTable,
  text,
  time,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { clinicAppointmentSourceEnum, clinicAppointmentStatusEnum } from "./enums.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { clinicDoctors } from "./doctors.js";
import { clinicPeople } from "./people.js";
import { clinicSlots } from "./slots.js";

export const clinicAppointments = pgTable(
  "clinic_appointments",
  {
    ...commonFields,
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => clinicDoctors.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => clinicPeople.id),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => clinicSlots.id),
    // Sequential per doctor per day — what patients are told to look out for.
    tokenNumber: integer("token_number").notNull(),
    appointmentDate: date("appointment_date", { mode: "string" }).notNull(),
    appointmentTime: time("appointment_time").notNull(),
    patientName: varchar("patient_name", { length: 255 }).notNull(),
    patientAge: integer("patient_age").notNull(),
    complaint: text("complaint"),
    status: clinicAppointmentStatusEnum("status").notNull().default("booked"),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    reminderSent: boolean("reminder_sent").notNull().default(false),
    source: clinicAppointmentSourceEnum("source").notNull(),
    // Correlation only: permanent call records belong to a later phase.
    callId: uuid("call_id"),
    requestKey: uuid("request_key"),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }),
  },
  (t) => [
    unique("clinic_appointments_request_unique").on(t.organizationId, t.requestKey),
    foreignKey({ columns: [t.organizationId, t.patientId], foreignColumns: [clinicPeople.organizationId, clinicPeople.id], name: "clinic_appointments_scoped_patient_fk" }),
    foreignKey({ columns: [t.organizationId, t.doctorId], foreignColumns: [clinicDoctors.organizationId, clinicDoctors.id], name: "clinic_appointments_scoped_doctor_fk" }),
    foreignKey({ columns: [t.organizationId, t.doctorId, t.slotId], foreignColumns: [clinicSlots.organizationId, clinicSlots.doctorId, clinicSlots.id], name: "clinic_appointments_scoped_slot_fk" }),
    check("clinic_appointments_valid_age", sql`${t.patientAge} between 0 and 120`),
    check("clinic_appointments_positive_token", sql`${t.tokenNumber} > 0`),
    unique("clinic_appointments_doctor_date_token_unique").on(
      t.doctorId,
      t.appointmentDate,
      t.tokenNumber
    ),
    index("clinic_appointments_organization_id_idx").on(t.organizationId),
    index("clinic_appointments_appointment_date_idx").on(t.appointmentDate),
    index("clinic_appointments_status_idx").on(t.status),
    index("clinic_appointments_slot_id_status_idx").on(t.slotId, t.status),
  ]
);

export const clinicAppointmentsRelations = relations(clinicAppointments, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicAppointments.organizationId],
    references: [organizations.id],
  }),
  doctor: one(clinicDoctors, {
    fields: [clinicAppointments.doctorId],
    references: [clinicDoctors.id],
  }),
  patient: one(clinicPeople, {
    fields: [clinicAppointments.patientId],
    references: [clinicPeople.id],
  }),
  slot: one(clinicSlots, {
    fields: [clinicAppointments.slotId],
    references: [clinicSlots.id],
  }),
}));

export type ClinicAppointment = typeof clinicAppointments.$inferSelect;
