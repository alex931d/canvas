CREATE TABLE "storage_deletions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"warned_at" timestamp with time zone,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "storage_deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD CONSTRAINT "storage_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;