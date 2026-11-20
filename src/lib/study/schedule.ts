/**
 * Spaced repetition with Leitner boxes. A new card is in box 0. Each time
 * you remember it, it moves up a box (two for "Easy") and comes back after
 * that box's gap; forget it and it drops to box 1 and comes back in ten
 * minutes, so it repeats until it sticks. Shared by the study page and the
 * server, which does the actual scheduling.
 */

export type Grade = "again" | "good" | "easy";

/** Days until a card in each box is due again. Box 0 = new. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35, 75, 160] as const;
export const MAX_BOX = BOX_DAYS.length - 1;
const AGAIN_MINUTES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function schedule(box: number, grade: Grade, now = new Date()): { box: number; dueAt: Date; lapse: boolean } {
  if (grade === "again") {
    return { box: 1, dueAt: new Date(now.getTime() + AGAIN_MINUTES * 60_000), lapse: box >= 2 };
  }
  const next = Math.min(MAX_BOX, Math.max(1, box + (grade === "easy" ? 2 : 1)));
  return { box: next, dueAt: new Date(now.getTime() + BOX_DAYS[next] * DAY_MS), lapse: false };
}

/** "10 min", "1 day", "3 days", "1 week", "5 weeks", "5 months". */
export function gapLabel(box: number, grade: Grade): string {
  if (grade === "again") return `${AGAIN_MINUTES} min`;
  const days = BOX_DAYS[Math.min(MAX_BOX, Math.max(1, box + (grade === "easy" ? 2 : 1)))];
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return `${Math.round(days / 30)} months`;
}
