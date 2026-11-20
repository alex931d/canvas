CREATE TABLE "drawing_changes" (
	"drawing_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid,
	"ops" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawing_changes_drawing_id_version_pk" PRIMARY KEY("drawing_id","version")
);
--> statement-breakpoint
ALTER TABLE "drawing_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "drawing_members" (
	"drawing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawing_members_drawing_id_user_id_pk" PRIMARY KEY("drawing_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "drawing_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"drawing_id" uuid,
	"deck" text DEFAULT 'Cards' NOT NULL,
	"front" text DEFAULT '' NOT NULL,
	"back" text DEFAULT '' NOT NULL,
	"image" "bytea",
	"image_mime_type" text,
	"image_side" text,
	"image_width" integer,
	"image_height" integer,
	"box" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flashcards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drawings" ADD COLUMN "version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drawings" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "drawings" ADD COLUMN "share_role" text DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "drawing_changes" ADD CONSTRAINT "drawing_changes_drawing_id_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_changes" ADD CONSTRAINT "drawing_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_members" ADD CONSTRAINT "drawing_members_drawing_id_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_members" ADD CONSTRAINT "drawing_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_drawing_id_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_changes_batch_id_idx" ON "drawing_changes" USING btree ("drawing_id","batch_id");--> statement-breakpoint
CREATE INDEX "drawing_members_user_id_idx" ON "drawing_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "flashcards_user_id_due_at_idx" ON "flashcards" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "flashcards_drawing_id_idx" ON "flashcards" USING btree ("drawing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drawings_share_token_idx" ON "drawings" USING btree ("share_token");--> statement-breakpoint
-- Supabase: like 0003, keep the new tables out of the Data API (RLS above
-- already hides their rows). Skipped on PostgreSQL servers without those roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "drawing_members", "drawing_changes", "flashcards" FROM anon, authenticated;
  END IF;
END $$;
