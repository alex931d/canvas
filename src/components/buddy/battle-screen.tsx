"use client";

import { ArrowLeft, Footprints, Heart, Sparkles, Swords, Users } from "lucide-react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent } from "@/components/kit";
import {
  BASIC_MOVES,
  MOVE,
  moveName,
  type Action,
  type BattleView,
  type Fighter,
  type Fx,
  type MoveId,
  type Outcome,
  type Side,
  type Step,
} from "@/lib/buddy/battle";
import type { BattleReply, WildEncounter } from "@/lib/buddy/game";
import { ABILITY, RARITY, type Ability } from "@/lib/buddy/kinds";
import type { Accessory } from "@/lib/buddy/shared";
import { cn } from "@/lib/utils";
import { Panda, type Pose } from "./panda";
import { RarityBadge } from "./rarity-badge";

/**
 * A battle with a wild panda: a page of a sketchbook with the wild panda at
 * the top, your buddy (from behind) at the bottom, and what's happening
 * written underneath. The server plays every turn (POST /api/buddy/battle);
 * this only shows the steps it sends back, one after another, with Motion.
 */

export type BattleResult = { outcome: Outcome | "error"; caught: BattleReply["caught"] };

type Phase = "starting" | "menu" | "fight" | "buddies" | "busy" | "over";
type Floater = { id: number; side: Side; text: string; tone: "hit" | "big" | "heal" | "up" | "down" };

/** What each special move looks like: the trick's own pose. */
const MOVE_POSE: Record<Ability, Pose> = {
  sprint: "run",
  roll: "roll",
  nap: "sleep",
  snack: "snack",
  cheer: "cheer",
  dance: "dance",
  stardust: "twinkle",
};

const hpTone = (hp: number, max: number) => (hp / max > 0.5 ? "#277c78" : hp / max > 0.2 ? "#cab361" : "#c94736");

