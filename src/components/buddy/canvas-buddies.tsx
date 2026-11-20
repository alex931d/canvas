"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { BuddyKind, WildEncounter } from "@/lib/buddy/game";
import { aPanda, MOVING_TRICKS, RARITY } from "@/lib/buddy/kinds";
import {
  buildGrid,
  clearLine,
  edgeSpots,
  findPath,
  freeSpots,
  isFree,
  nearestFree,
  obstaclesOf,
  pathClear,
  touchesDrawing,
  type Body,
  type Grid,
} from "@/lib/buddy/pathing";
import type { Accessory, Buddy } from "@/lib/buddy/shared";
import type { CanvasElement } from "@/lib/canvas/schema";
import { currentScene, currentView, onScene, onView, type View } from "@/lib/canvas/view-bus";
import { cn } from "@/lib/utils";
import {
  clamp,
  H,
  MODE_POSE,
  ON_THE_SPOT,
  pause,
  Stopped,
  transitionFor,
  translateNow,
  travelMs,
  W,
  type Mode,
  type Point,
  type Rect,
} from "./movement";
import { Panda, type Pose } from "./panda";

/**
 * Pandas that live on the drawing itself, as part of it: positioned in the
 * drawing's own coordinates inside the board (src/components/editor/board.tsx
 * marks it with data-buddy-stage), so they move with it when you scroll or
 * pan, are exactly as much bigger or smaller as everything else when you zoom,
 * are clipped to it and sit under its tool bars. Each stands at its feet; only
 * its words stay the same size on screen, so they can be read.
 *
 * Nothing about them depends on where you're looking. Each has its own patch
 * of the drawing (about a screenful, fixed where it first climbed on) and
 * walks about that, wherever the camera goes; its spot and patch are kept for
 * each drawing in this browser, so it's where you left it next time too.
 *
 * They keep off what's drawn: every walk is planned around it
 * (src/lib/buddy/pathing.ts), they only stop on clear paper, and if something
 * gets drawn on or across their way they step aside or find another way.
 */

export type Box = { x: number; y: number; w: number; h: number };

const FAR_VIEW: View = { x: 0, y: 0, z: 1 };
/** A panda's body (a little inside its 64×72 box), in drawing units: always this size, like anything drawn. */
const BODY: Body = { hw: (W / 2) * 0.78, h: H * 0.92 };
/** Kept this far off anything drawn. */
const PAD = 6;
/** Spots on the planning grid are this far apart. */
const CELL = 22;
/** How big a panda's patch of the drawing is (about a screenful when it climbs on, within these). */
const PATCH = { minW: 700, maxW: 1600, minH: 450, maxH: 1000 };

/** The camera layer: everything inside is in world coordinates. */
export function WorldLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Straight onto the element, in the same frame as the drawing (no re-render per frame).
    const follow = (v: View) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `scale(${v.z}) translate(${-v.x}px, ${-v.y}px)`;
      // Words stay their size on screen; everything else zooms with the drawing.
      el.style.setProperty("--buddy-unfit", String(1 / v.z));
    };
    follow(currentView() ?? FAR_VIEW);
    return onView(follow);
  }, []);
  return (
    <div ref={ref} className="buddy-world" data-testid="buddy-world">
      {children}
    </div>
  );
}

// ------------------------------------------------------------ shared bits

const stageSize = (stage: HTMLElement) => ({ w: stage.clientWidth, h: stage.clientHeight });

/** A point on screen (window coordinates) as a point on the drawing. */
export function screenToWorld(p: Point, stage: HTMLElement): Point {
  const v = currentView() ?? FAR_VIEW;
  const r = stage.getBoundingClientRect();
  return { x: v.x + (p.x - r.left) / v.z, y: v.y + (p.y - r.top) / v.z };
}

type Side = "left" | "right";

/** The part of the drawing in view now, as a patch (centred, within PATCH's sizes). */
function patchOfView(v: View, stage: HTMLElement): Rect {
  const { w, h } = stageSize(stage);
  const vw = w / v.z;
  const vh = h / v.z;
  const pw = clamp(vw, PATCH.minW, PATCH.maxW);
  const ph = clamp(vh, PATCH.minH, PATCH.maxH);
  return { x: v.x + vw / 2 - pw / 2, y: v.y + vh / 2 - ph / 2, w: pw, h: ph };
}

