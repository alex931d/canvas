"use client";

import { EyeOff, Flame, House, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Dialog,
  DialogContent,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Switch,
  toast,
} from "@/components/kit";
import { onBuddy, type BuddyEvent } from "@/lib/buddy/events";
import { onView } from "@/lib/canvas/view-bus";
import { kindOf, partyIdFor, type BuddyKind, type CaughtBuddy, type WildEncounter } from "@/lib/buddy/game";
import { ABILITY, MOVING_TRICKS, RARITY } from "@/lib/buddy/kinds";
import type { WildOpenings } from "@/lib/buddy/rules";
import {
  afterBattle,
  afterReview,
  goalReached,
  greeting,
  levelUp,
  newcomer,
  sessionDone,
  taskDone,
  wildSpotted,
} from "@/lib/buddy/lines";
import {
  accessoriesFor,
  BUDDY_COLORS,
  DEFAULT_NAMES,
  MAX_BUDDIES,
  UNLOCKS,
  type Buddy,
  type BuddySettings,
  type Progress,
} from "@/lib/buddy/shared";
import { cn } from "@/lib/utils";
import { PandaBattle, type BattleResult } from "./battle-screen";
import { CanvasBuddy, CanvasWild, WorldLayer, type Box } from "./canvas-buddies";
import {
  clamp,
  H,
  keepIn,
  MODE_POSE,
  ON_THE_SPOT,
  pause,
  room,
  Stopped,
  transitionFor,
  translateNow,
  travelMs,
  W,
  type Mode,
  type Point,
} from "./movement";
import { Panda, type Pose } from "./panda";
import { RarityBadge } from "./rarity-badge";

/**
 * Study buddies: pandas over the app. They drift about near their spot, do
 * their trick now and then, can be dragged anywhere (or moved with the arrow
 * keys), nap when nothing happens for a while, and react to flashcards
 * answered and to-do cards finished (src/lib/buddy/events.ts). Click one for
 * today's progress.
 *
 * On a drawing, with "Walk on drawings" on, they climb onto the canvas
 * itself (canvas-buddies.tsx): they walk about in the drawing's coordinates,
 * pan and zoom with it, and stay under its tool bars.
 *
 * Wild pandas turn up on drawings now and then (on the canvas
 * too): press one to battle it (battle-screen.tsx), and offer bamboo to have
 * it join you.
 */

const SLEEP_AFTER_MS = 3 * 60_000;
const REACTION_MS: Partial<Record<Pose, number>> = { cheer: 1800, happy: 650, nod: 1200, wave: 2000 };
/** A trick every this often, give or take (TRICK_EVERY_MS to twice that). */
const TRICK_EVERY_MS = 30_000;
const WILD_FIRST_LOOK_MS = 2500;
const WILD_LOOK_EVERY_MS = 60_000;
const ZERO: Point = { x: 0, y: 0 };

type Loaded = {
  settings: BuddySettings;
  progress: Progress;
  firstName: string;
  collection: CaughtBuddy[];
  bamboo: number;
  /** Whether wild pandas turn up, as admins have set it (src/lib/buddy/rules.ts). */
  wild: WildOpenings;
};
type Wild = { encounter: WildEncounter; leaving: boolean };

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay = () => new Date().toLocaleDateString("en-CA");
const screenRoom = (size: Point) => room({ x: 0, y: 0, w: size.x, h: size.y });
const plus = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

function defaultHome(i: number, size: Point): Point {
  const narrow = size.x < 640;
  return { x: size.x - (narrow ? 76 : 96) - i * (narrow ? 62 : 76), y: size.y - (narrow ? 214 : 196) };
}

function homeOf(b: Buddy, i: number, size: Point): Point {
  const p = b.x === null || b.y === null ? defaultHome(i, size) : { x: b.x * size.x, y: b.y * size.y };
  return keepIn(p, screenRoom(size));
}