async function send(body: unknown): Promise<BattleReply> {
  const res = await fetch("/api/buddy/battle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "Something went wrong with the battle.");
  return json as BattleReply;
}

export function PandaBattle({
  encounter,
  bamboo: startBamboo,
  accessories,
  onDone,
}: {
  encounter: WildEncounter;
  bamboo: number;
  /** What your buddies wear (from your level). */
  accessories: readonly Accessory[];
  onDone: (result: BattleResult) => void;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(true);
  const [battle, setBattle] = useState<BattleView | null>(encounter.battle);
  const [phase, setPhase] = useState<Phase>(encounter.battle ? "menu" : "starting");
  const [message, setMessage] = useState(
    encounter.battle ? `What will ${encounter.battle.you[encounter.battle.active].name} do?` : "",
  );
  const [shown, setShown] = useState(() =>
    encounter.battle
      ? { you: encounter.battle.you.map((f) => f.hp), wild: encounter.battle.wild.hp, active: encounter.battle.active }
      : null,
  );
  const [poses, setPoses] = useState<Record<Side, Pose>>({ you: "idle", wild: "idle" });
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [toss, setToss] = useState<{ key: number; wobbles: number; caught: boolean } | null>(null);
  const [hearts, setHearts] = useState(0);
  const [bamboo, setBamboo] = useState(startBamboo);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [wildScope, animateWild] = useAnimate<HTMLDivElement>();
  const [youScope, animateYou] = useAnimate<HTMLDivElement>();
  const skip = useRef<(() => void) | null>(null);
  const floaterId = useRef(0);
  const started = useRef(false);
  const firstCommand = useRef<HTMLButtonElement>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  /** A turn on its way to the server (a quick second press mustn't send another). */
  const sending = useRef(false);
  /** The server's latest word, which may be ahead of what's been shown so far. */
  const truth = useRef<{ battle: BattleView; caught: BattleReply["caught"] } | null>(
    encounter.battle ? { battle: encounter.battle, caught: null } : null,
  );

  const scale = reduce ? 0 : 1;
  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          if (skip.current === done) skip.current = null;
          resolve();
        };
        const t = setTimeout(done, ms);
        skip.current = done;
      }),
    [],
  );

  const float = (side: Side, text: string, tone: Floater["tone"]) => {
    const id = ++floaterId.current;
    setFloaters((f) => [...f, { id, side, text, tone }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1100);
  };

  const animateSide = (side: Side, keyframes: Record<string, number[]>, duration: number) => {
    const run = side === "wild" ? animateWild : animateYou;
    const scope = side === "wild" ? wildScope : youScope;
    if (!scope.current) return;
    void run(scope.current, keyframes, { duration: duration * scale, ease: "easeInOut" });
  };

  /** Show one step's animation; returns how long it takes. */
  const show = (fx: Fx | undefined, view: BattleView | null): number => {
    if (!fx) return 0;
    const toward = (side: Side) => (side === "you" ? 1 : -1);
    switch (fx.kind) {
      case "appear":
        animateSide("wild", { x: [180, 0], opacity: [0, 1] }, 0.7);
        animateSide("you", { x: [-180, 0], opacity: [0, 1] }, 0.7);
        return 900;
      case "use": {
        const who = fx.side === "you" ? view?.you[shown?.active ?? view.active] : view?.wild;
        if (fx.move === "special" && who) {
          const pose = MOVE_POSE[who.ability];
          setPoses((p) => ({ ...p, [fx.side]: pose }));
          setTimeout(() => setPoses((p) => ({ ...p, [fx.side]: "idle" })), 1100);
        }
        const d = toward(fx.side);
        animateSide(fx.side, { x: [0, 48 * d, 0], y: [0, -22 * d, 0] }, 0.38);
        return 520;
      }
      case "hit":
        setShown((s) =>
          s
            ? fx.side === "wild"
              ? { ...s, wild: fx.hp }
              : { ...s, you: s.you.map((hp, i) => (i === s.active ? fx.hp : hp)) }
            : s,
        );
        animateSide(fx.side, { x: [0, -10, 10, -7, 7, 0], opacity: [1, 0.35, 1, 0.35, 1, 1] }, 0.55);
        float(fx.side, `−${fx.damage}`, fx.strong ? "big" : "hit");
        return 800;
      case "miss": {
        const target: Side = fx.side === "you" ? "wild" : "you";
        animateSide(target, { x: [0, 32 * toward(target) * -1, 0] }, 0.4);
        return 550;
      }
      case "heal":
        setShown((s) =>
          s
            ? fx.side === "wild"
              ? { ...s, wild: fx.hp }
              : { ...s, you: s.you.map((hp, i) => (i === s.active ? fx.hp : hp)) }
            : s,
        );
        animateSide(fx.side, { scale: [1, 1.08, 1] }, 0.5);
        float(fx.side, `+${fx.amount}`, "heal");
        return 850;
      case "stat":
        animateSide(fx.side, fx.change > 0 ? { y: [0, -16, 0] } : { y: [0, 6, 0], scaleY: [1, 0.92, 1] }, 0.45);
        float(fx.side, fx.change > 0 ? "▲ stronger" : fx.stat === "aim" ? "dizzy" : "▼ timid", fx.change > 0 ? "up" : "down");
        return 750;
      case "bamboo": {
        setToss({ key: Date.now(), wobbles: fx.wobbles, caught: fx.caught });
        setBamboo((b) => Math.max(0, b - 1));
        // The wild panda thinks it over: a nibble for each wobble.
        const flight = 700 * scale;
        for (let i = 0; i < fx.wobbles; i++) {
          setTimeout(
            () => animateSide("wild", { rotate: [0, -10, 10, -6, 0] }, 0.5),
            flight + i * 620 * scale,
          );
        }
        if (fx.caught) {
          setTimeout(() => {
            setHearts((h) => h + 1);
            setPoses((p) => ({ ...p, wild: "cheer" }));
            animateSide("wild", { y: [0, -20, 0], scale: [1, 1.12, 1] }, 0.6);
          }, flight + fx.wobbles * 620 * scale);
        }
        return flight + fx.wobbles * 620 * scale + (fx.caught ? 1100 : 450) * Math.max(scale, 0.3);
      }
      case "tired":
        setPoses((p) => ({ ...p, [fx.side]: "sleep" }));
        animateSide(fx.side, { y: [0, 30], opacity: [1, 0] }, 0.7);
        return 950;
      case "switch":
        setShown((s) => (s ? { ...s, active: fx.to } : s));
        setPoses((p) => ({ ...p, you: "idle" }));
        animateSide("you", { x: [-180, 0], opacity: [0, 1], y: [0, 0] }, 0.6);
        return 800;
      case "end":
        if (fx.outcome === "fled") animateSide("wild", { x: [0, 260], opacity: [1, 0] }, 0.6);
        if (fx.outcome === "ran") animateSide("you", { x: [0, -260], opacity: [1, 0] }, 0.6);
        return 700;
    }
  };

  const play = async (steps: Step[], next: BattleView, caught: BattleReply["caught"]) => {
    setPhase("busy");
    for (const step of steps) {
      if (step.text) setMessage(step.text);
      const ms = show(step.fx, next);
      await wait(Math.max(step.text ? (reduce ? 700 : 1050) : 0, ms));
    }
    setBattle(next);
    setShown({ you: next.you.map((f) => f.hp), wild: next.wild.hp, active: next.active });
    if (next.over) {
      setResult({ outcome: next.over, caught });
      setPhase("over");
    } else if (next.mustSwitch) {
      setPhase("buddies");
      setMessage("Who's next?");
    } else {
      setPoses({ you: "idle", wild: "idle" });
      setPhase("menu");
      setMessage(`What will ${next.you[next.active].name} do?`);
    }
  };

  const fail = (err: unknown) => {
    setMessage(err instanceof Error ? err.message : "Something went wrong with the battle.");
    setResult({ outcome: "error", caught: null });
    setPhase("over");
  };

  // Start (once) when it opens, unless it's a battle already under way.
  useEffect(() => {
    if (started.current || encounter.battle) return;
    started.current = true;
    send({ id: encounter.id, action: "start" })
      .then((reply) => {
        truth.current = { battle: reply.battle, caught: null };
        setBattle(reply.battle);
        setShown({ you: reply.battle.you.map((f) => f.hp), wild: reply.battle.wild.hp, active: reply.battle.active });
        setBamboo(reply.bamboo);
        // Let the arena render before the first animation.
        requestAnimationFrame(() => void play(reply.steps, reply.battle, null));
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per battle
  }, []);

  useEffect(() => {
    if (phase === "menu") firstCommand.current?.focus({ preventScroll: true });
    // While it plays out, Enter or Space skips ahead.
    if (phase === "busy") skipButton.current?.focus({ preventScroll: true });
  }, [phase]);

  const take = async (action: Action) => {
    if (!battle || sending.current) return;
    sending.current = true;
    setPhase("busy");
    try {
      const reply = await send({ id: encounter.id, turn: battle.turn, action });
      truth.current = { battle: reply.battle, caught: reply.caught };
      setBamboo(reply.bamboo + (action.type === "bamboo" ? 1 : 0)); // the toss takes it off as it flies
      await play(reply.steps, reply.battle, reply.caught);
      setBamboo(reply.bamboo);
    } catch (err) {
      fail(err);
    } finally {
      sending.current = false;
    }
  };

  const close = () => {
    setOpen(false);
    const latest = truth.current;
    // Closed before the end was shown: it still ended the way the server says.
    if (latest?.battle.over) return onDone({ outcome: latest.battle.over, caught: latest.caught });
    // Leaving mid-battle is running away.
    if (latest && !result) {
      void fetch("/api/buddy/battle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: encounter.id, turn: latest.battle.turn, action: { type: "run" } }),
        keepalive: true,
      }).catch(() => {});
    }
    onDone(result ?? { outcome: "ran", caught: null });
  };

  const you: Fighter | null = battle && shown ? battle.you[shown.active] : null;
  const wild = battle?.wild ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent
        title={`A battle with ${encounter.name}`}
        titleHidden
        size="xl"
        className="gap-0 overflow-hidden bg-[#f8f4f0] p-0 sm:max-w-[880px] sm:p-0"
        data-testid="battle"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* ------------------------------------------------ the arena */}
        <div
          className="relative h-[min(54vh,400px)] min-h-[300px] overflow-hidden border-b border-[#e6dfd7] select-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, #ddd5cc 1px, transparent 1.3px), linear-gradient(#f8f4f0 55%, #eef0e4 55%)",
            backgroundSize: "18px 18px, 100% 100%",
          }}
          aria-hidden
        >
          <Scenery />

          {/* the wild panda's side */}
          <div className="absolute top-[30%] right-[6%] h-[16%] w-[38%]">
            <Platform />
          </div>
          {/* Out of sight until they walk on (a battle picked up again starts with them there). */}
          <div
            ref={wildScope}
            className="absolute top-[3%] right-[14%] w-[22%] max-w-[170px] min-w-[110px]"
            data-side="wild"
            style={{ opacity: encounter.battle ? 1 : 0 }}
          >
            {wild ? (
              <div data-pose={poses.wild} className="relative" data-testid="battle-wild">
                <Panda coat={RARITY[wild.rarity].coat} pose={poses.wild} view="front" />
                <Floaters items={floaters.filter((f) => f.side === "wild")} />
                <Hearts burst={hearts} />
              </div>
            ) : null}
          </div>

          {/* yours */}
          <div className="absolute bottom-[4%] left-[2%] h-[18%] w-[44%]">
            <Platform />
          </div>
          <div
            ref={youScope}
            className="absolute bottom-[8%] left-[12%] w-[27%] max-w-[210px] min-w-[130px]"
            data-side="you"
            style={{ opacity: encounter.battle ? 1 : 0 }}
          >
            {you ? (
              <div className="relative">
                <Panda
                  coat={RARITY[you.rarity].coat}
                  pose={poses.you}
                  view="back"
                  color={you.color}
                  accessories={accessories}
                />
                <Floaters items={floaters.filter((f) => f.side === "you")} />
              </div>
            ) : null}
          </div>

          {/* bamboo, offered */}
          <AnimatePresence>
            {toss ? (
              <motion.div
                key={toss.key}
                className="absolute z-10 w-[5%] min-w-7"
                initial={{ left: "22%", top: "62%", rotate: 0, opacity: 1 }}
                animate={
                  toss.caught || toss.wobbles > 0
                    ? { left: ["22%", "50%", "70%"], top: ["62%", "8%", "26%"], rotate: [0, 220, 340], opacity: 1 }
                    : {
                        left: ["22%", "50%", "70%", "92%"],
                        top: ["62%", "8%", "26%", "80%"],
                        rotate: [0, 220, 340, 520],
                        opacity: [1, 1, 1, 0],
                      }
                }
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: (toss.caught || toss.wobbles > 0 ? 0.7 : 1.1) * (reduce ? 0.01 : 1), ease: "easeOut" }}
                onAnimationComplete={() => {
                  if (toss.caught) return;
                  setTimeout(() => setToss(null), toss.wobbles * 620 + 300);
                }}
              >
                <BambooStalk />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* the wild panda's card */}
          {wild ? (
            <StatusCard
              className="top-[6%] left-[4%] -rotate-1"
              name={wild.name}
              fighter={wild}
              hp={shown?.wild ?? wild.hp}
              testid="wild-status"
            />
          ) : null}
          {/* yours */}
          {you ? (
            <StatusCard
              className="right-[4%] bottom-[8%] rotate-1"
              name={you.name}
              fighter={you}
              hp={shown?.you[shown.active] ?? you.hp}
              showNumbers
              testid="your-status"
            />
          ) : null}
        </div>

        {/* ------------------------------------------------ what's happening, and what to do */}
        <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:p-4">
          <div
            className="relative min-h-[96px] rounded-xl bg-white px-5 py-3 ring-1 ring-[#e6dfd7] sm:h-[150px]"
            style={{
              backgroundImage: "repeating-linear-gradient(transparent 0 31px, #ece5dc 31px 32px)",
              backgroundPosition: "0 10px",
            }}
          >
            <p role="status" aria-live="polite" data-testid="battle-message" className="font-hand text-[26px] leading-8 text-grey-900">
              {message || "\u00a0"}
            </p>
            {phase === "busy" ? (
              <button
                ref={skipButton}
                type="button"
                aria-label="Skip ahead"
                className="absolute inset-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-green"
                onClick={() => skip.current?.()}
              />
            ) : null}
            {phase === "fight" || (phase === "buddies" && battle && !battle.mustSwitch) ? (
              <Button variant="ghost" size="sm" className="absolute right-2 bottom-2" onClick={() => setPhase("menu")}>
                <ArrowLeft /> Back
              </Button>
            ) : null}
          </div>

          {/* A steady height, so the page doesn't jump between steps. */}
          <div className="h-[150px]">
            {phase === "menu" && battle && you && wild ? (
              <p className="sr-only">
                {you.name} has {shown?.you[shown.active] ?? you.hp} of {you.maxHp} energy; {wild.name} has{" "}
                {shown?.wild ?? wild.hp} of {wild.maxHp}.
              </p>
            ) : null}
            {phase === "menu" && battle ? (
              <div className="grid h-full grid-cols-2 grid-rows-2 gap-2">
                <Command ref={firstCommand} tone="#c94736" icon={<Swords />} label="Fight" onClick={() => setPhase("fight")} />
                <Command
                  tone="#277c78"
                  icon={<Sparkles />}
                  label="Bamboo"
                  detail={bamboo > 0 ? `${bamboo} left, ${Math.round(battle.chance * 100)}% chance` : "None left"}
                  disabled={bamboo <= 0}
                  onClick={() => void take({ type: "bamboo" })}
                />
                <Command
                  tone="#3f82b2"
                  icon={<Users />}
                  label="Buddies"
                  disabled={battle.you.length < 2}
                  onClick={() => setPhase("buddies")}
                />
                <Command tone="#2b2a30" icon={<Footprints />} label="Run" onClick={() => void take({ type: "run" })} />
              </div>
            ) : null}

            {phase === "fight" && battle && you ? (
              <div className="grid h-full grid-cols-2 grid-rows-2 gap-2" role="group" aria-label="Moves">
                {([...BASIC_MOVES, "special"] as MoveId[]).map((m, i) => (
                  <MoveButton
                    key={m}
                    autoFocus={i === 0}
                    name={moveName(m, you.ability)}
                    text={m === "special" ? ABILITY[you.ability].moveText : MOVE[m as (typeof BASIC_MOVES)[number]].text}
                    special={m === "special"}
                    onClick={() => void take({ type: "move", move: m })}
                  />
                ))}
              </div>
            ) : null}

            {phase === "buddies" && battle ? (
              <div className="grid h-full content-start gap-1.5 overflow-y-auto" role="group" aria-label="Your buddies">
                {battle.you.map((f, i) => {
                  const out = i === (shown?.active ?? battle.active);
                  const hp = shown?.you[i] ?? f.hp;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      autoFocus={!out && hp > 0}
                      disabled={out || hp <= 0}
                      onClick={() => void take({ type: "switch", to: i })}
                      className="flex items-center gap-3 rounded-xl bg-white px-3 py-1.5 text-left text-sm ring-1 ring-[#e6dfd7] outline-none hover:ring-grey-900/30 focus-visible:ring-[3px] focus-visible:ring-green disabled:opacity-50"
                    >
                      <span className="size-9 shrink-0">
                        <Panda
                          coat={RARITY[f.rarity].coat}
                          color={f.color}
                          accessories={accessories}
                          pose={hp <= 0 ? "sleep" : "idle"}
                        />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex items-center gap-2 font-bold">
                          <span className="truncate">{f.name}</span>
                          {out ? <span className="text-xs font-semibold text-grey-500">Out now</span> : null}
                          {hp <= 0 ? <span className="text-xs font-semibold text-grey-500">Worn out</span> : null}
                        </span>
                        <HpBar hp={hp} max={f.maxHp} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {phase === "over" ? (
              <div className="grid h-full content-center gap-2" data-testid="battle-over" data-outcome={result?.outcome}>
                {result?.caught ? (
                  <div className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-[#e6dfd7]">
                    <span className="size-12 shrink-0">
                      <Panda coat={RARITY[result.caught.rarity].coat} pose="happy" />
                    </span>
                    <span className="grid gap-0.5 text-sm">
                      <span className="flex items-center gap-2 font-bold">
                        {result.caught.name} <RarityBadge rarity={result.caught.rarity} />
                      </span>
                      <span className="text-grey-500">
                        {result.caught.walking ? "Walking with you now." : "Waiting at home: three are out with you."}
                      </span>
                    </span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button autoFocus onClick={close}>
                    Done
                  </Button>
                  {result?.caught ? (
                    <Button asChild variant="secondary">
                      <Link href="/buddies" onClick={close}>
                        See all your buddies
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {phase === "starting" || phase === "busy" ? (
              <p className="grid h-full place-items-center px-1 text-center text-sm text-grey-500">
                {phase === "busy" ? "Press the message to skip ahead." : "\u00a0"}
              </p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ pieces

function StatusCard({
  name,
  fighter,
  hp,
  showNumbers = false,
  className,
  testid,
}: {
  name: string;
  fighter: Fighter;
  hp: number;
  showNumbers?: boolean;
  className?: string;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className={cn(
        "absolute z-20 grid w-[46%] max-w-[300px] min-w-[170px] gap-1.5 rounded-lg bg-white px-3.5 pt-3 pb-2.5 shadow-[0_2px_0_#e6dfd7] ring-1 ring-[#ddd5cc]",
        className,
      )}
    >
      {/* a strip of tape holding the card on the page */}
      <span className="absolute -top-2 left-1/2 h-4 w-14 -translate-x-1/2 rotate-2 rounded-[2px] bg-[#277c78]/25" />
      <div className="flex items-center gap-2">
        <span className="truncate text-[15px] font-bold">{name}</span>
        {fighter.rarity !== "common" ? <RarityBadge rarity={fighter.rarity} /> : null}
        <span className="ml-auto text-xs font-bold whitespace-nowrap text-grey-500">Lv. {fighter.level}</span>
      </div>
      <HpBar hp={hp} max={fighter.maxHp} />
      {showNumbers ? (
        <span className="justify-self-end text-xs font-bold tabular-nums" data-testid={`${testid}-hp`}>
          {hp} / {fighter.maxHp}
        </span>
      ) : null}
    </div>
  );
}

function HpBar({ hp, max }: { hp: number; max: number }) {
  const share = Math.max(0, Math.min(1, hp / max));
  return (
    <span className="flex items-center gap-2">
      <span className="text-[10px] font-bold tracking-wide text-grey-500">Energy</span>
      <span
        className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[#ece5dc]"
        role="meter"
        aria-label="Energy"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={hp}
      >
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          initial={false}
          animate={{ width: `${share * 100}%`, backgroundColor: hpTone(hp, max) }}
          transition={{ type: "spring", stiffness: 160, damping: 24 }}
        />
      </span>
    </span>
  );
}

function Floaters({ items }: { items: Floater[] }) {
  return (
    <AnimatePresence>
      {items.map((f) => (
        <motion.span
          key={f.id}
          className={cn(
            "pointer-events-none absolute top-[10%] left-1/2 z-30 -translate-x-1/2 rounded-full px-2 py-0.5 text-sm font-bold whitespace-nowrap",
            f.tone === "heal" || f.tone === "up" ? "bg-[#dcefe9] text-[#1f6965]" : "bg-white text-red ring-1 ring-red/30",
            f.tone === "big" && "text-base",
          )}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: -26 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          {f.text}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Hearts bursting out when a panda joins you. */
function Hearts({ burst }: { burst: number }) {
  if (burst === 0) return null;
  return (
    <span key={burst} className="pointer-events-none absolute inset-0 z-30">
      {Array.from({ length: 7 }, (_, i) => {
        const angle = (i / 7) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 text-red"
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
            animate={{ x: Math.cos(angle) * 70, y: Math.sin(angle) * 60, scale: 1, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeOut", delay: i * 0.03 }}
          >
            <Heart className="size-5 fill-current" />
          </motion.span>
        );
      })}
    </span>
  );
}

function Command({
  ref,
  tone,
  icon,
  label,
  detail,
  disabled,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  tone: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-14 content-center gap-0.5 rounded-xl px-3.5 py-2 text-left text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.18)] outline-none transition-[filter,transform] hover:brightness-110 focus-visible:ring-[3px] focus-visible:ring-green focus-visible:ring-offset-2 active:translate-y-px disabled:opacity-45 [&_svg]:size-4"
      style={{ backgroundColor: tone }}
    >
      <span className="flex items-center gap-2 text-[15px] font-bold">
        {icon}
        {label}
      </span>
      {detail ? <span className="text-xs font-semibold text-white/80">{detail}</span> : null}
    </button>
  );
}

function MoveButton({
  name,
  text,
  special,
  autoFocus,
  onClick,
}: {
  name: string;
  text: string;
  special: boolean;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className={cn(
        "grid min-h-14 content-center gap-0.5 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-[#ddd5cc] outline-none hover:ring-grey-900/40 focus-visible:ring-[3px] focus-visible:ring-green",
        special && "ring-2 ring-[#cab361]",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-bold">
        {special ? <Sparkles className="size-3.5 text-[#b5832a]" aria-hidden /> : null}
        {name}
      </span>
      <span className="text-[11px] leading-snug text-grey-500">{text}</span>
    </button>
  );
}

function Platform() {
  return (
    <svg viewBox="0 0 200 60" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
      <ellipse cx="100" cy="32" rx="96" ry="24" fill="#dfe7cf" stroke="#9fb38a" strokeWidth="1.5" />
      <ellipse cx="100" cy="30" rx="80" ry="15" fill="#e9efdc" />
      <g stroke="#7f9a68" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <path d="M30 34 l-3 -8 M33 34 l1 -9 M36 34 l4 -7" />
        <path d="M160 38 l-3 -7 M163 38 l1 -8 M166 38 l4 -6" />
        <path d="M96 50 l-2 -6 M99 50 l1 -7" />
      </g>
    </svg>
  );
}

/** Bamboo sketched at the edges of the page. */
function Scenery() {
  const stalk = (x: number, h: number, lean: number) => (
    <g key={x} transform={`translate(${x} 0) rotate(${lean} 0 300)`}>
      <rect x="-5" y={300 - h} width="10" height={h} rx="4" fill="#cfe0bd" stroke="#8aa776" strokeWidth="1.5" />
      {Array.from({ length: Math.floor(h / 46) }, (_, i) => (
        <path key={i} d={`M-5 ${300 - 40 - i * 46} h10`} stroke="#8aa776" strokeWidth="1.5" />
      ))}
      <path d={`M5 ${310 - h} q16 -10 26 -4 q-14 4 -26 10 Z`} fill="#b9d3a2" stroke="#8aa776" strokeWidth="1.2" />
    </g>
  );
  return (
    <svg viewBox="0 0 880 300" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <path d="M0 166 Q220 158 440 166 T880 162" fill="none" stroke="#d9cfc4" strokeWidth="1.5" strokeDasharray="2 6" />
      {stalk(26, 250, -3)}
      {stalk(50, 190, 2)}
      {stalk(842, 260, 3)}
      {stalk(818, 170, -2)}
    </svg>
  );
}

function BambooStalk() {
  return (
    <svg viewBox="0 0 24 60" className="h-auto w-full drop-shadow" aria-hidden>
      <rect x="8" y="4" width="8" height="52" rx="3.5" fill="#7fae5a" stroke="#3f6b2c" strokeWidth="1.5" />
      <path d="M8 22 h8 M8 40 h8" stroke="#3f6b2c" strokeWidth="1.5" />
      <path d="M16 10 q10 -8 16 -3 q-9 3 -16 8 Z" fill="#9cc56f" stroke="#3f6b2c" strokeWidth="1.2" />
    </svg>
  );
}
