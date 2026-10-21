CREATE TABLE "clinic_mutation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" varchar(20) NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"resulting_version" integer NOT NULL,
	CONSTRAINT "clinic_mutation_request_unique" UNIQUE("organization_id","request_key"),
	CONSTRAINT "clinic_mutation_operation" CHECK ("clinic_mutation_receipts"."operation" in ('cancel', 'reschedule')),
	CONSTRAINT "clinic_mutation_version" CHECK ("clinic_mutation_receipts"."resulting_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "clinic_reschedule_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"previous_slot_id" uuid NOT NULL,
	"new_slot_id" uuid NOT NULL,
	"previous_date" date NOT NULL,
	"new_date" date NOT NULL,
	"previous_time" time NOT NULL,
	"new_time" time NOT NULL,
	"previous_token" integer NOT NULL,
	"new_token" integer NOT NULL,
	"version" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	CONSTRAINT "clinic_reschedule_version_unique" UNIQUE("organization_id","appointment_id","version"),
	CONSTRAINT "clinic_history_positive" CHECK ("clinic_reschedule_history"."previous_token" > 0 and "clinic_reschedule_history"."new_token" > 0 and "clinic_reschedule_history"."version" > 1)
);
--> statement-breakpoint
CREATE TABLE "clinic_token_counters" (
	"organization_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"last_token" integer NOT NULL,
	CONSTRAINT "clinic_token_counters_organization_id_doctor_id_date_pk" PRIMARY KEY("organization_id","doctor_id","date"),
	CONSTRAINT "clinic_counter_positive" CHECK ("clinic_token_counters"."last_token" > 0)
);
--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_scoped_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "clinic_mutation_receipts" ADD CONSTRAINT "clinic_mutation_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_mutation_receipts" ADD CONSTRAINT "clinic_mutation_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_mutation_receipts" ADD CONSTRAINT "clinic_mutation_receipts_organization_id_appointment_id_clinic_appointments_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."clinic_appointments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reschedule_history" ADD CONSTRAINT "clinic_reschedule_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reschedule_history" ADD CONSTRAINT "clinic_reschedule_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reschedule_history" ADD CONSTRAINT "clinic_reschedule_history_organization_id_appointment_id_clinic_appointments_organization_id_id_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."clinic_appointments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reschedule_history" ADD CONSTRAINT "clinic_reschedule_history_organization_id_doctor_id_previous_slot_id_clinic_slots_organization_id_doctor_id_id_fk" FOREIGN KEY ("organization_id","doctor_id","previous_slot_id") REFERENCES "public"."clinic_slots"("organization_id","doctor_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_reschedule_history" ADD CONSTRAINT "clinic_reschedule_history_organization_id_doctor_id_new_slot_id_clinic_slots_organization_id_doctor_id_id_fk" FOREIGN KEY ("organization_id","doctor_id","new_slot_id") REFERENCES "public"."clinic_slots"("organization_id","doctor_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_token_counters" ADD CONSTRAINT "clinic_token_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_token_counters" ADD CONSTRAINT "clinic_token_counters_organization_id_doctor_id_clinic_doctors_organization_id_id_fk" FOREIGN KEY ("organization_id","doctor_id") REFERENCES "public"."clinic_doctors"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_positive_version" CHECK ("clinic_appointments"."version" > 0);
--> statement-breakpoint
INSERT INTO clinic_token_counters (organization_id, doctor_id, date, last_token) SELECT organization_id, doctor_id, appointment_date, max(token_number) FROM clinic_appointments GROUP BY organization_id, doctor_id, appointment_date ON CONFLICT DO NOTHING;

