ALTER TABLE "clinic_appointments" ADD COLUMN "request_key" uuid;--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_request_unique" UNIQUE("organization_id","request_key");