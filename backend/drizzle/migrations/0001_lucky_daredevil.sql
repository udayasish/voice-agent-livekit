CREATE TYPE "public"."clinic_appointment_source" AS ENUM('voice', 'whatsapp', 'manual');--> statement-breakpoint
CREATE TYPE "public"."clinic_appointment_status" AS ENUM('booked', 'completed', 'cancelled', 'noshow');--> statement-breakpoint
CREATE TYPE "public"."clinic_blocked_date_reason" AS ENUM('leave', 'holiday', 'emergency', 'other');--> statement-breakpoint
CREATE TYPE "public"."clinic_day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."clinic_person_role" AS ENUM('patient', 'doctor', 'receptionist');--> statement-breakpoint
CREATE TYPE "public"."clinic_slot_status" AS ENUM('available', 'booked', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TABLE "clinic_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"role" "clinic_person_role" NOT NULL,
	"name" varchar(255),
	"language_preference" varchar(10) DEFAULT 'en',
	CONSTRAINT "clinic_people_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "clinic_people_organization_phone_unique" UNIQUE("organization_id","phone_number")
);
--> statement-breakpoint
CREATE TABLE "clinic_doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"specialization" varchar(255),
	"consultation_duration_minutes" integer DEFAULT 15 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "clinic_doctors_person_id_unique" UNIQUE("person_id"),
	CONSTRAINT "clinic_doctors_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "clinic_doctors_positive_duration" CHECK ("clinic_doctors"."consultation_duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"day_of_week" "clinic_day_of_week" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"status" "clinic_slot_status" DEFAULT 'available' NOT NULL,
	"max_patients" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "clinic_slots_scoped_doctor_id_unique" UNIQUE("organization_id","doctor_id","id"),
	CONSTRAINT "clinic_slots_doctor_date_start_unique" UNIQUE("doctor_id","slot_date","start_time"),
	CONSTRAINT "clinic_slots_positive_capacity" CHECK ("clinic_slots"."max_patients" > 0),
	CONSTRAINT "clinic_slots_valid_interval" CHECK ("clinic_slots"."start_time" < "clinic_slots"."end_time")
);
--> statement-breakpoint
CREATE TABLE "clinic_blocked_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"blocked_date" date NOT NULL,
	"reason" "clinic_blocked_date_reason" DEFAULT 'other' NOT NULL,
	"notes" varchar(500),
	CONSTRAINT "clinic_blocked_dates_doctor_date_unique" UNIQUE("doctor_id","blocked_date")
);
--> statement-breakpoint
CREATE TABLE "clinic_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"token_number" integer NOT NULL,
	"appointment_date" date NOT NULL,
	"appointment_time" time NOT NULL,
	"patient_name" varchar(255) NOT NULL,
	"patient_age" integer NOT NULL,
	"complaint" text,
	"status" "clinic_appointment_status" DEFAULT 'booked' NOT NULL,
	"cancel_reason" varchar(500),
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"source" "clinic_appointment_source" NOT NULL,
	"call_id" uuid,
	CONSTRAINT "clinic_appointments_doctor_date_token_unique" UNIQUE("doctor_id","appointment_date","token_number"),
	CONSTRAINT "clinic_appointments_valid_age" CHECK ("clinic_appointments"."patient_age" between 0 and 120),
	CONSTRAINT "clinic_appointments_positive_token" CHECK ("clinic_appointments"."token_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_people" ADD CONSTRAINT "clinic_people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_doctors" ADD CONSTRAINT "clinic_doctors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_doctors" ADD CONSTRAINT "clinic_doctors_person_id_clinic_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."clinic_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_doctors" ADD CONSTRAINT "clinic_doctors_scoped_person_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."clinic_people"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_slots" ADD CONSTRAINT "clinic_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_slots" ADD CONSTRAINT "clinic_slots_doctor_id_clinic_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."clinic_doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_slots" ADD CONSTRAINT "clinic_slots_scoped_doctor_fk" FOREIGN KEY ("organization_id","doctor_id") REFERENCES "public"."clinic_doctors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_blocked_dates" ADD CONSTRAINT "clinic_blocked_dates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_blocked_dates" ADD CONSTRAINT "clinic_blocked_dates_doctor_id_clinic_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."clinic_doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_blocked_dates" ADD CONSTRAINT "clinic_blocked_dates_scoped_doctor_fk" FOREIGN KEY ("organization_id","doctor_id") REFERENCES "public"."clinic_doctors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctor_id_clinic_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."clinic_doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_patient_id_clinic_people_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."clinic_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_slot_id_clinic_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."clinic_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_scoped_patient_fk" FOREIGN KEY ("organization_id","patient_id") REFERENCES "public"."clinic_people"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_scoped_doctor_fk" FOREIGN KEY ("organization_id","doctor_id") REFERENCES "public"."clinic_doctors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_scoped_slot_fk" FOREIGN KEY ("organization_id","doctor_id","slot_id") REFERENCES "public"."clinic_slots"("organization_id","doctor_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_people_organization_id_idx" ON "clinic_people" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clinic_people_phone_number_idx" ON "clinic_people" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "clinic_doctors_organization_id_idx" ON "clinic_doctors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clinic_slots_organization_id_idx" ON "clinic_slots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clinic_slots_status_idx" ON "clinic_slots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clinic_slots_slot_date_idx" ON "clinic_slots" USING btree ("slot_date");--> statement-breakpoint
CREATE INDEX "clinic_blocked_dates_organization_id_idx" ON "clinic_blocked_dates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clinic_appointments_organization_id_idx" ON "clinic_appointments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clinic_appointments_appointment_date_idx" ON "clinic_appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "clinic_appointments_status_idx" ON "clinic_appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clinic_appointments_slot_id_status_idx" ON "clinic_appointments" USING btree ("slot_id","status");