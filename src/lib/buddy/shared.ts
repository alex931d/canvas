import { z } from "zod";

/**
 * Study buddies: small pandas that float over the app, can be dragged
 * around or hidden, and keep track of how studying is going.
 *
 * Progress comes from study events: a flashcard answered is 1 point, a
 * to-do card moved into a board's last column is 5. Points add up to levels,
 * and levels unlock things for the pandas to wear.
 */

export const BUDDY_COLORS = ["#277c78", "#c94736", "#3f82b2", "#826cb0", "#cab361", "#be6c49"] as const;
export const DEFAULT_NAMES = ["Bao", "Mochi", "Dumpling"] as const;
export const MAX_BUDDIES = 3;

export const POINTS = { review: 1, task: 5 } as const;

/** Points needed for each level (index 0 = level 1). */
export const LEVELS = [0, 20, 50, 100, 175, 275, 400, 550, 750, 1000] as const;

export type Accessory = "scarf" | "glasses" | "cap";

/** What each level unlocks, in order. */
export const UNLOCKS: { level: number; accessory: Accessory; label: string }[] = [
  { level: 2, accessory: "scarf", label: "a scarf" },
  { level: 4, accessory: "glasses", label: "reading glasses" },
  { level: 6, accessory: "cap", label: "a graduation cap" },
];

export function levelFor(points: number) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]) level = i + 1;
  const floor = LEVELS[level - 1];
  const next = level < LEVELS.length ? LEVELS[level] : null;
  return { level, floor, next };
}

export const accessoriesFor = (level: number): Accessory[] =>
  UNLOCKS.filter((u) => level >= u.level).map((u) => u.accessory);

export const buddySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(24),
  color: z.enum(BUDDY_COLORS),
  /** Where it lives, as a fraction of the window's width and height (null: the default corner). */
  x: z.number().min(0).max(1).nullable(),
  y: z.number().min(0).max(1).nullable(),
  /**
   * A panda you caught (its buddy_collection row), which keeps its rarity and
   * trick; missing for one you made yourself (common, see starterAbility).
   */
  catchId: z.uuid().optional(),
});

export const settingsSchema = z.object({
  visible: z.boolean(),
  /** Drift about near their spot (off: stay put). */
  wander: z.boolean(),
  /** On a drawing, climb onto the canvas and walk about on it, in its coordinates (needs `wander`). */
  roam: z.boolean().default(false),
  /** Do their tricks now and then (sprint across the screen, nap, dance…). */
  tricks: z.boolean().default(true),
  /** Wild pandas may turn up on your drawings, to battle and catch. */
  wild: z.boolean().default(true),
  /** Flashcards a day; 0 turns the goal off. */
  dailyGoal: z.number().int().min(0).max(500),
  buddies: z.array(buddySchema).min(1).max(MAX_BUDDIES),
});

export type Buddy = z.infer<typeof buddySchema>;
export type BuddySettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: BuddySettings = {
  visible: true,
  wander: true,
  roam: false,
  tricks: true,
  wild: true,
  dailyGoal: 20,
  buddies: [{ id: "bao", name: "Bao", color: "#277c78", x: null, y: null }],
};

export type Progress = {
  /** In the person's own time zone. */
  today: { reviews: number; tasks: number };
  /** Days in a row with something studied, counting today or yesterday. */
  streak: number;
  points: number;
  level: number;
  /** Points where this level starts and the next begins (null at the top level). */
  levelFloor: number;
  nextLevel: number | null;
};

/**
 * Consecutive days ending today (or yesterday, if nothing yet today) from a
 * list of days with activity, newest first, as YYYY-MM-DD strings.
 */
export function streakFrom(days: readonly string[], today: string): number {
  const set = new Set(days);
  const step = (d: string, by: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + by);
    return t.toISOString().slice(0, 10);
  };
  let day = set.has(today) ? today : step(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = step(day, -1);
  }
  return n;
}
