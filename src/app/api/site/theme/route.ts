import { getSeasonalMode } from "@/lib/site/settings";

/**
 * The site's seasonal theme mode, for every page's decorations
 * (src/components/seasonal/season-context.tsx). Public, and cached by
 * browsers for a minute, so a change in /admin reaches everyone within one.
 */
export async function GET() {
  let mode;
  try {
    mode = await getSeasonalMode();
  } catch (err) {
    console.error("[site] couldn't read the seasonal theme:", err);
    mode = "auto";
  }
  return Response.json(
    { mode },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" } },
  );
}
