import type { BattleView, Step } from "./battle";
import { starterAbility, type Ability, type Rarity } from "./kinds";
import type { Buddy } from "./shared";

/**
 * The buddy game as the browser sees it: pandas you've caught, wild pandas,
 * and what a battle turn sends back. Shared by the API routes and the client.
 */

export type CaughtBuddy = {
  id: string;
  name: string;
  rarity: Rarity;
  ability: Ability;
  /** Its level when it was caught. */
  level: number;
  caughtAt: string;
};

export type WildEncounter = {
  id: string;
  name: string;
  rarity: Rarity;
  ability: Ability;
  level: number;
  status: "wild" | "battle";
  /** When it wanders off, unless a battle has started. */
  expiresAt: string;
  /** The battle so far, when one has started (to pick it up again after a reload). */
  battle: BattleView | null;
};

export type BattleReply = {
  battle: BattleView;
  steps: Step[];
  /** Bamboo left. */
  bamboo: number;
  /** The panda that just joined you, and whether it's out walking with you already. */
  caught: (CaughtBuddy & { walking: boolean }) | null;
};

export type BuddyKind = { rarity: Rarity; ability: Ability };

/** The id a caught panda goes by while it walks with you. */
export const partyIdFor = (catchId: string) => `c${catchId.slice(0, 8)}`;

/** What kind of panda one of your buddies is: caught ones keep theirs, ones you made are common. */
export function kindOf(b: Pick<Buddy, "id" | "catchId">, collection: readonly CaughtBuddy[]): BuddyKind {
  const caught = b.catchId ? collection.find((c) => c.id === b.catchId) : undefined;
  return caught ? { rarity: caught.rarity, ability: caught.ability } : { rarity: "common", ability: starterAbility(b.id) };
}
