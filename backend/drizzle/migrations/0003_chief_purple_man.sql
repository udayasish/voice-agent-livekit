ALTER TABLE "clinic_doctors" ADD COLUMN "name_en" varchar(255);--> statement-breakpoint
ALTER TABLE "clinic_doctors" ADD COLUMN "name_as" varchar(255);--> statement-breakpoint
ALTER TABLE "clinic_doctors" ADD COLUMN "search_aliases" varchar(255)[] DEFAULT ARRAY[]::varchar[] NOT NULL;