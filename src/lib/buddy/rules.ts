import { z } from "zod";
import { DEFAULT_KINDS, RARITIES, RARITY, raritiesAt, type KindRules, type Kinds, type Rarity } from "./kinds";
import { LEVELS } from "./shared";

/**
 * How wild pandas turn up, for everyone: whether they do at all, how often,
 * how long they stay, and for each rarity how often it's picked, from which
 * level, how far above you and how it behaves in a battle.
 *
 * Admins change these on /admin; they're kept in site_settings under
 * "wild_pandas" (src/lib/site/settings.ts). Pure and shared: the server
 * plays by them, and the admin form and the buddies page show them.
 * Percentages are kept as fractions (0.6), and shown as percents (60).
 */

export type WildRules = {
  /** Wild pandas turn up at all. Off: no new ones (ones already about stay out their time). */
  on: boolean;
  /** The chance one turns up each time it may (0–1). */
  chance: number;
  /** Minutes between chances, counted from when the last one turned up or left. */
  gapMinutes: number;
  /** Minutes one stays on the drawing before wandering off. */
  stayMinutes: number;
  kinds: Kinds;
};

export const DEFAULT_RULES: WildRules = { on: true, chance: 0.6, gapMinutes: 4, stayMinutes: 3, kinds: DEFAULT_KINDS };

export const TOP_LEVEL = LEVELS.length;

type Limit = { min: number; max: number; percent?: true };

/** What the admin form accepts: whole numbers in these ranges (percents for the `percent` ones). */
export const LIMITS = {
  chance: { min: 1, max: 100, percent: true },
  gapMinutes: { min: 1, max: 240 },
  stayMinutes: { min: 1, max: 30 },
  weight: { min: 0, max: 1000 },
  minLevel: { min: 1, max: TOP_LEVEL },
  levelBonus: { min: -3, max: 5 },
  catchRate: { min: 1, max: 100, percent: true },
  flee: { min: 0, max: 50, percent: true },
} as const satisfies Record<string, Limit>;

export type KindField = keyof KindRules;
export const KIND_FIELDS: KindField[] = ["weight", "minLevel", "levelBonus", "catchRate", "flee"];

/** A stored number within `limit` (fractions for percents), else the default. */
const num = (limit: Limit, fallback: number) => {
  const scale = limit.percent ? 100 : 1;
  return z
    .number()
    .min(limit.min / scale)
    .max(limit.max / scale)
    .catch(fallback);
};

const kindSchema = (r: Rarity) =>
  z
    .object({
      weight: num(LIMITS.weight, DEFAULT_KINDS[r].weight),
      minLevel: num(LIMITS.minLevel, DEFAULT_KINDS[r].minLevel),
      levelBonus: num(LIMITS.levelBonus, DEFAULT_KINDS[r].levelBonus),
      catchRate: num(LIMITS.catchRate, DEFAULT_KINDS[r].catchRate),
      flee: num(LIMITS.flee, DEFAULT_KINDS[r].flee),
    })
    .catch(DEFAULT_KINDS[r]);

const rulesSchema = z.object({
  on: z.boolean().catch(DEFAULT_RULES.on),
  chance: num(LIMITS.chance, DEFAULT_RULES.chance),
  gapMinutes: num(LIMITS.gapMinutes, DEFAULT_RULES.gapMinutes),
  stayMinutes: num(LIMITS.stayMinutes, DEFAULT_RULES.stayMinutes),
  kinds: z
    .object(Object.fromEntries(RARITIES.map((r) => [r, kindSchema(r)])) as Record<Rarity, ReturnType<typeof kindSchema>>)
    .catch(DEFAULT_KINDS),
});

/**
 * Rules from what's stored: anything missing or out of range falls back to
 * its default, one value at a time, so a bad value can't stop pandas working.
 */
export function rulesFrom(value: unknown): WildRules {
  const parsed = rulesSchema.safeParse(value ?? {});
  return parsed.success ? (parsed.data as WildRules) : DEFAULT_RULES;
}

// ------------------------------------------------------------ the admin form

export const RULE_LABELS = {
  chance: "Chance each time",
  gapMinutes: "Minutes between chances",
  stayMinutes: "Minutes each one stays",
  weight: "How often",
  minLevel: "From level",
  levelBonus: "Levels above yours",
  catchRate: "Bamboo taken",
  flee: "Runs off a turn",
} as const satisfies Record<keyof typeof LIMITS, string>;

/** A form field's name: "chance", or "rare.weight". */
export const fieldName = (field: keyof typeof LIMITS, rarity?: Rarity) => (rarity ? `${rarity}.${field}` : field);

