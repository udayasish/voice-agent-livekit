import { sql } from "drizzle-orm";
import { check, date, foreignKey, integer, pgTable, primaryKey, time, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { commonFields } from "../../../lib/db/models/common.js";
import { organizations } from "../../../lib/db/models/organizations.js";
import { users } from "../../../lib/db/models/users.js";
import { clinicAppointments } from "./appointments.js";
import { clinicDoctors } from "./doctors.js";
import { clinicSlots } from "./slots.js";

export const clinicTokenCounters = pgTable("clinic_token_counters", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  doctorId: uuid("doctor_id").notNull(), date: date("date", { mode: "string" }).notNull(),
  lastToken: integer("last_token").notNull(),
}, t => [primaryKey({ columns: [t.organizationId, t.doctorId, t.date] }),
  foreignKey({ columns: [t.organizationId, t.doctorId], foreignColumns: [clinicDoctors.organizationId, clinicDoctors.id] }),
  check("clinic_counter_positive", sql`${t.lastToken} > 0`)]);

export const clinicMutationReceipts = pgTable("clinic_mutation_receipts", {
  ...commonFields,
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appointmentId: uuid("appointment_id").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  operation: varchar("operation", { length: 20 }).notNull(),
  requestKey: uuid("request_key").notNull(), fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  resultingVersion: integer("resulting_version").notNull(),
}, t => [unique("clinic_mutation_request_unique").on(t.organizationId, t.requestKey),
  foreignKey({ columns: [t.organizationId, t.appointmentId], foreignColumns: [clinicAppointments.organizationId, clinicAppointments.id] }),
  check("clinic_mutation_operation", sql`${t.operation} in ('cancel', 'reschedule')`),
  check("clinic_mutation_version", sql`${t.resultingVersion} > 0`)]);

export const clinicRescheduleHistory = pgTable("clinic_reschedule_history", {
  ...commonFields,
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appointmentId: uuid("appointment_id").notNull(), doctorId: uuid("doctor_id").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  previousSlotId: uuid("previous_slot_id").notNull(), newSlotId: uuid("new_slot_id").notNull(),
  previousDate: date("previous_date", { mode: "string" }).notNull(), newDate: date("new_date", { mode: "string" }).notNull(),
  previousTime: time("previous_time").notNull(), newTime: time("new_time").notNull(),
  previousToken: integer("previous_token").notNull(), newToken: integer("new_token").notNull(),
  version: integer("version").notNull(), reason: varchar("reason", { length: 500 }).notNull(),
}, t => [unique("clinic_reschedule_version_unique").on(t.organizationId, t.appointmentId, t.version),
  foreignKey({ columns: [t.organizationId, t.appointmentId], foreignColumns: [clinicAppointments.organizationId, clinicAppointments.id] }),
  foreignKey({ columns: [t.organizationId, t.doctorId, t.previousSlotId], foreignColumns: [clinicSlots.organizationId, clinicSlots.doctorId, clinicSlots.id] }),
  foreignKey({ columns: [t.organizationId, t.doctorId, t.newSlotId], foreignColumns: [clinicSlots.organizationId, clinicSlots.doctorId, clinicSlots.id] }),
  check("clinic_history_positive", sql`${t.previousToken} > 0 and ${t.newToken} > 0 and ${t.version} > 1`)]);
