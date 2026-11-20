import { ABILITY, aPanda, RARITY, type Ability, type Rarity } from "./kinds";

/**
 * Panda battles: turn based, one of your buddies against a wild panda.
 * Wear it down, then offer bamboo: the weaker it is, the likelier it stays.
 * Wear it out completely and it wanders off instead.
 *
 * Pure functions with the randomness passed in, so the server can run every
 * turn (it keeps the state; the browser only animates the steps it gets
 * back) and the unit checks can replay a battle exactly.
 */

export type Side = "you" | "wild";

export type Fighter = {
  /** Your buddy's id, or "wild". */
  id: string;
  name: string;
  rarity: Rarity;
  ability: Ability;
  level: number;
  /** Scarf colour (yours), for drawing it. */
  color: string;
  maxHp: number;
  hp: number;
  attack: number;
  speed: number;
  /** How hard it hits: -2 (timid) to +3. */
  power: number;
  /** How well it aims: -3 (very dizzy) to 0. */
  aim: number;
};

export type Outcome = "caught" | "won" | "lost" | "ran" | "fled";

export type BattleState = {
  v: 1;
  turn: number;
  you: Fighter[];
  active: number;
  /** Your buddy is worn out: pick another before anything else. */
  mustSwitch: boolean;
  wild: Fighter;
  /** Your study level (your buddies fight at it). */
  yourLevel: number;
  /** Bamboo you have, kept up to date by the server before each turn. */
  bamboo: number;
  bambooUsed: number;
  over: Outcome | null;
  /**
   * The wild panda's catch rate and chance of running off, as the rules were
   * when the battle began (src/lib/buddy/rules.ts). Missing in battles from
   * before admins could change them: then its rarity's defaults.
   */
  rates?: Rates;
};

export type Rates = { catchRate: number; flee: number };

/** The catch rate and run-off chance a battle plays with. */
export const ratesOf = (s: Pick<BattleState, "rates" | "wild">): Rates =>
  s.rates ?? { catchRate: RARITY[s.wild.rarity].catchRate, flee: RARITY[s.wild.rarity].flee };

export const BASIC_MOVES = ["bump", "swipe", "stare"] as const;
export type MoveId = (typeof BASIC_MOVES)[number] | "special";

export const MOVE: Record<(typeof BASIC_MOVES)[number], { name: string; text: string }> = {
  bump: { name: "Bump", text: "A friendly shove that always lands." },
  swipe: { name: "Paw swipe", text: "Stronger, but misses now and then." },
  stare: { name: "Stare", text: "A long look that makes the other panda hit softer." },
};

export const moveName = (move: MoveId, ability: Ability) =>
  move === "special" ? ABILITY[ability].move : MOVE[move].name;

export type Action =
  | { type: "move"; move: MoveId }
  | { type: "bamboo" }
  | { type: "switch"; to: number }
  | { type: "run" };

/** What happened, one step at a time: words to show, and something to animate. */
export type Fx =
  | { kind: "appear" }
  | { kind: "use"; side: Side; move: MoveId }
  | { kind: "hit"; side: Side; damage: number; hp: number; strong: boolean }
  | { kind: "miss"; side: Side }
  | { kind: "heal"; side: Side; amount: number; hp: number }
  | { kind: "stat"; side: Side; stat: "power" | "aim"; change: number }
  | { kind: "bamboo"; wobbles: 0 | 1 | 2 | 3; caught: boolean }
  | { kind: "tired"; side: Side }
  | { kind: "switch"; to: number }
  | { kind: "end"; outcome: Outcome };

export type Step = { text?: string; fx?: Fx };

export class BattleError extends Error {}

type Rng = () => number;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------ setting up

export type FighterBase = Pick<Fighter, "id" | "name" | "rarity" | "ability" | "level" | "color">;

