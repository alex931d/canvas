CREATE TABLE "buddy_collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"ability" text NOT NULL,
	"level" integer NOT NULL,
	"caught_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buddy_collection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "buddy_encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"ability" text NOT NULL,
	"level" integer NOT NULL,
	"status" text DEFAULT 'wild' NOT NULL,
	"state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "buddy_encounters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "buddy_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bamboo_spent" integer DEFAULT 0 NOT NULL,
	"caught" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"last_wild_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "buddy_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buddy_collection" ADD CONSTRAINT "buddy_collection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_encounters" ADD CONSTRAINT "buddy_encounters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_stats" ADD CONSTRAINT "buddy_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buddy_collection_user_id_idx" ON "buddy_collection" USING btree ("user_id","caught_at");--> statement-breakpoint
CREATE INDEX "buddy_encounters_user_id_idx" ON "buddy_encounters" USING btree ("user_id","created_at");--> statement-breakpoint
-- Supabase: like 0003, keep the new tables out of the Data API (RLS above
-- already hides their rows). Skipped on PostgreSQL servers without those roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "buddy_collection" FROM anon, authenticated;
    REVOKE ALL ON TABLE "buddy_encounters" FROM anon, authenticated;
    REVOKE ALL ON TABLE "buddy_stats" FROM anon, authenticated;
  END IF;
END $$;
