import { connection } from "next/server";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { membershipRequiredResponse } from "@/lib/billing/membership";
import { getProgress, getSettings, saveSettings } from "@/lib/buddy/progress";
import { settingsSchema } from "@/lib/buddy/shared";
import { openingsOf } from "@/lib/buddy/rules";
import { bambooLeft, checkParty, getCollection } from "@/lib/buddy/wild";
import { getWildRules } from "@/lib/site/settings";

/**
 * Study buddies. GET: settings, progress (?tz= is the browser's time zone,
 * for what counts as today), the pandas you've caught, your bamboo, and
 * whether wild pandas turn up (and from which level each kind does).
 * PUT: replace the settings (caught pandas in them must be yours).
 */

async function member() {
  const { user } = await getCurrentSession();
  if (!user) return { error: Response.json({ error: "Sign in to see your study buddies" }, { status: 401 }) };
  const notMember = await membershipRequiredResponse(user.id, "Study buddies");
  if (notMember) return { error: notMember };
  return { user };
}

export async function GET(request: Request) {
  await connection();
  const auth = await member();
  if ("error" in auth) return auth.error;
  const tz = new URL(request.url).searchParams.get("tz");
  const [settings, progress, collection, rules] = await Promise.all([
    getSettings(auth.user.id),
    getProgress(auth.user.id, tz),
    getCollection(auth.user.id),
    getWildRules(),
  ]);
  const bamboo = await bambooLeft(auth.user.id, progress.points);
  const firstName = auth.user.name.trim().split(/\s+/)[0] || "there";
  return Response.json(
    { settings, progress, firstName, collection, bamboo, wild: openingsOf(rules) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = await member();
  if ("error" in auth) return auth.error;
  if (!limiters.buddyByUser.consume(auth.user.id)) {
    return Response.json({ error: "Too many changes at once." }, { status: 429 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid settings." }, { status: 422 });
  const problem = await checkParty(auth.user.id, parsed.data);
  if (problem) return Response.json({ error: problem }, { status: 422 });
  await saveSettings(auth.user.id, parsed.data);
  return Response.json({ settings: parsed.data });
}
