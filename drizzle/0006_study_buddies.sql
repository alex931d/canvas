CREATE TABLE "buddy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buddy_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "study_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buddy_settings" ADD CONSTRAINT "buddy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_events" ADD CONSTRAINT "study_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_events_user_id_at_idx" ON "study_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_events_once_idx" ON "study_events" USING btree ("user_id","kind","ref") WHERE "study_events"."ref" is not null;--> statement-breakpoint
-- Supabase: like 0003, keep the new tables out of the Data API (RLS above
-- already hides their rows). Skipped on PostgreSQL servers without those roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "buddy_settings", "study_events" FROM anon, authenticated;
  END IF;
END $$;
