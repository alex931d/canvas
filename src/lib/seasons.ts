/**
 * Seasonal themes: decorations on the landing page and in the app's menu at
 * Easter, Halloween and Christmas. Safe to import anywhere.
 *
 * Admins choose the mode in /admin (stored in site_settings): "auto" follows
 * the calendar, worked out in each visitor's own time zone; a theme name
 * shows that theme now; "off" shows none. Visitors can hide them for
 * themselves (src/components/seasonal/season-context.tsx).
 */

export const THEMES = ["easter", "halloween", "christmas"] as const;
export type Theme = (typeof THEMES)[number];
export type ThemeMode = "auto" | "off" | Theme;
export const THEME_MODES: readonly ThemeMode[] = ["auto", ...THEMES, "off"];

export const THEME_INFO: Record<Theme, { label: string; decorations: string; when: string }> = {
  easter: { label: "Easter", decorations: "painted eggs, drifting petals and a meadow with a hopping bunny", when: "Palm Sunday to Easter Monday" },
  halloween: { label: "Halloween", decorations: "bats, a spider, flickering jack-o'-lanterns and the odd lights-out", when: "October 15–31" },
  christmas: { label: "Christmas", decorations: "falling snow, candy canes and a candy town with waving elves", when: "December 1–26" },
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

/** Western (Gregorian) Easter Sunday for a year: the anonymous Gregorian algorithm. Month is 1-based. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { month: Math.floor(n / 31), day: (n % 31) + 1 };
}

/** The theme the calendar calls for on this (local) day, or null. */
export function themeForDate(date: Date): Theme | null {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month === 12 && day <= 26) return "christmas";
  if (month === 10 && day >= 15) return "halloween";
  const easter = easterSunday(year);
  const today = Date.UTC(year, month - 1, day);
  const sunday = Date.UTC(year, easter.month - 1, easter.day);
  const DAY = 86_400_000;
  if (today >= sunday - 7 * DAY && today <= sunday + DAY) return "easter";
  return null;
}

/** What a mode shows on this day. */
export function resolveTheme(mode: ThemeMode, date: Date): Theme | null {
  if (mode === "off") return null;
  if (mode === "auto") return themeForDate(date);
  return mode;
}
