CREATE TABLE "email_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"to_address" text NOT NULL,
	"kind" text NOT NULL,
	"priority" smallint NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"body" "bytea",
	"sealed" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "email_jobs_next_idx" ON "email_jobs" USING btree ("priority","run_after","id") WHERE "email_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "email_jobs_status_idx" ON "email_jobs" USING btree ("status","created_at");