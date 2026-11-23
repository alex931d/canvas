/**
 * Kinds of study buddy: how rare a panda is, what it looks like, and the
 * trick it does (on screen, and as its special move in a battle). Shared by
 * the browser and the server.
 *
 * Wild pandas turn up on your drawings from your first day (level 1); rarer
 * ones only once you've studied more (each rarity's `minLevel`). You catch
 * them with bamboo, which you earn by studying (BAMBOO).
 */

export const RARITIES = ["common", "uncommon", "rare", "superRare"] as const;
export type Rarity = (typeof RARITIES)[number];

export type Coat = {
  /** What this coat is called ("Moonlit"). */
  name: string;
  fur: string;
  belly: string;
  /** Ears, eye patches, arms and legs. */
  patch: string;
  /** Outlines. */
  line: string;
  /** A small mark on the forehead. */
  mark?: "crescent" | "star";
  /** A soft glow around it, for the rarest. */
  glow?: string;
};

export type RarityInfo = {
  label: string;
  /** Your level before pandas of this rarity can turn up. */
  minLevel: number;
  /** How often, among the rarities you can meet. */
  weight: number;
  /** A bamboo's chance with a worn-out panda of your level; less while it's fresh. */
  catchRate: number;
  /** Energy and strength, against a common panda's. */
  stat: number;
  /** Wild ones are about this many levels above you. */
  levelBonus: number;
  /** The chance, at the end of each turn from your second, that a wild one runs off. */
  flee: number;
  coat: Coat;
  /** Badge colours. */
  badge: { bg: string; fg: string };
};

export const RARITY: Record<Rarity, RarityInfo> = {
  common: {
    label: "Common",
    minLevel: 1,
    weight: 58,
    catchRate: 0.75,
    stat: 1,
    levelBonus: 0,
    flee: 0,
    coat: { name: "Classic", fur: "#ffffff", belly: "#f3eee8", patch: "#2b2a30", line: "#2b2a30" },
    badge: { bg: "#ece8e3", fg: "#57534e" },
  },
  uncommon: {
    label: "Uncommon",
    minLevel: 3,
    weight: 28,
    catchRate: 0.55,
    stat: 1.1,
    levelBonus: 0,
    flee: 0.03,
    coat: { name: "Cocoa", fur: "#fdf6ee", belly: "#f2e3d1", patch: "#6e4535", line: "#4d2f24" },
    badge: { bg: "#dcefe9", fg: "#1f6965" },
  },
  rare: {
    label: "Rare",
    minLevel: 5,
    weight: 11,
    catchRate: 0.38,
    stat: 1.22,
    levelBonus: 1,
    flee: 0.06,
    coat: { name: "Moonlit", fur: "#f1f4fb", belly: "#dfe5f4", patch: "#2e3d70", line: "#232f58", mark: "crescent" },
    badge: { bg: "#dfe7f6", fg: "#2e4a8a" },
  },
  superRare: {
    label: "Super rare",
    minLevel: 7,
    weight: 3,
    catchRate: 0.22,
    stat: 1.38,
    levelBonus: 2,
    flee: 0.1,
    coat: {
      name: "Golden",
      fur: "#fffaf0",
      belly: "#f9e9c2",
      patch: "#b5832a",
      line: "#6f4f16",
      mark: "star",
      glow: "#f2c95b",
    },
    badge: { bg: "#f6e7bf", fg: "#7a5717" },
  },
};

