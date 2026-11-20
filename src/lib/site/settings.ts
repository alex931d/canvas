import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings, users } from "@/db/schema";
import { rulesFrom, type WildRules } from "@/lib/buddy/rules";
import { isThemeMode, type ThemeMode } from "@/lib/seasons";

const SEASONAL_THEME = "seasonal_theme";
const WILD_PANDAS = "wild_pandas";

/**
 * The seasonal theme mode, for GET /api/site/theme (which browsers cache for
 * a minute). Pages don't read it on the server, so they stay prerendered;
 * "auto" is worked out in each visitor's browser.
 */
export async function getSeasonalMode(): Promise<ThemeMode> {
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, SEASONAL_THEME));
  return isThemeMode(row?.value) ? row.value : "auto";
}

/** For the admin page: the stored mode and who last changed it. */
export async function readSeasonalSetting() {
  const [row] = await db
    .select({ value: siteSettings.value, updatedAt: siteSettings.updatedAt, updatedByName: users.name })
    .from(siteSettings)
    .leftJoin(users, eq(users.id, siteSettings.updatedBy))
    .where(eq(siteSettings.key, SEASONAL_THEME));
  return {
    mode: isThemeMode(row?.value) ? (row.value as ThemeMode) : ("auto" as ThemeMode),
    updatedAt: row?.updatedAt ?? null,
    updatedByName: row?.updatedByName ?? null,
  };
}

export async function saveSeasonalMode(mode: ThemeMode, actorId: string) {
  await db
    .insert(siteSettings)
    .values({ key: SEASONAL_THEME, value: mode, updatedBy: actorId })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: mode, updatedBy: actorId, updatedAt: new Date() } });
}

// ------------------------------------------------------------ wild pandas

/** The rules wild pandas follow (src/lib/buddy/rules.ts): the defaults until an admin changes them. */
export async function getWildRules(): Promise<WildRules> {
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, WILD_PANDAS));
  return rulesFrom(row?.value);
}

/** For the admin page: the rules and who last changed them. */
export async function readWildSetting() {
  const [row] = await db
    .select({ value: siteSettings.value, updatedAt: siteSettings.updatedAt, updatedByName: users.name })
    .from(siteSettings)
    .leftJoin(users, eq(users.id, siteSettings.updatedBy))
    .where(eq(siteSettings.key, WILD_PANDAS));
  return {
    rules: rulesFrom(row?.value),
    updatedAt: row?.updatedAt ?? null,
    updatedByName: row?.updatedByName ?? null,
  };
}

export async function saveWildRules(rules: WildRules, actorId: string) {
  await db
    .insert(siteSettings)
    .values({ key: WILD_PANDAS, value: rules, updatedBy: actorId })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: rules, updatedBy: actorId, updatedAt: new Date() } });
}