/** A patch the same size as `patch`, centred on `p` (where a panda was put down). */
const patchAround = (p: Point, patch: Rect): Rect => ({ x: p.x - patch.w / 2, y: p.y - patch.h / 2, w: patch.w, h: patch.h });

/** Where feet may go in a patch: all of the panda inside it. */
const roomOf = (patch: Rect): Rect => ({
  x: patch.x + BODY.hw,
  y: patch.y + BODY.h,
  w: Math.max(0, patch.w - BODY.hw * 2),
  h: Math.max(0, patch.h - BODY.h - 4),
});

const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Just past the left or right side of `patch`, level with `y`. */
const pastSide = (side: Side, patch: Rect, y: number): Point => ({
  x: side === "left" ? patch.x - W : patch.x + patch.w + W,
  y,
});

// ------------------------------------------------------------ spots kept per drawing

type Spot = { feet: Point; patch: Rect };

const drawingId = () => /\/drawings\/([0-9a-f-]{36})/.exec(window.location.pathname)?.[1] ?? null;
const finite = (...n: unknown[]) => n.every((v) => typeof v === "number" && Number.isFinite(v));

/** Where this buddy was on this drawing last time (in this browser). */
function loadSpot(buddyId: string): Spot | null {
  const id = drawingId();
  if (!id) return null;
  try {
    const all = JSON.parse(localStorage.getItem(`buddy-spots:${id}`) ?? "{}") as Record<string, Spot>;
    const s = all[buddyId];
    if (!s || !finite(s.feet?.x, s.feet?.y, s.patch?.x, s.patch?.y, s.patch?.w, s.patch?.h)) return null;
    return { feet: { x: s.feet.x, y: s.feet.y }, patch: s.patch };
  } catch {
    return null;
  }
}

function saveSpot(buddyId: string, spot: Spot) {
  const id = drawingId();
  if (!id) return;
  try {
    const key = `buddy-spots:${id}`;
    const all = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, Spot>;
    all[buddyId] = spot;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* storage full or blocked: it just won't remember */
  }
}

