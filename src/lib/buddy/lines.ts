import type { Outcome } from "./battle";
import { RARITIES, RARITY, type Rarity } from "./kinds";
import { DEFAULT_OPENINGS } from "./rules";
import { UNLOCKS, type Progress } from "./shared";

/** What the study buddies say. Short, specific, never more than a line or two. */

const pick = <T,>(list: readonly T[], n: number) => list[Math.abs(n) % list.length];

export function greeting(firstName: string, progress: Progress, goal: number, hour: number, n = 0): string {
  const hello = hour < 12 ? `Morning, ${firstName}!` : hour < 18 ? `Hi ${firstName}!` : `Evening, ${firstName}!`;
  if (progress.streak > 1) return `${hello} ${progress.streak} days in a row.`;
  const left = goal - progress.today.reviews;
  if (goal > 0 && left > 0 && progress.today.reviews > 0) return `${hello} ${left} cards to go today.`;
  return `${hello} ${pick(["Ready when you are.", "Let's get going.", "What are we learning today?"], n)}`;
}

/** After a flashcard answer: something every few cards, not every time. */
export function afterReview(
  grade: "again" | "good" | "easy",
  progress: Progress,
  session: { answered: number; missed: number },
  n = 0,
): string | null {
  const today = progress.today.reviews;
  if (grade === "again") {
    if (session.missed % 3 !== 1) return null;
    return pick(["That one comes back soon.", "Tricky one. It'll stick.", "Missing it now is how it sticks later."], n);
  }
  if (session.answered === 1) return pick(["Nice start!", "One down.", "Off we go!"], n);
  if (today > 0 && today % 5 === 0) return `${today} cards today. ${pick(["Keep going!", "Nice pace.", "You're on a roll."], n)}`;
  return null;
}

export function goalReached(goal: number): string {
  return `That's your ${goal} cards for today!`;
}

export function sessionDone(reviewed: number): string {
  return reviewed > 0 ? `All caught up: ${reviewed} ${reviewed === 1 ? "card" : "cards"} this round.` : "Nothing due right now.";
}

export function taskDone(progress: Progress, count: number, n = 0): string {
  const today = progress.today.tasks;
  if (count > 1) return `${count} tasks done!`;
  if (today > 1) return `Task done! ${today} today.`;
  return pick(["Task done!", "Off the list!", "One less thing."], n);
}

/** `from`: the level each kind of wild panda turns up from (null: not at all), as the rules are now. */
export function levelUp(level: number, from: Record<Rarity, number | null> = DEFAULT_OPENINGS.from): string {
  const unlock = UNLOCKS.find((u) => u.level === level);
  const said = unlock ? `Level ${level}! I got ${unlock.label}.` : `Level ${level}!`;
  const opening = RARITIES.filter((r) => from[r] !== null);
  if (opening.length && level > 1 && Math.min(...opening.map((r) => from[r]!)) === level) {
    return `${said} Wild pandas can find your drawings now.`;
  }
  const rarity = RARITIES.find((r) => r !== "common" && from[r] === level);
  return rarity ? `${said} ${RARITY[rarity].label} pandas can turn up now.` : said;
}

/** A buddy spotting a wild panda on the drawing. */
export function wildSpotted(rarity: Rarity, n = 0): string {
  if (rarity === "superRare") return "A golden panda! Gently now…";
  if (rarity === "rare") return pick(["A rare panda! Don't scare it off.", "Look, a moonlit panda!"], n);
  return pick(["A wild panda! Over there.", "Someone's wandered onto your drawing.", "Ooh, a visitor!"], n);
}

/** After a battle: what your buddies say (null: nothing to say). */
export function afterBattle(outcome: Outcome, wildName: string, n = 0): string | null {
  switch (outcome) {
    case "won":
      return `Phew! ${wildName} went off for a rest.`;
    case "lost":
      return pick(["We'll get them next time.", "Rest first, then another go."], n);
    case "fled":
      return `${wildName} got away! Maybe next time.`;
    case "caught":
    case "ran":
      return null;
  }
}

/** A panda you just caught, saying hello. */
export function newcomer(name: string, n = 0): string {
  return `Hi, I'm ${name}! ${pick(["Thanks for the bamboo.", "Nice to meet you.", "I'll help you study."], n)}`;
}
