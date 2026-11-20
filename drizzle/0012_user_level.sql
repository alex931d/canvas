ALTER TABLE "users" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_level_check" CHECK ("users"."level" >= 1);--> statement-breakpoint
-- Everyone who has studied already: their level from their points so far
-- (a flashcard answered is 1 point, a to-do card finished is 5; the level
-- floors are LEVELS in src/lib/buddy/shared.ts).
UPDATE "users" AS u
SET "level" = (
  SELECT count(*)::int
  FROM unnest(ARRAY[0, 20, 50, 100, 175, 275, 400, 550, 750, 1000]) AS l(floor)
  WHERE l.floor <= p.points
)
FROM (
  SELECT "user_id", sum(CASE "kind" WHEN 'review' THEN 1 WHEN 'task' THEN 5 ELSE 0 END) AS points
  FROM "study_events"
  GROUP BY "user_id"
) AS p
WHERE p."user_id" = u."id";
