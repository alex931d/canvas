ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drawings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase: keep these tables out of the Data API entirely. Projects created
-- before Supabase's 2026 change grant the browser roles (anon, authenticated)
-- access to every new table in public; RLS above already hides the rows, and
-- this removes the grants too. Skipped on PostgreSQL servers without those roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "users", "sessions", "drawings", "assets" FROM anon, authenticated;
  END IF;
END $$;