/** Calls `changed` a moment after something is drawn, moved or rubbed out. */
function useSceneChanged(changed: () => void) {
  const cb = useRef(changed);
  useLayoutEffect(() => {
    cb.current = changed;
  });
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onScene(() => {
      clearTimeout(t);
      t = setTimeout(() => cb.current(), 250);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
}

type Travel = { mode: Mode; ms: number; steady: boolean };

/**
 * Where a panda on the canvas is and how it gets about: `walk` takes its feet
 * along a path on the drawing (one straight leg after another, at an even
 * pace), `go` straight to a point, `halt` stops it where it is, `jump` puts
 * it somewhere at once. `plan` is the walk under way (for checking it's
 * still clear).
 */
function useFeet(start: () => Point, reduceMotion: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const [feet, setFeet] = useState<Point>(start);
  const [travel, setTravel] = useState<Travel | null>(null);
  const [facing, setFacing] = useState<"left" | "right">("left");
  const feetRef = useRef(feet);
  const travelRef = useRef(travel);
  /** Stops waiting for the leg under way to finish (its listener and fallback timer). */
  const legWait = useRef<(() => void) | null>(null);
  const stopLeg = useCallback(() => {
    legWait.current?.();
    legWait.current = null;
  }, []);
  /** The walk under way: its points, and the one it's heading for. */
  const plan = useRef<{ points: Point[]; next: number; mode: Mode } | null>(null);
  const reduce = useRef(reduceMotion);
  useLayoutEffect(() => {
    reduce.current = reduceMotion;
  });

  const setTravelBoth = useCallback((t: Travel | null) => {
    travelRef.current = t;
    setTravel(t);
  }, []);

  /** Where its feet are drawn right now (part-way through a walk, say). */
  const now = useCallback((): Point => {
    const el = ref.current;
    if (!el || !travelRef.current) return feetRef.current;
    const t = translateNow(el);
    return { x: t.x + W / 2, y: t.y + H };
  }, []);

  const jump = useCallback(
    (to: Point) => {
      stopLeg();
      plan.current = null;
      setTravelBoth(null);
      feetRef.current = to;
      setFeet(to);
    },
    [setTravelBoth, stopLeg],
  );

  const halt = useCallback(() => {
    if (travelRef.current) jump(now());
  }, [jump, now]);

  // Reduce motion turned on part-way through a walk: stop there.
  useEffect(() => {
    if (!reduceMotion) return;
    const f = requestAnimationFrame(halt);
    return () => cancelAnimationFrame(f);
  }, [reduceMotion, halt]);

  /** Along `path` (its first point is where it is); returns how long the whole walk takes. */
  const walk = useCallback(
    (path: readonly Point[], mode: Mode): number => {
      const points = [now(), ...path.slice(1)];
      stopLeg();
      plan.current = null;
      const legs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      const total = legs.reduce((a, b) => a + b, 0);
      const last = points[points.length - 1];
      if (reduce.current || total < 2) {
        jump(last);
        return 0;
      }
      // At a panda's pace on the drawing (so faster on screen when zoomed in, like everything), even all the way.
      const ms = travelMs(mode, total);
      const steady = legs.length > 1;
      plan.current = { points, next: 1, mode };
      const leg = (i: number) => {
        const from = points[i - 1];
        const to = points[i];
        const legMs = (ms * legs[i - 1]) / Math.max(total, 1e-9);
        if (Math.abs(to.x - from.x) > 2) setFacing(to.x < from.x ? "left" : "right");
        feetRef.current = to;
        setFeet(to);
        setTravelBoth({ mode, ms: legMs, steady });
        if (plan.current) plan.current.next = i;
        const next = () => {
          stopLeg();
          if (i + 1 < points.length) leg(i + 1);
          else {
            plan.current = null;
            setTravelBoth(null);
          }
        };
        // The next leg starts when this one's move has really finished. It starts a frame or
        // so after this runs (later on a busy page), so a timer alone would turn the corner
        // early and cut across it, maybe over something drawn. The timer is only in case no
        // transitionend comes (a leg too short to move, say).
        const el = ref.current;
        const ended = (e: TransitionEvent) => {
          if (e.target === el && e.propertyName === "transform") next();
        };
        el?.addEventListener("transitionend", ended);
        const fallback = setTimeout(next, legMs + 800);
        legWait.current = () => {
          el?.removeEventListener("transitionend", ended);
          clearTimeout(fallback);
        };
      };
      leg(1);
      return ms;
    },
    [jump, now, setTravelBoth, stopLeg],
  );

  const go = useCallback((to: Point, mode: Mode) => walk([now(), to], mode), [now, walk]);

  /** What's left of the walk under way, from where it is now. */
  const remaining = useCallback((): Point[] | null => {
    const p = plan.current;
    return p ? [now(), ...p.points.slice(p.next)] : null;
  }, [now]);

  useEffect(() => stopLeg, [stopLeg]);

  return { ref, feet, feetRef, travel, travelRef, facing, setFacing, walk, go, halt, jump, now, remaining, plan };
}

/**
 * Finding a way about a panda's patch of the drawing without stepping on
 * anything: a planning grid over the patch, and the obstacles it came from.
 * All in drawing units, so where you're looking (and how close) changes nothing.
 */
function useWayfinding(patch: { current: Rect }) {
  const seen = useRef<readonly CanvasElement[] | null>(null);
  const boxes = useRef<Rect[]>([]);
  const obstacles = useCallback(() => {
    const scene = currentScene();
    if (scene !== seen.current) {
      seen.current = scene;
      boxes.current = obstaclesOf(scene);
    }
    return boxes.current;
  }, []);
  const map = useCallback((): { g: Grid; room: Rect } | null => {
    const room = roomOf(patch.current);
    if (room.w <= 0 || room.h <= 0) return null;
    return { g: buildGrid(room, obstacles(), BODY, CELL, PAD), room };
  }, [obstacles, patch]);
  return { map, obstacles };
}

const pickRandom = <T,>(items: readonly T[], n: number) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};

/**
 * The walking decisions both kinds of panda make, on their patch and kept off
 * the drawing: a stroll to a free spot, a sprint across, a roll, stepping off
 * something drawn over it, finding another way when its path gets drawn
 * across, getting (back) onto its patch, and leaving it.
 */
function useWalker(f: ReturnType<typeof useFeet>, patch: { current: Rect }) {
  const { map, obstacles } = useWayfinding(patch);
  const { walk, now, jump, remaining, plan } = f;

  /** Off to a free spot on its patch, the way round; the time it takes (null: nowhere to go). */
  const wander = useCallback(
    (mode: Mode): number | null => {
      const m = map();
      if (!m) return null;
      const here = now();
      const spots = freeSpots(m.g).filter((s) => Math.hypot(s.x - here.x, s.y - here.y) > 60);
      for (const spot of pickRandom(spots, 8)) {
        const path = findPath(m.g, here, spot);
        if (path) return walk(path, mode);
      }
      return null;
    },
    [map, now, walk],
  );

  /** Somewhere on the far side of its patch, the way round (sprints). */
  const across = useCallback(
    (mode: Mode): number | null => {
      const m = map();
      if (!m) return null;
      const here = now();
      const onLeft = here.x < m.room.x + m.room.w / 2;
      const far = freeSpots(m.g)
        .filter((s) => (onLeft ? s.x > m.room.x + m.room.w * 0.72 : s.x < m.room.x + m.room.w * 0.28))
        .sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y));
      for (const spot of far.slice(0, 10)) {
        const path = findPath(m.g, here, spot);
        if (path) return walk(path, mode);
      }
      return null;
    },
    [map, now, walk],
  );

  /** A straight roll along, if the way is clear (either side); the time it takes. */
  const roll = useCallback(
    (distance: number): number | null => {
      const m = map();
      if (!m) return null;
      const here = now();
      const towardsRoom = m.room.x + m.room.w - here.x > here.x - m.room.x ? 1 : -1;
      for (const dir of [towardsRoom, -towardsRoom]) {
        const to = { x: here.x + dir * distance, y: here.y };
        if (isFree(m.g, to) && clearLine(m.g, here, to)) return walk([here, to], "roll");
      }
      return null;
    },
    [map, now, walk],
  );

  /** Standing on something drawn? Step off to the nearest clear spot (true if it does). */
  const stepOff = useCallback((): boolean => {
    const m = map();
    if (!m) return false;
    const here = now();
    if (!touchesDrawing(here, BODY, obstacles(), PAD)) return false;
    const spot = nearestFree(m.g, here);
    if (!spot) return false;
    walk(findPath(m.g, here, spot) ?? [here, spot], "walk");
    return true;
  }, [map, now, obstacles, walk]);

  /** Off its patch (put down outside it, say)? Back onto clear paper on it (true if it had to). */
  const toPatch = useCallback((): boolean => {
    const m = map();
    if (!m) return false;
    const here = now();
    if (inside(here, m.room)) return false;
    const goal = nearestFree(m.g, { x: clamp(here.x, m.room.x, m.room.x + m.room.w), y: clamp(here.y, m.room.y, m.room.y + m.room.h) });
    if (!goal) return false;
    walk(findPath(m.g, here, goal) ?? [here, goal], "walk");
    return true;
  }, [map, now, walk]);

  /** Something new drawn across the walk under way: find another way (or another spot). */
  const rethink = useCallback(() => {
    const left = remaining();
    const m = map();
    if (!left || !m || !plan.current) return;
    if (pathClear(m.g, left)) return;
    const goal = left[left.length - 1];
    const mode = plan.current.mode;
    const target = isFree(m.g, goal) ? goal : nearestFree(m.g, goal);
    const path = target ? findPath(m.g, left[0], target) : null;
    if (path) walk(path, mode);
    else {
      jump(left[0]);
      stepOff();
    }
  }, [jump, map, plan, remaining, stepOff, walk]);

  /** In from just past one side of its patch, onto clear paper (wild pandas arriving). */
  const arrive = useCallback(
    (side: Side) => {
      const m = map();
      if (!m) return;
      const here = now();
      const edge = edgeSpots(m.g, side).sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y))[0];
      if (!edge) return;
      const inward = 160 + Math.random() * 220;
      const goal = nearestFree(m.g, { x: edge.x + (side === "left" ? inward : -inward), y: edge.y }) ?? edge;
      walk([{ x: here.x, y: edge.y }, edge, ...(findPath(m.g, edge, goal) ?? [edge]).slice(1)], "walk");
    },
    [map, now, walk],
  );

  /** Off past the nearer side of its patch, the way round (wild pandas leaving); the time it takes. */
  const leave = useCallback((): number => {
    const here = now();
    const p = patch.current;
    const side: Side = here.x - p.x < p.x + p.w - here.x ? "left" : "right";
    const m = map();
    const exit = m ? edgeSpots(m.g, side).sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y))[0] : null;
    const path = m && exit ? findPath(m.g, here, exit) : null;
    const way = path ?? [here];
    return walk([...way, pastSide(side, p, way[way.length - 1].y)], "walk");
  }, [map, now, patch, walk]);

  // One object for as long as the callbacks last, so effects that use it don't restart every render.
  return useMemo(
    () => ({ wander, across, roll, stepOff, toPatch, rethink, arrive, leave }),
    [wander, across, roll, stepOff, toPatch, rethink, arrive, leave],
  );
}