export function makeFighter(base: FighterBase): Fighter {
  const stat = RARITY[base.rarity].stat;
  const maxHp = Math.round((24 + base.level * 6) * stat);
  return {
    ...base,
    maxHp,
    hp: maxHp,
    attack: Math.round((6 + base.level * 2) * stat),
    speed: 10 + base.level * 2 + (base.ability === "sprint" ? 8 : 0) + Math.round((stat - 1) * 10),
    power: 0,
    aim: 0,
  };
}

/** A battle against `wild` with your `team` (your buddies, at your level), starting with team[first]. */
export function startBattle(opts: {
  team: Omit<FighterBase, "level">[];
  first?: number;
  wild: FighterBase;
  yourLevel: number;
  bamboo: number;
  /** The wild panda's catch rate and run-off chance (default: its rarity's). */
  rates?: Rates;
}): { state: BattleState; steps: Step[] } {
  if (opts.team.length === 0) throw new BattleError("You need a buddy to battle with.");
  const active = clamp(opts.first ?? 0, 0, opts.team.length - 1);
  const state: BattleState = {
    v: 1,
    turn: 0,
    you: opts.team.map((b) => makeFighter({ ...b, level: opts.yourLevel })),
    active,
    mustSwitch: false,
    wild: makeFighter(opts.wild),
    yourLevel: opts.yourLevel,
    bamboo: opts.bamboo,
    bambooUsed: 0,
    over: null,
    rates: opts.rates ?? ratesOf({ wild: makeFighter(opts.wild) }),
  };
  const article = aPanda(opts.wild.rarity);
  return {
    state,
    steps: [
      { text: `${article[0].toUpperCase()}${article.slice(1)} wanders up: it's ${opts.wild.name}!`, fx: { kind: "appear" } },
      { text: `Go, ${state.you[active].name}!` },
    ],
  };
}

// ------------------------------------------------------------ the numbers

const powerMult = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));
const aimMult = (stage: number) => (stage >= 0 ? 1 : 3 / (3 - stage));

/** The chance a bamboo offered now is taken (`catchRate`: at its last breath, by a panda of your level). */
export function catchChance(wild: Fighter, yourLevel: number, catchRate = RARITY[wild.rarity].catchRate) {
  const health = wild.hp / wild.maxHp;
  const levels = clamp(1 + (yourLevel - wild.level) * 0.1, 0.6, 1.4);
  return clamp(catchRate * (1 - 0.7 * health) * levels, 0.02, 0.95);
}

type MoveSpec = { power?: number; accuracy: number; first?: boolean };

function spec(move: MoveId, ability: Ability): MoveSpec {
  switch (move) {
    case "bump":
      return { power: 40, accuracy: 1 };
    case "swipe":
      return { power: 55, accuracy: 0.9 };
    case "stare":
      return { accuracy: 1 };
    case "special":
      switch (ability) {
        case "sprint":
          return { power: 45, accuracy: 1, first: true };
        case "roll":
          return { power: 80, accuracy: 0.75 };
        case "stardust":
          return { power: 90, accuracy: 1 };
        default:
          return { accuracy: 1 };
      }
  }
}

// ------------------------------------------------------------ a turn

type Ctx = { s: BattleState; steps: Step[]; rng: Rng };

const fighter = (s: BattleState, side: Side) => (side === "wild" ? s.wild : s.you[s.active]);
const other = (side: Side): Side => (side === "you" ? "wild" : "you");