/** The value a form field shows for `rules` (percents as whole percents). */
export function formValue(rules: WildRules, field: keyof typeof LIMITS, rarity?: Rarity): number {
  const raw = rarity ? rules.kinds[rarity][field as KindField] : (rules[field as "chance" | "gapMinutes" | "stayMinutes"] as number);
  const limit: Limit = LIMITS[field];
  return limit.percent ? Math.round(raw * 100) : raw;
}

export type FormResult = { rules: WildRules; errors?: undefined } | { rules?: undefined; errors: Record<string, string> };

function within(text: string, limit: Limit): number | string {
  const value = text.trim();
  const range = `${limit.min} to ${limit.max}${limit.percent ? " %" : ""}`;
  if (!/^-?\d+$/.test(value)) return `A whole number from ${range}.`;
  const n = Number(value);
  if (n < limit.min || n > limit.max) return `From ${range}.`;
  return limit.percent ? n / 100 : n;
}

/**
 * The admin form, read and checked. Errors are keyed by field name, with
 * "form" for ones about the whole thing.
 */
export function rulesFromForm(form: FormData): FormResult {
  const errors: Record<string, string> = {};
  const read = (field: keyof typeof LIMITS, rarity?: Rarity) => {
    const name = fieldName(field, rarity);
    const raw = form.get(name);
    const got = within(typeof raw === "string" ? raw : "", LIMITS[field]);
    if (typeof got === "string") {
      errors[name] = got;
      return 0;
    }
    return got;
  };
  const rules: WildRules = {
    on: form.get("on") === "on",
    chance: read("chance"),
    gapMinutes: read("gapMinutes"),
    stayMinutes: read("stayMinutes"),
    kinds: Object.fromEntries(
      RARITIES.map((r) => [r, Object.fromEntries(KIND_FIELDS.map((f) => [f, read(f, r)])) as KindRules]),
    ) as Kinds,
  };
  if (Object.keys(errors).length === 0 && RARITIES.every((r) => rules.kinds[r].weight === 0)) {
    errors.form = "Give at least one kind a chance to turn up, or switch wild pandas off instead.";
  }
  return Object.keys(errors).length ? { errors } : { rules };
}

export const sameRules = (a: WildRules, b: WildRules) => JSON.stringify(rulesFrom(a)) === JSON.stringify(rulesFrom(b));

// ------------------------------------------------------------ what they add up to

/** Each kind's share (0–1) of the wild pandas someone at `level` meets; 0 for ones they can't. */
export function sharesAt(level: number, kinds: Kinds): Record<Rarity, number> {
  const open = raritiesAt(level, kinds);
  const total = open.reduce((n, r) => n + kinds[r].weight, 0);
  return Object.fromEntries(RARITIES.map((r) => [r, total > 0 && open.includes(r) ? kinds[r].weight / total : 0])) as Record<
    Rarity,
    number
  >;
}

/** The lowest level that meets any wild panda at all (null: none ever turn up). */
export function firstLevel(kinds: Kinds): number | null {
  const levels = RARITIES.filter((r) => kinds[r].weight > 0).map((r) => kinds[r].minLevel);
  return levels.length ? Math.min(...levels) : null;
}

/** About how many minutes apart they turn up while a drawing is open (a chance every gap, each `chance`). */
export const minutesApart = (rules: Pick<WildRules, "chance" | "gapMinutes">) =>
  rules.chance > 0 ? rules.gapMinutes / rules.chance : Infinity;

/** "about one every 6½ minutes"-style wording for minutesApart. */
export function apartText(rules: Pick<WildRules, "chance" | "gapMinutes">): string {
  const m = minutesApart(rules);
  if (!Number.isFinite(m)) return "never";
  if (m >= 90) {
    const h = Math.round((m / 60) * 2) / 2;
    return `about one every ${String(h).replace(".5", "½")} ${h === 1 ? "hour" : "hours"}`;
  }
  const r = Math.round(m * 2) / 2;
  return `about one every ${String(r).replace(".5", "½")} ${r === 1 ? "minute" : "minutes"}`;
}

/** What a browser needs to know: whether they turn up, and from which level each kind does (null: never). */
export type WildOpenings = { on: boolean; stayMinutes: number; from: Record<Rarity, number | null> };

export const openingsOf = (rules: WildRules): WildOpenings => ({
  on: rules.on,
  stayMinutes: rules.stayMinutes,
  from: Object.fromEntries(RARITIES.map((r) => [r, rules.kinds[r].weight > 0 ? rules.kinds[r].minLevel : null])) as Record<
    Rarity,
    number | null
  >,
});

export const DEFAULT_OPENINGS = openingsOf(DEFAULT_RULES);

/** RARITY's label, for messages. */
export const kindLabel = (r: Rarity) => RARITY[r].label;