/** The transform and transition for a panda standing (or on its way) at `feet`. */
const placeAt = (feet: Point, travel: Travel | null, still: boolean) => ({
  transform: `translate(${(feet.x - W / 2).toFixed(2)}px, ${(feet.y - H).toFixed(2)}px)`,
  transition: travel && !still ? transitionFor(travel.mode, travel.ms, travel.steady) : undefined,
});

/** Its words, readable at any zoom, kept inside the board near its edges. */
function Bubble({ text, feet, stage }: { text: string; feet: Point; stage: HTMLElement }) {
  const v = currentView() ?? FAR_VIEW;
  const sx = (feet.x - v.x) * v.z;
  const top = (feet.y - v.y) * v.z - H * v.z;
  const align = sx + 118 > stage.clientWidth ? "end" : sx - 118 < 0 ? "start" : undefined;
  const below = top < 70;
  return (
    <span className="buddy-unfit" data-at={below ? "feet" : undefined}>
      <span className="buddy-bubble" role="status" data-align={align} data-side={below ? "below" : undefined}>
        {text}
      </span>
    </span>
  );
}

// ------------------------------------------------------------ your buddies

export function CanvasBuddy({
  buddy,
  kind,
  level,
  accessories,
  stage,
  start,
  pose,
  paused,
  walk,
  tricks,
  reduceMotion,
  registerTrick,
  speech,
  expanded,
  onOpen,
  onMoved,
}: {
  buddy: Buddy;
  kind: BuddyKind;
  level: number;
  accessories: readonly Accessory[];
  /** The board (the element marked data-buddy-stage). */
  stage: HTMLElement;
  /** Where it stands when it first climbs onto the drawing: its spot, on screen. */
  start: Point;
  /** A reaction or sleep, from above (null: its own). */
  pose: Pose | null;
  /** Asleep, showing its card or a battle is on: no new walks or tricks. */
  paused: boolean;
  /** It may walk about (off with reduced motion: it stands where it's put). */
  walk: boolean;
  tricks: boolean;
  reduceMotion: boolean;
  registerTrick: (id: string, run: (() => void) | null) => void;
  speech: string | null;
  expanded: boolean;
  onOpen: (box: Box) => void;
  onMoved: () => void;
}) {
  // Where it was on this drawing last time; or, climbing on for the first time, at its spot on
  // screen, with the part of the drawing in view as its patch.
  const [first] = useState<Spot>(
    () =>
      loadSpot(buddy.id) ?? {
        feet: screenToWorld({ x: start.x + W / 2, y: start.y + H }, stage),
        patch: patchOfView(currentView() ?? FAR_VIEW, stage),
      },
  );
  const patch = useRef(first.patch);
  const feetApi = useFeet(() => first.feet, reduceMotion);
  const { ref, feet, travel, facing, setFacing, halt, jump, now } = feetApi;
  const walker = useWalker(feetApi, patch);
  const fitRef = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState(false);
  const [trickPose, setTrickPose] = useState<Pose | null>(null);
  const [acting, setActing] = useState(false);
  const [round, setRound] = useState(0);
  const press = useRef<{ id: number; start: Point; from: Point; moved: boolean } | null>(null);
  const trick = useRef<AbortController | null>(null);
  const settleAfterDrop = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ walk, reduceMotion, ability: kind.ability, expanded, paused });
  useLayoutEffect(() => {
    live.current = { walk, reduceMotion, ability: kind.ability, expanded, paused };
  });

  /** Its trick, here on the drawing. `asked`: from the card's Show me. */
  const doTrick = useCallback(
    async (asked: boolean) => {
      trick.current?.abort();
      const ctl = new AbortController();
      trick.current = ctl;
      setActing(true);
      const L = live.current;
      const onTheSpot = async (pose: Pose, ms: number) => {
        halt(); // nobody naps (or dances) on the move
        setTrickPose(pose);
        await pause(ctl.signal, ms);
      };
      try {
        if (L.ability !== "sprint" && L.ability !== "roll") {
          const t = ON_THE_SPOT[L.ability];
          return await onTheSpot(t.pose, t.ms);
        }
        const show = L.ability === "sprint" ? "run" : "roll";
        if (L.reduceMotion || (!L.walk && !asked)) return await onTheSpot(show, 1500);
        // Across the view the way round anything drawn, or a few somersaults where it's clear.
        const ms = L.ability === "sprint" ? walker.across("run") : walker.roll(130 + Math.random() * 110);
        if (ms === null) return await onTheSpot(show, 1500); // no clear way: just the move
        await pause(ctl.signal, ms);
        if (L.ability === "sprint") {
          setTrickPose("happy");
          await pause(ctl.signal, 650);
        } else await pause(ctl.signal, 500);
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
      } finally {
        if (trick.current === ctl) {
          trick.current = null;
          setTrickPose(null);
          setActing(false);
        }
      }
    },
    [halt, walker],
  );

  useEffect(() => {
    registerTrick(buddy.id, () => void doTrick(true));
    return () => registerTrick(buddy.id, null);
  }, [buddy.id, doTrick, registerTrick]);

  useEffect(() => {
    if (paused || drag) trick.current?.abort();
  }, [paused, drag]);
  useEffect(
    () => () => {
      trick.current?.abort();
      clearTimeout(settleAfterDrop.current);
    },
    [],
  );

  // A reaction or sleep stops it where it is (next frame, outside React's render).
  useEffect(() => {
    if (!pose) return;
    const f = requestAnimationFrame(halt);
    return () => cancelAnimationFrame(f);
  }, [pose, halt]);

  const speaking = speech !== null;

  // Its trick every so often.
  useEffect(() => {
    if (!tricks || paused || drag || acting || pose) return;
    const t = setTimeout(
      () => {
        if (MOVING_TRICKS.has(live.current.ability) && !live.current.walk) return setRound((r) => r + 1);
        void doTrick(false);
      },
      30_000 + Math.random() * 30_000,
    );
    return () => clearTimeout(t);
  }, [tricks, paused, drag, acting, pose, round, doTrick]);

  // Walk about the part of the drawing in view, round what's drawn, resting in between.
  useEffect(() => {
    if (!walk || paused || drag || acting || pose || speaking) return;
    let t: ReturnType<typeof setTimeout>;
    const step = (delay: number) => {
      t = setTimeout(() => {
        if (Math.random() < 0.3) return step(3000 + Math.random() * 4000); // a rest
        const ms = walker.wander("walk");
        step(ms === null ? 4000 : ms + 2500 + Math.random() * 6000);
      }, delay);
    };
    step(1200 + Math.random() * 2500);
    return () => clearTimeout(t);
  }, [walk, paused, drag, acting, pose, speaking, walker]);

  const busy = () => !!press.current || !!trick.current || live.current.expanded || live.current.paused;

  // Just climbed on: onto its patch, and off anything drawn there.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!busy() && !walker.toPatch()) walker.stepOff();
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it climbs on
  }, []);

  // Remember where it stopped (for this drawing, in this browser).
  useEffect(() => {
    if (travel || drag) return;
    const t = setTimeout(() => saveSpot(buddy.id, { feet, patch: patch.current }), 300);
    return () => clearTimeout(t);
  }, [buddy.id, drag, feet, travel]);

  // Something drawn under it or across its way: step aside, or find another way.
  useSceneChanged(() => {
    if (busy()) return;
    if (feetApi.travelRef.current) walker.rethink();
    else walker.stepOff();
  });

  const shownPose: Pose = drag ? "drag" : travel ? MODE_POSE[travel.mode] : (pose ?? trickPose ?? "idle");

  const box = (): Box => {
    const r = (fitRef.current ?? ref.current)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : { x: 0, y: 0, w: W, h: H };
  };

  /** Put down somewhere: that's where it lives now. On something drawn? It hops off after a moment. */
  const offAfterDrop = () => {
    patch.current = patchAround(feetApi.feetRef.current, patch.current);
    clearTimeout(settleAfterDrop.current);
    settleAfterDrop.current = setTimeout(() => {
      if (!press.current && !trick.current) walker.stepOff();
    }, 700);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    halt(); // it stops when you touch it
    press.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, from: now(), moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.start.x;
    const dy = e.clientY - p.start.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return;
    if (!p.moved) {
      p.moved = true;
      trick.current?.abort();
      setDrag(true);
    }
    const z = (currentView() ?? FAR_VIEW).z;
    if (Math.abs(dx) > 2) setFacing(dx < 0 ? "left" : "right");
    jump({ x: p.from.x + dx / z, y: p.from.y + dy / z });
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved) {
      setDrag(false);
      onMoved();
      offAfterDrop();
    } else onOpen(box());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    trick.current?.abort();
    const z = (currentView() ?? FAR_VIEW).z;
    const at = now();
    jump({ x: at.x + d[0] / z, y: at.y + d[1] / z });
    onMoved();
    offAfterDrop();
  };

  return (
    <button
      ref={ref}
      type="button"
      className="buddy"
      data-testid="buddy"
      data-buddy={buddy.id}
      data-rarity={kind.rarity}
      data-on-canvas=""
      data-facing={facing}
      data-moving={drag ? "instant" : (travel?.mode ?? undefined)}
      data-pose={shownPose}
      data-feet={`${Math.round(feet.x)},${Math.round(feet.y)}`}
      aria-label={`${buddy.name || "Buddy"}, your study buddy (level ${level}), on the drawing. Press for today's progress; drag or use the arrow keys to move.`}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      style={placeAt(feet, travel, drag)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDrag(false);
      }}
      // Pointer clicks open from onPointerUp; this is for Enter and Space.
      onClick={(e) => {
        if (e.detail !== 0) return;
        halt();
        onOpen(box());
      }}
      onKeyDown={onKeyDown}
    >
      <span ref={fitRef} className="buddy-fit">
        <Panda pose={shownPose} color={buddy.color} accessories={accessories} coat={RARITY[kind.rarity].coat} />
        {speech ? <Bubble text={speech} feet={feet} stage={stage} /> : null}
      </span>
    </button>
  );
}