function playMove(c: Ctx, side: Side, move: MoveId) {
  const me = fighter(c.s, side);
  const them = fighter(c.s, other(side));
  const sp = spec(move, me.ability);
  c.steps.push({ text: `${me.name} used ${moveName(move, me.ability)}!`, fx: { kind: "use", side, move } });

  const targetsThem = sp.power !== undefined || move === "stare" || (move === "special" && me.ability === "dance");
  if (targetsThem && c.rng() >= sp.accuracy * aimMult(me.aim)) {
    c.steps.push({ text: "It missed!", fx: { kind: "miss", side } });
    return;
  }

  if (sp.power !== undefined) {
    const strong = c.rng() < 1 / 16;
    const raw = (sp.power * me.attack * powerMult(me.power)) / 50;
    const damage = Math.max(1, Math.round(raw * (0.85 + c.rng() * 0.15) * (strong ? 1.5 : 1)));
    them.hp = Math.max(0, them.hp - damage);
    c.steps.push({ fx: { kind: "hit", side: other(side), damage, hp: them.hp, strong } });
    if (strong) c.steps.push({ text: "A great hit!" });
    return;
  }

  if (move === "stare") {
    if (them.power <= -2) return void c.steps.push({ text: "It didn't do anything." });
    them.power -= 1;
    c.steps.push({ text: `${them.name} looks a little timid.`, fx: { kind: "stat", side: other(side), stat: "power", change: -1 } });
    return;
  }

  switch (me.ability) {
    case "nap":
    case "snack": {
      const share = me.ability === "nap" ? 0.45 : 0.25;
      const amount = Math.min(me.maxHp - me.hp, Math.round(me.maxHp * share));
      if (amount > 0) {
        me.hp += amount;
        c.steps.push({
          text: `${me.name} ${me.ability === "nap" ? "woke up refreshed" : "munched some bamboo"}.`,
          fx: { kind: "heal", side, amount, hp: me.hp },
        });
      } else if (me.ability === "nap") {
        c.steps.push({ text: `${me.name} is already full of energy.` });
      }
      if (me.ability === "snack") boost(c, side, "power", 1);
      return;
    }
    case "cheer":
      return boost(c, side, "power", 2);
    case "dance": {
      if (them.aim <= -3) return void c.steps.push({ text: `${them.name} can't get any dizzier.` });
      them.aim -= 1;
      c.steps.push({ text: `${them.name} is getting dizzy!`, fx: { kind: "stat", side: other(side), stat: "aim", change: -1 } });
      return;
    }
  }
}

function boost(c: Ctx, side: Side, stat: "power", by: number) {
  const me = fighter(c.s, side);
  const next = Math.min(3, me.power + by);
  const change = next - me.power;
  if (change <= 0) return void c.steps.push({ text: `${me.name} can't get any stronger.` });
  me.power = next;
  c.steps.push({
    text: `${me.name} feels ${change > 1 ? "much " : ""}stronger!`,
    fx: { kind: "stat", side, stat, change },
  });
}

/** What the wild panda does: mostly hits, rests when it's low and can. */
function wildChoice(c: Ctx): MoveId {
  const w = c.s.wild;
  const you = fighter(c.s, "you");
  const low = w.hp / w.maxHp < 0.35;
  if (low && (w.ability === "nap" || w.ability === "snack") && c.rng() < 0.6) return "special";
  const r = c.rng();
  if (r < 0.38) return "bump";
  if (r < 0.74) return "swipe";
  if (r < 0.86) return you.power > -2 ? "stare" : "bump";
  if (w.ability === "cheer" && w.power >= 3) return "swipe";
  if (w.ability === "dance" && you.aim <= -3) return "swipe";
  return "special";
}

/** After a hit: anyone worn out? Returns true when the battle stops here. */
function settle(c: Ctx): boolean {
  const s = c.s;
  if (s.wild.hp <= 0) {
    c.steps.push({ text: `${s.wild.name} is worn out!`, fx: { kind: "tired", side: "wild" } });
    c.steps.push({ text: `${s.wild.name} wanders off for a rest.`, fx: { kind: "end", outcome: "won" } });
    s.over = "won";
    return true;
  }
  const me = s.you[s.active];
  if (me.hp <= 0) {
    c.steps.push({ text: `${me.name} is worn out!`, fx: { kind: "tired", side: "you" } });
    if (s.you.some((b) => b.hp > 0)) {
      s.mustSwitch = true;
      c.steps.push({ text: "Who's next?" });
    } else {
      c.steps.push({
        text: `Your buddies need a rest. ${s.wild.name} wanders off.`,
        fx: { kind: "end", outcome: "lost" },
      });
      s.over = "lost";
    }
    return true;
  }
  return false;
}

