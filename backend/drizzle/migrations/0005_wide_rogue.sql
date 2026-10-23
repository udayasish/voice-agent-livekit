CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legacy_key" varchar(100),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"business" varchar(20) NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"greeting" text DEFAULT '' NOT NULL,
	"languages" text[] NOT NULL,
	"default_language" varchar(2) NOT NULL,
	"enabled_tools" text[] NOT NULL,
	"appointments_enabled" boolean DEFAULT false NOT NULL,
	"working_hours" jsonb NOT NULL,
	"human_contact" jsonb NOT NULL,
	"context_limits" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "agents_org_legacy_unique" UNIQUE("organization_id","legacy_key"),
	CONSTRAINT "agents_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "agents_version_positive" CHECK ("agents"."version" > 0),
	CONSTRAINT "agents_business_valid" CHECK ("agents"."business" in ('clinic','generic')),
	CONSTRAINT "agents_languages_valid" CHECK (cardinality("agents"."languages") between 1 and 3 and "agents"."languages" <@ ARRAY['as','hi','en']::text[] and "agents"."default_language" = ANY("agents"."languages"))
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_org_created_idx" ON "agents" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "agents_org_active_created_idx" ON "agents" USING btree ("organization_id","is_active","created_at","id");