export function StudyBuddies() {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [size, setSize] = useState<Point>({ x: 0, y: 0 });
  /** The board, on a drawing's page (where pandas can walk on the canvas and wild ones turn up). */
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [reactions, setReactions] = useState<Record<string, Pose>>({});
  const [speech, setSpeech] = useState<{ id: string; text: string; key: number } | null>(null);
  const [open, setOpen] = useState<{ id: string; box: Box; onCanvas: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [wild, setWild] = useState<Wild | null>(null);
  const [battle, setBattle] = useState<WildEncounter | null>(null);

  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  });
  const speechKey = useRef(0);
  const session = useRef({ answered: 0, missed: 0 });
  const said = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Each panda's "do your trick now", for the progress card's Show me. */
  const tricks = useRef(new Map<string, () => void>());

  // ---------------------------------------------------------------- data

  const load = useCallback(async (): Promise<Loaded | null> => {
    try {
      const res = await fetch(`/api/buddy?tz=${encodeURIComponent(zone())}`, { cache: "no-store" });
      return res.ok ? ((await res.json()) as Loaded) : null;
    } catch {
      return null;
    }
  }, []);

  const pendingSave = useRef<BuddySettings | null>(null);

  /** Send settings waiting to be saved (also when leaving the page, so a quick change isn't lost). */
  const flush = useCallback(async () => {
    const settings = pendingSave.current;
    if (!settings) return;
    pendingSave.current = null;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // A name being typed can be empty for a moment; don't save it that way.
    const named = {
      ...settings,
      buddies: settings.buddies.map((b, i) => ({ ...b, name: b.name.trim() || DEFAULT_NAMES[i] || "Buddy" })),
    };
    await fetch("/api/buddy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(named),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const save = useCallback(
    (settings: BuddySettings) => {
      setData((d) => (d ? { ...d, settings } : d));
      pendingSave.current = settings;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 400);
    },
    [flush],
  );

  useEffect(() => {
    const leave = () => void flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      void flush(); // leaving for another page in the app
    };
  }, [flush]);

  const updateBuddy = (id: string, patch: Partial<Buddy>) => {
    const s = dataRef.current?.settings;
    if (s) save({ ...s, buddies: s.buddies.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  };

  // ---------------------------------------------------------- reactions

  const react = useCallback((ids: string[], pose: Pose) => {
    setReactions((r) => ({ ...r, ...Object.fromEntries(ids.map((id) => [id, pose])) }));
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(
          () =>
            setReactions((r) => {
              const next = { ...r };
              delete next[id];
              return next;
            }),
          REACTION_MS[pose] ?? 1500,
        ),
      );
    }
  }, []);

  const say = useCallback((text: string | null, who?: string) => {
    const buddies = dataRef.current?.settings.buddies;
    if (!text || !buddies?.length) return;
    // Take turns when there are several.
    const id = who ?? buddies[said.current++ % buddies.length].id;
    setSpeech({ id, text, key: ++speechKey.current });
  }, []);

  useEffect(() => {
    if (!speech) return;
    const t = setTimeout(() => setSpeech((s) => (s?.key === speech.key ? null : s)), 4200);
    return () => clearTimeout(t);
  }, [speech]);

  /** Fetch progress after something happened, then celebrate a level or the daily goal. */
  const refreshAfter = useCallback(
    async (then: (before: Progress, after: Progress) => void) => {
      const before = dataRef.current?.progress;
      const next = await load();
      if (!next || !before) return;
      setData((d) =>
        d ? { ...d, progress: next.progress, bamboo: next.bamboo, collection: next.collection, wild: next.wild } : d,
      );
      const all = dataRef.current?.settings.buddies.map((b) => b.id) ?? [];
      const goal = dataRef.current?.settings.dailyGoal ?? 0;
      if (next.progress.level > before.level) {
        react(all, "cheer");
        say(levelUp(next.progress.level, next.wild.from));
      } else if (goal > 0 && before.today.reviews < goal && next.progress.today.reviews >= goal) {
        react(all, "cheer");
        say(goalReached(goal));
      } else then(before, next.progress);
    },
    [load, react, say],
  );

  // ---------------------------------------------------------- lifecycle

  useEffect(() => {
    let cancelled = false;
    void load().then((d) => {
      if (cancelled || !d) return;
      setData(d);
      if (!d.settings.visible) return;
      // Hello, once a day.
      try {
        if (localStorage.getItem("buddy-greeted") !== localDay()) {
          localStorage.setItem("buddy-greeted", localDay());
          setTimeout(() => {
            react([d.settings.buddies[0].id], "wave");
            say(greeting(d.firstName, d.progress, d.settings.dailyGoal, new Date().getHours(), Date.now()), d.settings.buddies[0].id);
          }, 700);
        }
      } catch {
        /* storage blocked: skip the greeting */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load, react, say]);

  useEffect(() => {
    const measure = () => {
      setSize((s) => (s.x === window.innerWidth && s.y === window.innerHeight ? s : { x: window.innerWidth, y: window.innerHeight }));
      // The drawing's board, if this page has one (it can turn up after the page does).
      const board = document.querySelector<HTMLElement>("[data-buddy-stage]");
      setStage((s) => (s === board ? s : board));
    };
    measure();
    window.addEventListener("resize", measure);
    const every = setInterval(measure, 1500);
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReducedMotion(mq.matches);
    motion();
    mq.addEventListener("change", motion);
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(every);
      mq.removeEventListener("change", motion);
    };
  }, []);

  // Nap after a few quiet minutes; wake up on the next touch, click or key.
  useEffect(() => {
    let last = Date.now();
    let sleeping = false;
    const wake = () => {
      last = Date.now();
      if (sleeping) {
        sleeping = false;
        setAsleep(false);
      }
    };
    const events = ["pointerdown", "keydown", "wheel", "pointermove"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    const t = setInterval(() => {
      if (!sleeping && Date.now() - last > SLEEP_AFTER_MS) {
        sleeping = true;
        setAsleep(true);
      }
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      clearInterval(t);
    };
  }, []);

  // What the rest of the app reports.
  useEffect(
    () =>
      onBuddy((event: BuddyEvent) => {
        const d = dataRef.current;
        if (event.kind === "open-settings") {
          if (!d) return false; // not loaded (or not a member): the menu goes to the buddies page instead
          // From the account menu: let the menu finish closing (and hand back focus) first.
          setTimeout(() => setSettingsOpen(true), 60);
          return true;
        }
        if (!d) return;
        const all = d.settings.buddies.map((b) => b.id);
        if (event.kind === "review") {
          session.current.answered++;
          if (event.grade === "again") session.current.missed++;
          react(all, event.grade === "again" ? "nod" : "happy");
          const snapshot = { ...session.current };
          void refreshAfter((_, after) => say(afterReview(event.grade, after, snapshot, snapshot.answered)));
        } else if (event.kind === "session-done") {
          react(all, "cheer");
          say(sessionDone(event.reviewed));
          void refreshAfter(() => {});
        } else if (event.kind === "task") {
          react(all, "cheer");
          // The server notes the task when the change is saved; give it a moment.
          setTimeout(() => void refreshAfter((_, after) => say(taskDone(after, event.count, Date.now()))), 1200);
        }
      }),
    [react, refreshAfter, say],
  );

  // ---------------------------------------------------------- wild pandas

  const canMeet = !!data && data.settings.visible && data.settings.wild && data.wild.on;
  const onDrawing = stage !== null;
  const wildAround = wild !== null;

  // On a drawing, ask now and then whether a wild panda has turned up (the server decides).
  useEffect(() => {
    if (!canMeet || !onDrawing || wildAround) return;
    let stopped = false;
    const look = async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch("/api/buddy/wild", { method: "POST", cache: "no-store" });
        if (res.status === 401 || res.status === 402) {
          stopped = true;
          return;
        }
        if (!res.ok || stopped) return;
        const { wild: found } = (await res.json()) as { wild: WildEncounter | null };
        if (!found || stopped) return;
        setWild({ encounter: found, leaving: false });
        const first = dataRef.current?.settings.buddies[0]?.id;
        if (found.status === "wild" && first) {
          react([first], "wave");
          say(wildSpotted(found.rarity, speechKey.current), first);
        }
      } catch {
        /* offline: look again later */
      }
    };
    const first = setTimeout(look, WILD_FIRST_LOOK_MS);
    const every = setInterval(look, WILD_LOOK_EVERY_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [canMeet, onDrawing, wildAround, react, say]);

  // A wild panda that isn't being battled wanders off when its time is up.
  useEffect(() => {
    if (!wild || wild.leaving || battle || wild.encounter.status !== "wild") return;
    const id = wild.encounter.id;
    const t = setTimeout(
      () => setWild((w) => (w && w.encounter.id === id ? { ...w, leaving: true } : w)),
      Math.max(0, new Date(wild.encounter.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(t);
  }, [wild, battle]);

  const startBattle = async () => {
    if (!wild || wild.leaving || battle) return;
    setOpen(null);
    // The server builds your team from saved settings: send any change first.
    await flush();
    setBattle(wild.encounter);
  };

  const battleDone = async (result: BattleResult) => {
    const fought = battle;
    setBattle(null);
    if (result.outcome === "caught") setWild(null);
    else setWild((w) => (w ? { ...w, leaving: true } : w));
    const fresh = await load();
    if (fresh) setData(fresh);
    if (result.caught) {
      const joined = result.caught;
      const walking = fresh?.settings.buddies.find((b) => b.catchId === joined.id);
      if (walking) {
        setTimeout(() => {
          react([walking.id], "wave");
          say(newcomer(walking.name, speechKey.current), walking.id);
        }, 500);
      } else {
        toast(`${joined.name} joined your buddies`, {
          description: "Three are out with you already, so they're waiting at home.",
          action: { label: "See buddies", onClick: () => router.push("/buddies") },
        });
      }
    } else if (fought && result.outcome !== "error") {
      say(afterBattle(result.outcome, fought.name, speechKey.current));
    }
  };

  // ---------------------------------------------------------- render

  const registerTrick = useCallback((id: string, run: (() => void) | null) => {
    if (run) tricks.current.set(id, run);
    else tricks.current.delete(id);
  }, []);

  if (!data || size.x === 0) return null;

  const { settings, progress, collection } = data;
  const accessories = accessoriesFor(progress.level);
  const openBuddy = open ? settings.buddies.find((b) => b.id === open.id) : undefined;

  const closeCard = (refocus: boolean) => {
    const id = open?.id;
    setOpen(null);
    if (refocus && id) document.querySelector<HTMLElement>(`[data-buddy="${id}"]`)?.focus({ preventScroll: true });
  };

  const hide = () => {
    setOpen(null);
    save({ ...settings, visible: false });
    toast("Study buddies hidden", {
      description: "Bring them back from your account menu.",
      action: { label: "Undo", onClick: () => save({ ...settings, visible: true }) },
    });
  };

  const moving = settings.wander && !reducedMotion;
  /** Out on the drawing itself (in its coordinates), rather than over the app near their spots. */
  const onCanvas = stage !== null && settings.roam && settings.wander;
  const toggleCard = (id: string, box: Box, canvas: boolean) =>
    setOpen((o) => (o?.id === id ? null : { id, box, onCanvas: canvas }));
  const common = (b: Buddy) => ({
    buddy: b,
    kind: kindOf(b, collection),
    level: progress.level,
    accessories,
    pose: reactions[b.id] ?? (asleep ? "sleep" : null),
    paused: asleep || open?.id === b.id || battle !== null,
    tricks: settings.tricks && !reducedMotion,
    reduceMotion: reducedMotion,
    registerTrick,
    speech: speech?.id === b.id ? speech.text : null,
    expanded: open?.id === b.id,
  });

  // Portals, so a transformed ancestor can't become the fixed layer's frame, and so pandas on the
  // drawing live inside its board.
  return (
    <>
      {createPortal(
        <>
          {settings.visible ? (
            <div className="buddy-layer" data-testid="study-buddies">
              {onCanvas
                ? null
                : settings.buddies.map((b, i) => (
                    <BuddyFigure
                      key={b.id}
                      {...common(b)}
                      home={homeOf(b, i, size)}
                      size={size}
                      wander={moving}
                      onOpen={(box) => toggleCard(b.id, box, false)}
                      onMoved={(p) => {
                        updateBuddy(b.id, { x: p.x / size.x, y: p.y / size.y });
                        react([b.id], "happy");
                      }}
                    />
                  ))}
              {open && openBuddy ? (
                <BuddyCard
                  key={openBuddy.id}
                  buddy={openBuddy}
                  kind={kindOf(openBuddy, collection)}
                  box={open.box}
                  closeOnPan={open.onCanvas}
                  size={size}
                  progress={progress}
                  bamboo={data.bamboo}
                  goal={settings.dailyGoal}
                  onClose={closeCard}
                  onHide={hide}
                  onTrick={() => {
                    setOpen(null);
                    tricks.current.get(openBuddy.id)?.();
                  }}
                  onSettings={() => {
                    setOpen(null);
                    setSettingsOpen(true);
                  }}
                />
              ) : null}
            </div>
          ) : null}
          <BuddySettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} data={data} save={save} />
          {battle ? (
            <PandaBattle
              key={battle.id}
              encounter={battle}
              bamboo={data.bamboo}
              accessories={accessories}
              onDone={(result) => void battleDone(result)}
            />
          ) : null}
        </>,
        document.body,
      )}
      {stage && settings.visible && (onCanvas || wild)
        ? createPortal(
            <WorldLayer>
              {onCanvas
                ? settings.buddies.map((b, i) => (
                    <CanvasBuddy
                      key={b.id}
                      {...common(b)}
                      stage={stage}
                      start={homeOf(b, i, size)}
                      walk={!reducedMotion}
                      onOpen={(box) => toggleCard(b.id, box, true)}
                      onMoved={() => react([b.id], "happy")}
                    />
                  ))
                : null}
              {wild ? (
                <CanvasWild
                  key={wild.encounter.id}
                  wild={wild.encounter}
                  stage={stage}
                  leaving={wild.leaving}
                  hidden={battle !== null}
                  reduceMotion={reducedMotion}
                  onBattle={() => void startBattle()}
                  onGone={() => setWild((w) => (w?.encounter.id === wild.encounter.id ? null : w))}
                />
              ) : null}
            </WorldLayer>,
            stage,
          )
        : null}
    </>
  );
}

// ------------------------------------------------------------------ one panda (in its corner)

/**
 * A buddy over the app, near its spot (when it isn't out on a drawing, see
 * canvas-buddies.tsx). While it moves it always shows its walk (or run, or
 * roll); anything done standing still (a nap, a snack, a reaction, falling
 * asleep) stops it where it is first.
 */
function BuddyFigure({
  buddy,
  kind,
  home,
  size,
  level,
  accessories,
  pose,
  paused,
  wander,
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
  home: Point;
  size: Point;
  level: number;
  accessories: ReturnType<typeof accessoriesFor>;
  /** A reaction or sleep, from above (null: its own). */
  pose: Pose | null;
  /** Asleep, showing its card or a battle is on: no new moves or tricks. */
  paused: boolean;
  /** It may move about near its spot. */
  wander: boolean;
  /** Do its trick every so often. */
  tricks: boolean;
  reduceMotion: boolean;
  registerTrick: (id: string, run: (() => void) | null) => void;
  speech: string | null;
  expanded: boolean;
  onOpen: (box: Box) => void;
  onMoved: (p: Point) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState<Point>(ZERO);
  const [travel, setTravel] = useState<{ mode: Mode; ms: number } | null>(null);
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [drag, setDrag] = useState<Point | null>(null);
  const [trickPose, setTrickPose] = useState<Pose | null>(null);
  /** A trick is under way (it may take the panda away from its spot even when it doesn't wander). */
  const [acting, setActing] = useState(false);
  const [round, setRound] = useState(0);
  /** The press in progress; `to` is the latest drag position (state can lag a pointer event behind). */
  const press = useRef<{ id: number; start: Point; from: Point; moved: boolean; to: Point | null } | null>(null);
  const offsetRef = useRef(offset);
  const travelRef = useRef(travel);
  const live = useRef({ home, size, wander, reduceMotion, ability: kind.ability });
  useLayoutEffect(() => {
    live.current = { home, size, wander, reduceMotion, ability: kind.ability };
  });
  const trick = useRef<AbortController | null>(null);
  const travelEnd = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setTravelBoth = useCallback((t: { mode: Mode; ms: number } | null) => {
    travelRef.current = t;
    setTravel(t);
  }, []);
  const setOffsetBoth = useCallback((o: Point) => {
    offsetRef.current = o;
    setOffset(o);
  }, []);

  /** Stop where it's drawn right now, part-way through a move. */
  const halt = useCallback(() => {
    const el = ref.current;
    if (!travelRef.current || !el) return;
    const at = translateNow(el);
    clearTimeout(travelEnd.current);
    setTravelBoth(null);
    setOffsetBoth({ x: at.x - live.current.home.x, y: at.y - live.current.home.y });
  }, [setOffsetBoth, setTravelBoth]);

  /** Head for `to` (on screen) at the pace of `mode`; returns how long it takes. */
  const go = useCallback(
    (to: Point, mode: Mode): number => {
      const L = live.current;
      const screen = screenRoom(L.size);
      const target = keepIn(to, screen);
      const el = ref.current;
      const from = travelRef.current && el ? translateNow(el) : keepIn(plus(L.home, offsetRef.current), screen);
      setOffsetBoth({ x: target.x - L.home.x, y: target.y - L.home.y });
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      if (Math.abs(target.x - from.x) > 2) setFacing(target.x < from.x ? "left" : "right");
      clearTimeout(travelEnd.current);
      if (distance < 2 || L.reduceMotion) {
        setTravelBoth(null);
        return 0;
      }
      const ms = travelMs(mode, distance);
      setTravelBoth({ mode, ms });
      travelEnd.current = setTimeout(() => setTravelBoth(null), ms);
      return ms;
    },
    [setOffsetBoth, setTravelBoth],
  );

  /** Its trick: a sprint across the screen, a roll, a nap, a snack… `asked` from the card's Show me. */
  const doTrick = useCallback(
    async (asked: boolean) => {
      trick.current?.abort();
      const ctl = new AbortController();
      trick.current = ctl;
      setActing(true);
      const L = live.current;
      try {
        if (L.ability !== "sprint" && L.ability !== "roll") {
          // Stop first: nobody naps (or dances) on the move.
          halt();
          const t = ON_THE_SPOT[L.ability];
          setTrickPose(t.pose);
          await pause(ctl.signal, t.ms);
          return;
        }
        if (L.reduceMotion || (!L.wander && !asked)) {
          // No dashing about: show the move on the spot.
          halt();
          setTrickPose(L.ability === "sprint" ? "run" : "roll");
          await pause(ctl.signal, 1500);
          return;
        }
        const bounds = screenRoom(L.size);
        const el = ref.current;
        const from = travelRef.current && el ? translateNow(el) : keepIn(plus(L.home, offsetRef.current), bounds);
        if (L.ability === "sprint") {
          // To the other side of the screen.
          const onLeft = from.x < bounds.x + bounds.w / 2;
          const to = {
            x: onLeft ? bounds.x + bounds.w - Math.random() * 40 : bounds.x + Math.random() * 40,
            y: clamp(from.y, bounds.y, bounds.y + bounds.h),
          };
          await pause(ctl.signal, go(to, "run"));
          setTrickPose("happy");
          await pause(ctl.signal, 650);
          setTrickPose(null);
          await pause(ctl.signal, 900 + Math.random() * 1200);
        } else {
          // A few somersaults, towards wherever there's room.
          const dir = bounds.x + bounds.w - from.x > from.x - bounds.x ? 1 : -1;
          await pause(ctl.signal, go({ x: from.x + dir * (130 + Math.random() * 110), y: from.y }, "roll"));
          await pause(ctl.signal, 500);
        }
        // Then back where it lives.
        const now = live.current;
        if (!now.wander) await pause(ctl.signal, go(now.home, "walk"));
        else {
          await pause(
            ctl.signal,
            go({ x: now.home.x + Math.random() * 120 - 60, y: now.home.y + Math.random() * 50 - 30 }, "walk"),
          );
        }
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
    [go, halt],
  );

  useEffect(() => {
    registerTrick(buddy.id, () => void doTrick(true));
    return () => registerTrick(buddy.id, null);
  }, [buddy.id, doTrick, registerTrick]);

  // Stop a trick when it's picked up, opened or falls asleep, and when it goes.
  useEffect(() => {
    if (paused || drag) trick.current?.abort();
  }, [paused, drag]);
  useEffect(
    () => () => {
      trick.current?.abort();
      clearTimeout(travelEnd.current);
    },
    [],
  );

  // A reaction or sleep stops it where it is (next frame, outside React's render).
  useEffect(() => {
    if (!pose) return;
    const f = requestAnimationFrame(halt);
    return () => cancelAnimationFrame(f);
  }, [pose, halt]);

  // A panda that's saying something stays put until it's done (so the bubble stays on screen).
  const speaking = speech !== null;

  // Its trick every so often.
  useEffect(() => {
    if (!tricks || paused || drag || acting || pose) return;
    const t = setTimeout(
      () => {
        // Moving tricks need room to move.
        if (MOVING_TRICKS.has(live.current.ability) && !live.current.wander) return setRound((r) => r + 1);
        void doTrick(false);
      },
      TRICK_EVERY_MS + Math.random() * TRICK_EVERY_MS,
    );
    return () => clearTimeout(t);
  }, [tricks, paused, drag, acting, pose, round, doTrick]);

  // Drift about near its spot (walking back first if it's far off).
  useEffect(() => {
    if (!wander || paused || drag || acting || pose || speaking) return;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      const far = Math.hypot(offsetRef.current.x, offsetRef.current.y) > 160;
      t = setTimeout(
        () => {
          if (!far && Math.random() < 0.35) return step(); // just hang around
          const L = live.current;
          const to = { x: L.home.x + Math.round(Math.random() * 140 - 70), y: L.home.y + Math.round(Math.random() * 60 - 36) };
          const from = plus(L.home, offsetRef.current);
          go(to, Math.hypot(to.x - from.x, to.y - from.y) > 160 ? "walk" : "stroll");
          step();
        },
        far ? 700 : 5000 + Math.random() * 5000,
      );
    };
    step();
    return () => clearTimeout(t);
  }, [wander, paused, drag, acting, pose, speaking, go]);

  const off = wander || acting || expanded ? offset : ZERO;
  const at = drag ?? keepIn(plus(home, off), screenRoom(size));
  // Moving always looks like moving; standing still shows the rest.
  const shownPose: Pose = drag ? "drag" : travel ? MODE_POSE[travel.mode] : (pose ?? trickPose ?? "idle");

  const stop = () => {
    trick.current?.abort();
    clearTimeout(travelEnd.current);
    setTravelBoth(null);
    setOffsetBoth(ZERO);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    halt(); // it stops when you touch it
    // Where it is on screen right now.
    const r = e.currentTarget.getBoundingClientRect();
    press.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, from: { x: r.x, y: r.y }, moved: false, to: null };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.start.x;
    const dy = e.clientY - p.start.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return;
    p.moved = true;
    p.to = keepIn({ x: p.from.x + dx, y: p.from.y + dy }, screenRoom(size));
    setDrag(p.to);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.moved && p.to) {
      stop();
      setDrag(null);
      onMoved(p.to);
    } else if (!p.moved) onOpen({ x: p.from.x, y: p.from.y, w: W, h: H });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    stop();
    onMoved(keepIn({ x: at.x + d[0], y: at.y + d[1] }, screenRoom(size)));
  };

  return (
    <button
      ref={ref}
      type="button"
      className="buddy"
      data-testid="buddy"
      data-buddy={buddy.id}
      data-rarity={kind.rarity}
      data-facing={facing}
      data-moving={drag ? "instant" : (travel?.mode ?? undefined)}
      data-pose={shownPose}
      aria-label={`${buddy.name || "Buddy"}, your study buddy (level ${level}). Press for today's progress; drag or use the arrow keys to move.`}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      style={{
        transform: `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`,
        transition: travel && !drag ? transitionFor(travel.mode, travel.ms) : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDrag(null);
      }}
      // Pointer clicks open from onPointerUp; this is for Enter and Space.
      onClick={(e) => {
        if (e.detail !== 0) return;
        halt();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.x, y: r.y, w: W, h: H });
      }}
      onKeyDown={onKeyDown}
    >
      <Panda pose={shownPose} color={buddy.color} accessories={accessories} coat={RARITY[kind.rarity].coat} />
      {speech ? (
        <span
          className="buddy-bubble"
          role="status"
          // Keep it on screen near the edges.
          data-align={at.x + W / 2 + 118 > size.x ? "end" : at.x + W / 2 - 118 < 0 ? "start" : undefined}
          data-side={at.y < 90 ? "below" : undefined}
        >
          {speech}
        </span>
      ) : null}
    </button>
  );
}

// ------------------------------------------------------------------ progress card

function BuddyCard({
  buddy,
  kind,
  box,
  closeOnPan,
  size,
  progress,
  bamboo,
  goal,
  onClose,
  onHide,
  onTrick,
  onSettings,
}: {
  buddy: Buddy;
  kind: BuddyKind;
  /** The panda, on screen. */
  box: Box;
  /** It's out on a drawing: moving the drawing moves it out from under the card, so the card goes. */
  closeOnPan: boolean;
  size: Point;
  progress: Progress;
  bamboo: number;
  goal: number;
  /** `refocus`: hand focus back to the panda (closed from the keyboard). */
  onClose: (refocus: boolean) => void;
  onHide: () => void;
  onTrick: () => void;
  onSettings: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  // Once when it opens (not on every render above, which would pull focus back to the first button).
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t instanceof Element && t.closest(".buddy"))) return;
      close.current(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close.current(true);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    const panned = closeOnPan ? onView(() => close.current(false)) : null;
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      panned?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it opens
  }, []);

  const width = 288;
  const left = clamp(box.x + box.w / 2 - width / 2, 8, size.x - width - 8);
  const above = box.y > size.y / 2;
  const style = above
    ? { left, bottom: size.y - box.y + 10, maxHeight: box.y - 18 }
    : { left, top: box.y + box.h + 10, maxHeight: size.y - box.y - box.h - 18 };
  const span = progress.nextLevel === null ? 1 : progress.nextLevel - progress.levelFloor;
  const into = progress.points - progress.levelFloor;
  const next = UNLOCKS.find((u) => u.level > progress.level);
  const reviews = progress.today.reviews;
  const info = ABILITY[kind.ability];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${buddy.name}: today's progress`}
      className="pointer-events-auto absolute flex w-[288px] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 text-sm shadow-float"
      style={style}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-base font-bold">{buddy.name}</span>
        <span className="shrink-0 text-muted-foreground">Level {progress.level}</span>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.round((progress.nextLevel === null ? 1 : into / span) * 100)}%`, backgroundColor: buddy.color }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {progress.nextLevel === null
            ? `${progress.points} points: top level!`
            : `${into} of ${span} points to level ${progress.level + 1}${next && next.level === progress.level + 1 ? ` (${next.label})` : ""}`}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-beige-100 px-3 py-2.5" data-testid="buddy-kind">
        <div className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
            {info.trick}
            <RarityBadge rarity={kind.rarity} />
          </span>
          <span className="text-xs leading-snug text-muted-foreground">{info.text}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={onTrick} data-testid="buddy-trick" className="shrink-0">
          <Sparkles /> Show me
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Cards today</dt>
        <dd className="font-semibold" data-testid="buddy-reviews">
          {goal > 0 ? `${reviews} of ${goal}` : reviews}
          {goal > 0 && reviews >= goal ? " ✓" : ""}
        </dd>
        <dt className="text-muted-foreground">Tasks done</dt>
        <dd className="font-semibold" data-testid="buddy-tasks">
          {progress.today.tasks}
        </dd>
        <dt className="text-muted-foreground">Streak</dt>
        <dd className="flex items-center gap-1 font-semibold" data-testid="buddy-streak">
          {progress.streak > 0 ? <Flame className="size-4 text-orange" aria-hidden /> : null}
          {progress.streak === 1 ? "1 day" : `${progress.streak} days`}
        </dd>
        <dt className="text-muted-foreground">Bamboo</dt>
        <dd className="font-semibold" data-testid="buddy-bamboo">
          {bamboo}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        A flashcard answered is 1 point; a to-do card moved to Done is 5. Every 10 points is one more bamboo, for
        catching wild pandas.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onHide}>
          <EyeOff /> Hide buddies
        </Button>
        <Button variant="ghost" size="sm" onClick={onSettings}>
          <Settings2 /> Settings
        </Button>
        <Link
          href="/buddies"
          className="ml-auto rounded text-xs font-semibold text-green underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          All your buddies
        </Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={cn("flex items-center justify-between gap-4 text-sm font-semibold", disabled && "text-grey-500")}>
      <span>
        {label}
        {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

function BuddySettingsDialog({
  open,
  onOpenChange,
  data,
  save,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Loaded | null;
  save: (s: BuddySettings) => void;
}) {
  if (!data) return null;
  const { settings, progress, collection } = data;
  const accessories = accessoriesFor(progress.level);
  const set = (patch: Partial<BuddySettings>) => save({ ...settings, ...patch });
  const setBuddy = (id: string, patch: Partial<Buddy>) =>
    set({ buddies: settings.buddies.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const freeColor = () => BUDDY_COLORS.find((c) => !settings.buddies.some((b) => b.color === c)) ?? BUDDY_COLORS[0];
  const addNew = () => {
    const used = new Set(settings.buddies.map((b) => b.name));
    const name = DEFAULT_NAMES.find((n) => !used.has(n)) ?? `Buddy ${settings.buddies.length + 1}`;
    set({ buddies: [...settings.buddies, { id: `b${Date.now().toString(36)}`, name, color: freeColor(), x: null, y: null }] });
  };
  const bring = (c: CaughtBuddy) =>
    set({
      buddies: [
        ...settings.buddies,
        { id: partyIdFor(c.id), name: c.name.slice(0, 24), color: freeColor(), x: null, y: null, catchId: c.id },
      ],
    });
  const out = new Set(settings.buddies.flatMap((b) => (b.catchId ? [b.catchId] : [])));
  const atHome = collection.filter((c) => !out.has(c.id));
  const full = settings.buddies.length >= MAX_BUDDIES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        className="sm:max-w-md"
        title="Study buddies"
        description={
          <>
            Pandas that keep you company and keep count: level {progress.level}, {progress.points} points
            {progress.streak > 1 ? `, ${progress.streak} days in a row` : ""}.
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <SwitchRow label="Show study buddies" checked={settings.visible} onChange={(visible) => set({ visible })} />
          <SwitchRow label="Let them wander about" checked={settings.wander} onChange={(wander) => set({ wander })} />
          <SwitchRow
            label="Walk on drawings"
            hint={
              settings.wander
                ? "On a drawing they climb onto the canvas and walk about on it, moving with it as you pan and zoom."
                : "Needs wandering about on."
            }
            checked={settings.roam && settings.wander}
            disabled={!settings.wander}
            onChange={(roam) => set({ roam })}
          />
          <SwitchRow
            label="Do their tricks"
            hint="Now and then: a sprint across the screen, a nap, a little dance."
            checked={settings.tricks}
            onChange={(tricks) => set({ tricks })}
          />
          <SwitchRow
            label="Wild pandas on drawings"
            hint={
              data.wild.on
                ? "They turn up on your drawings now and then, to battle and catch."
                : "Taking a break for everyone just now. This switch is kept for when they're back."
            }
            checked={settings.wild}
            onChange={(wild) => set({ wild })}
          />
          <label className="flex items-center justify-between gap-4 text-sm font-semibold">
            <span>
              Daily goal
              <span className="block text-xs font-normal text-muted-foreground">Flashcards a day. 0 turns it off.</span>
            </span>
            <Input
              type="number"
              fieldSize="sm"
              min={0}
              max={500}
              className="w-24"
              value={settings.dailyGoal}
              onChange={(e) => set({ dailyGoal: Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0))) })}
            />
          </label>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">Buddies</legend>
            {settings.buddies.map((b) => {
              const kind = kindOf(b, collection);
              const caught = !!b.catchId;
              return (
                <div key={b.id} className="flex items-start gap-3" data-testid="party-buddy">
                  <span className="mt-0.5 size-11 shrink-0" aria-hidden>
                    <Panda color={b.color} accessories={accessories} coat={RARITY[kind.rarity].coat} />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        fieldSize="sm"
                        aria-label="Name"
                        value={b.name}
                        maxLength={24}
                        onChange={(e) => setBuddy(b.id, { name: e.target.value.slice(0, 24) })}
                        className="h-8 min-w-0 flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={caught ? `Leave ${b.name} at home` : `Remove ${b.name}`}
                        title={caught ? "Leave at home (they stay in your collection)" : "Remove"}
                        disabled={settings.buddies.length === 1}
                        onClick={() => set({ buddies: settings.buddies.filter((x) => x.id !== b.id) })}
                      >
                        {caught ? <House /> : <Trash2 />}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <div role="radiogroup" aria-label={`${b.name}'s scarf colour`} className="flex gap-1">
                        {BUDDY_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={b.color === c}
                            aria-label={`Colour ${c}`}
                            onClick={() => setBuddy(b.id, { color: c })}
                            className={cn(
                              "size-5 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring",
                              b.color === c && "ring-2 ring-foreground",
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <RarityBadge rarity={kind.rarity} />
                        {ABILITY[kind.ability].trick}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {!accessories.includes("scarf") ? (
              <p className="text-xs text-muted-foreground">Scarves come at level 2.</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {atHome.length === 0 ? (
                <Button variant="secondary" size="sm" onClick={addNew} disabled={full}>
                  <Plus /> Add a buddy
                </Button>
              ) : (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={full}>
                      <Plus /> Add a buddy
                    </Button>
                  </MenuTrigger>
                  <MenuContent className="max-h-80 overflow-y-auto">
                    <MenuItem onSelect={addNew}>
                      <Plus /> A new panda
                    </MenuItem>
                    <MenuSeparator />
                    <MenuLabel className="text-xs text-grey-500">Waiting at home</MenuLabel>
                    {atHome.map((c) => (
                      <MenuItem key={c.id} onSelect={() => bring(c)} className="h-10">
                        <span className="size-7 shrink-0" aria-hidden>
                          <Panda coat={RARITY[c.rarity].coat} />
                        </span>
                        <span className="truncate">{c.name}</span>
                        <RarityBadge rarity={c.rarity} className="ml-auto" />
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ buddies: settings.buddies.map((b) => ({ ...b, x: null, y: null })) })}
              >
                Back to the corner
              </Button>
              <Link
                href="/buddies"
                onClick={() => onOpenChange(false)}
                className="ml-auto rounded text-sm font-semibold text-green underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                All your buddies
              </Link>
            </div>
          </fieldset>
        </div>
      </DialogContent>
    </Dialog>
  );
}