function wildTurn(c: Ctx) {
  playMove(c, "wild", wildChoice(c));
  settle(c);
}

/** Rarer wild pandas may run off once the battle has gone on a bit. */
function maybeFlee(c: Ctx) {
  const s = c.s;
  if (s.over || s.mustSwitch || s.turn < 2) return;
  if (c.rng() < ratesOf(s).flee) {
    c.steps.push({ text: `${s.wild.name} ran off into the bamboo!`, fx: { kind: "end", outcome: "fled" } });
    s.over = "fled";
  }
}

/** Play one action. Returns a new state (the old one is left as it was) and the steps to show. */
export function act(state: BattleState, action: Action, rng: Rng): { state: BattleState; steps: Step[] } {
  if (state.over) throw new BattleError("This battle is over.");
  const s: BattleState = structuredClone(state);
  const c: Ctx = { s, steps: [], rng };

  if (s.mustSwitch && action.type !== "switch" && action.type !== "run") {
    throw new BattleError("Pick another buddy first.");
  }

  switch (action.type) {
    case "run":
      c.steps.push({ text: "You slipped away.", fx: { kind: "end", outcome: "ran" } });
      s.over = "ran";
      break;

    case "switch": {
      const to = action.to;
      const next = s.you[to];
      if (!next || to === s.active || next.hp <= 0) throw new BattleError("That buddy can't come out.");
      const free = s.mustSwitch;
      if (!free) c.steps.push({ text: `Come back, ${s.you[s.active].name}!` });
      s.active = to;
      s.mustSwitch = false;
      c.steps.push({ text: `Go, ${next.name}!`, fx: { kind: "switch", to } });
      if (!free) wildTurn(c);
      break;
    }

    case "bamboo": {
      if (s.bamboo <= 0) throw new BattleError("You're out of bamboo. Study a little to earn more.");
      s.bamboo -= 1;
      s.bambooUsed += 1;
      const chance = catchChance(s.wild, s.yourLevel, ratesOf(s).catchRate);
      // Three nibbles, each needing to go well: the cube root keeps the overall chance.
      const each = Math.cbrt(chance);
      let wobbles = 0;
      while (wobbles < 3 && rng() < each) wobbles++;
      const caught = wobbles === 3;
      c.steps.push({ text: `You offer ${s.wild.name} some bamboo…`, fx: { kind: "bamboo", wobbles: wobbles as 0 | 1 | 2 | 3, caught } });
      if (caught) {
        c.steps.push({ text: `${s.wild.name} took the bamboo and joined your buddies!`, fx: { kind: "end", outcome: "caught" } });
        s.over = "caught";
      } else {
        c.steps.push({
          text: [`${s.wild.name} pushed it away!`, `${s.wild.name} almost took it!`, `So close! ${s.wild.name} changed its mind.`][wobbles],
        });
        wildTurn(c);
      }
      break;
    }

    case "move": {
      const you = s.you[s.active];
      const wildMove = wildChoice(c);
      const youFirst = spec(action.move, you.ability).first
        ? true
        : spec(wildMove, s.wild.ability).first
          ? false
          : you.speed === s.wild.speed
            ? rng() < 0.5
            : you.speed > s.wild.speed;
      const order: [Side, MoveId][] = youFirst
        ? [
            ["you", action.move],
            ["wild", wildMove],
          ]
        : [
            ["wild", wildMove],
            ["you", action.move],
          ];
      for (const [side, move] of order) {
        playMove(c, side, move);
        if (settle(c)) break;
      }
      break;
    }
  }

  s.turn += 1;
  maybeFlee(c);
  return { state: s, steps: c.steps };
}

/** What the browser may see of a battle (all of it: nothing here is secret). */
export type BattleView = BattleState & { chance: number };

export const viewOf = (s: BattleState): BattleView => ({ ...s, chance: catchChance(s.wild, s.yourLevel, ratesOf(s).catchRate) });