// ------------------------------------------------------------ a wild panda

/**
 * A wild panda on the drawing. It walks in from one side of the view, ambles
 * about the clear paper (a sprinter dashes now and then, a roller rolls: a
 * hint of what it does in a battle), comes back into view if you pan away,
 * and walks off the nearest side when its time is up. Like your buddies, it
 * keeps off what's drawn. A "!" over its head gets it noticed.
 */
export function CanvasWild({
  wild,
  stage,
  leaving,
  hidden,
  reduceMotion,
  onBattle,
  onGone,
}: {
  wild: WildEncounter;
  stage: HTMLElement;
  leaving: boolean;
  /** Out of sight (while its battle is open). */
  hidden: boolean;
  reduceMotion: boolean;
  onBattle: () => void;
  onGone: () => void;
}) {
  const [side] = useState<"left" | "right">(() => (Math.random() < 0.5 ? "left" : "right"));
  const [height] = useState(() => 0.25 + Math.random() * 0.5);
  // Its patch is the part of the drawing in view when it turns up; it walks in from just past one side.
  const [patchAtStart] = useState(() => patchOfView(currentView() ?? FAR_VIEW, stage));
  const patch = useRef(patchAtStart);
  const feetApi = useFeet(() => {
    const room = roomOf(patchAtStart);
    return pastSide(side, patchAtStart, room.y + room.h * height);
  }, reduceMotion);
  const { ref, feet, travel, facing } = feetApi;
  const walker = useWalker(feetApi, patch);
  const [fading, setFading] = useState(false);
  const goneRef = useRef(onGone);
  const leavingRef = useRef(leaving);
  useLayoutEffect(() => {
    goneRef.current = onGone;
    leavingRef.current = leaving;
  });

  // In from the side onto clear paper, then about its patch every so often (not with reduced motion:
  // there it just stands where it came in).
  useEffect(() => {
    if (leaving) return;
    let t: ReturnType<typeof setTimeout>;
    const first = setTimeout(() => {
      walker.arrive(side);
      if (reduceMotion) return;
      const step = () => {
        t = setTimeout(
          () => {
            if (Math.random() < 0.3) return step(); // a look around
            const special = wild.ability === "sprint" ? "run" : wild.ability === "roll" ? "roll" : null;
            walker.wander(special && Math.random() < 0.3 ? special : "walk");
            step();
          },
          4000 + Math.random() * 4500,
        );
      };
      step();
    }, 250);
    return () => {
      clearTimeout(first);
      clearTimeout(t);
    };
  }, [leaving, reduceMotion, side, walker, wild.ability]);

  // Something drawn under it or across its way.
  useSceneChanged(() => {
    if (leavingRef.current) return;
    if (feetApi.travelRef.current) walker.rethink();
    else walker.stepOff();
  });

  // Off past the nearer side of its patch, then gone.
  useEffect(() => {
    if (!leaving) return;
    const ms = walker.leave();
    const fade = setTimeout(() => setFading(true), ms);
    const done = setTimeout(() => goneRef.current(), ms + 550);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [leaving, walker]);

  const pose: Pose = travel ? MODE_POSE[travel.mode] : "idle";
  const { label, badge } = RARITY[wild.rarity];
  const what = aPanda(wild.rarity);

  return (
    <button
      ref={ref}
      type="button"
      className={cn("buddy buddy-wild", hidden && "invisible")}
      data-testid="wild-panda"
      data-rarity={wild.rarity}
      data-pose={pose}
      data-facing={facing}
      data-moving={travel?.mode ?? undefined}
      data-fading={fading || undefined}
      data-feet={`${Math.round(feet.x)},${Math.round(feet.y)}`}
      aria-label={`${what[0].toUpperCase()}${what.slice(1)} is wandering on your drawing (level ${wild.level}). Press to battle it.`}
      style={placeAt(feet, travel, false)}
      onClick={onBattle}
      disabled={leaving}
    >
      <span className="buddy-fit">
        <Panda pose={pose} coat={RARITY[wild.rarity].coat} />
        <span
          className={cn("buddy-alert", wild.rarity === "superRare" && "buddy-shimmer")}
          style={{ backgroundColor: wild.rarity === "common" ? "#2b2a30" : badge.fg, color: "#fff" }}
          aria-hidden
        >
          !
        </span>
        <span className="buddy-unfit" data-at="feet" aria-hidden>
          <span className="buddy-tip">
            {wild.rarity === "common" ? "A wild panda" : `${label} panda`}: press to battle
          </span>
        </span>
      </span>
    </button>
  );
}