/** "a rare panda", "an uncommon panda", "a panda". */
export function aPanda(rarity: Rarity) {
  if (rarity === "common") return "a panda";
  const label = RARITY[rarity].label.toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label} panda`;
}

// ------------------------------------------------------------ tricks

export const ABILITIES = ["sprint", "roll", "nap", "snack", "cheer", "dance", "stardust"] as const;
export type Ability = (typeof ABILITIES)[number];

export type AbilityInfo = {
  /** The trick's name. */
  trick: string;
  /** What it does on screen. */
  text: string;
  /** Its special move in a battle. */
  move: string;
  moveText: string;
};

export const ABILITY: Record<Ability, AbilityInfo> = {
  sprint: {
    trick: "Sprint",
    text: "Every so often it dashes across to the other side of the screen.",
    move: "Dash",
    moveText: "A quick hit that always goes first.",
  },
  roll: {
    trick: "Roll",
    text: "Tucks in and somersaults along.",
    move: "Roll",
    moveText: "Hits hard, but misses now and then.",
  },
  nap: {
    trick: "Power nap",
    text: "Curls up for a quick nap, wherever it is.",
    move: "Nap",
    moveText: "Gets back almost half its energy.",
  },
  snack: {
    trick: "Bamboo break",
    text: "Stops for a bamboo snack.",
    move: "Snack",
    moveText: "A little energy back, and its hits get stronger.",
  },
  cheer: {
    trick: "Pep talk",
    text: "Jumps up and cheers you on.",
    move: "Cheer",
    moveText: "Its hits get much stronger.",
  },
  dance: {
    trick: "Dance",
    text: "Breaks into a little spinning dance.",
    move: "Dizzy dance",
    moveText: "Makes the other panda miss more.",
  },
  stardust: {
    trick: "Stardust",
    text: "Floats up in a twinkle of stars.",
    move: "Starfall",
    moveText: "A big hit that never misses.",
  },
};

/** The tricks a panda of each rarity can have. */
export const ABILITY_POOL: Record<Rarity, readonly Ability[]> = {
  common: ["sprint", "nap", "snack"],
  uncommon: ["sprint", "roll", "snack", "cheer"],
  rare: ["roll", "cheer", "dance", "sprint"],
  superRare: ["stardust", "dance"],
};

/** Tricks that move a panda from where it stands (only when it may wander). */
export const MOVING_TRICKS: ReadonlySet<Ability> = new Set(["sprint", "roll"]);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * A panda you made yourself (not caught) is common, with a trick that
 * follows from its id. The first one everybody gets, Bao, sprints.
 */
export function starterAbility(id: string): Ability {
  if (id === "bao") return "sprint";
  const pool = ABILITY_POOL.common;
  return pool[hash(id) % pool.length];
}

// ------------------------------------------------------------ wild pandas and bamboo

/** Bamboo: some to start with, and one more for every 10 points of studying. */
export const BAMBOO = { start: 5, perPoints: 10 } as const;

export const bambooFor = (points: number, spent: number) =>
  Math.max(0, BAMBOO.start + Math.floor(points / BAMBOO.perPoints) - spent);

export const WILD_NAMES = [
  "Pip",
  "Tofu",
  "Nori",
  "Maple",
  "Biscuit",
  "Juniper",
  "Sesame",
  "Pudding",
  "Kiwi",
  "Soba",
  "Clover",
  "Peanut",
  "Miso",
  "Pebble",
  "Fig",
  "Lychee",
  "Yuzu",
  "Hazel",
  "Taro",
  "Udon",
] as const;

/**
 * The numbers for each rarity that admins can change (src/lib/buddy/rules.ts):
 * how often it turns up, from which level, how far above you, and how it
 * behaves in a battle. RARITY holds the defaults.
 */
export type KindRules = Pick<RarityInfo, "weight" | "minLevel" | "levelBonus" | "catchRate" | "flee">;
export type Kinds = Record<Rarity, KindRules>;

export const DEFAULT_KINDS: Kinds = Object.fromEntries(
  RARITIES.map((r) => {
    const { weight, minLevel, levelBonus, catchRate, flee } = RARITY[r];
    return [r, { weight, minLevel, levelBonus, catchRate, flee }];
  }),
) as Kinds;

/** The rarities someone at `level` can meet (ones that turn up at all, from their level). */
export const raritiesAt = (level: number, kinds: Kinds = DEFAULT_KINDS): Rarity[] =>
  RARITIES.filter((r) => kinds[r].weight > 0 && level >= kinds[r].minLevel);

/** A random pick by weight; `rng` returns [0, 1). */
export function pickRarity(level: number, rng: () => number, kinds: Kinds = DEFAULT_KINDS): Rarity | null {
  const open = raritiesAt(level, kinds);
  if (open.length === 0) return null;
  const total = open.reduce((n, r) => n + kinds[r].weight, 0);
  let roll = rng() * total;
  for (const r of open) {
    roll -= kinds[r].weight;
    if (roll < 0) return r;
  }
  return open[open.length - 1];
}

export type WildPanda = {
  name: string;
  rarity: Rarity;
  ability: Ability;
  level: number;
};

/** A wild panda for someone at `level` (null if no rarity is open to them). */
export function rollWild(level: number, rng: () => number, kinds: Kinds = DEFAULT_KINDS): WildPanda | null {
  const rarity = pickRarity(level, rng, kinds);
  if (!rarity) return null;
  const pool = ABILITY_POOL[rarity];
  const spread = Math.floor(rng() * 3) - 1; // -1, 0 or +1
  return {
    name: WILD_NAMES[Math.floor(rng() * WILD_NAMES.length)],
    rarity,
    ability: pool[Math.floor(rng() * pool.length)],
    level: Math.max(1, Math.min(12, level + spread + kinds[rarity].levelBonus)),
  };
}
