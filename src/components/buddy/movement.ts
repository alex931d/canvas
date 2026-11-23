import type { Ability } from "@/lib/buddy/kinds";
import type { Pose } from "./panda";

/**
 * How pandas get about on screen: a CSS transform transition per move, with
 * a duration that follows the distance (so walking looks like walking and a
 * sprint looks like a sprint), and the pose to show on the way.
 */

/** A panda's size on screen. */
export const W = 64;
export const H = 72;
/** Kept this far from the edges. */
export const EDGE = 8;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Mode = "stroll" | "walk" | "run" | "roll";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const MODE_POSE: Record<Mode, Pose> = { stroll: "walk", walk: "walk", run: "run", roll: "roll" };

const EASE: Record<Mode, string> = {
  stroll: "ease-in-out",
  walk: "linear",
  run: "cubic-bezier(0.45, 0, 0.2, 1)",
  roll: "ease-in-out",
};

/** How long a move takes, in ms: a stroll is always gentle; the rest go at their own speed. */
export function travelMs(mode: Mode, distance: number): number {
  switch (mode) {
    case "stroll":
      return 3200;
    case "walk":
      return Math.round(clamp((distance / 55) * 1000, 1600, 9000));
    case "run":
      return Math.round(clamp((distance / 650) * 1000, 550, 1800));
    case "roll":
      return Math.round(clamp((distance / 180) * 1000, 800, 2000));
  }
}

/** `steady`: one leg of a longer walk, so no slowing down and speeding up at each turn. */
export const transitionFor = (mode: Mode, ms: number, steady = false) =>
  `transform ${Math.round(ms)}ms ${steady ? "linear" : EASE[mode]}`;

/** Where a panda's top-left corner may go so all of it stays inside `r` (less the edge). */
export function room(r: Rect): Rect {
  return {
    x: r.x + EDGE,
    y: r.y + EDGE,
    w: Math.max(0, r.w - W - EDGE * 2),
    h: Math.max(0, r.h - H - EDGE * 2),
  };
}

export const keepIn = (p: Point, r: Rect): Point => ({
  x: clamp(p.x, r.x, r.x + r.w),
  y: clamp(p.y, r.y, r.y + r.h),
});

/** A random spot in `r` (from `room`). */
export const somewhereIn = (r: Rect, rng = Math.random): Point => ({
  x: Math.round(r.x + rng() * r.w),
  y: Math.round(r.y + rng() * r.h),
});

// ------------------------------------------------------------ tricks

/** Tricks done standing still: the pose, and for how long. */
export const ON_THE_SPOT: Record<Exclude<Ability, "sprint" | "roll">, { pose: Pose; ms: number }> = {
  nap: { pose: "sleep", ms: 6000 },
  snack: { pose: "snack", ms: 4500 },
  cheer: { pose: "cheer", ms: 1800 },
  dance: { pose: "dance", ms: 3600 },
  stardust: { pose: "twinkle", ms: 4000 },
};

/** A trick cut short (picked up, opened, fell asleep, or another trick). */
export class Stopped extends Error {}

/** A pause that rejects with Stopped as soon as `signal` aborts. */
export const pause = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new Stopped())), { once: true });
  });

/** Where an element is drawn right now, part-way through a CSS transform transition (its translate). */
export function translateNow(el: Element): Point {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { x: m.m41, y: m.m42 };
}
