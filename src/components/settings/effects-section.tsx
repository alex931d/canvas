"use client";

import { Check, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { updatePreferences } from "@/app/settings/actions";
import { Button, Switch, toast } from "@/components/kit";
import { DRAW_EFFECTS, DRAW_EFFECT_INFO, type DrawEffect, type Preferences } from "@/lib/preferences";
import { BrowserProfile, useBrowserPreferences } from "@/lib/profile/browser-profile";
import { BoardPreview, EffectPreview } from "./effect-previews";

/** The canvas's dotted paper, behind each example. */
const PAPER = {
  backgroundImage: "radial-gradient(circle, #d8d1ca 1px, transparent 1.2px)",
  backgroundSize: "16px 16px",
};

type PreviewKey = DrawEffect | "board";

/** Only ever called from event handlers. */
const clock = () => performance.now();

const noSubscribe = () => () => {};

/**
 * Without a membership the choices are kept in this browser: read once the
 * page is running here (the server can't see them), falling back to `initial`.
 */
export function BrowserEffectsSection({ initial }: { initial: Preferences }) {
  const local = useBrowserPreferences();
  const running = useSyncExternalStore(noSubscribe, () => true, () => false);
  return <EffectsSection key={running ? "here" : "server"} initial={(running ? local : null) ?? initial} inBrowser />;
}

/** Drawing effect and to-do board choices, saved as soon as they change (in this browser with `inBrowser`). */
export function EffectsSection({ initial, inBrowser = false }: { initial: Preferences; inBrowser?: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<"" | "saving" | "saved">("");
  const [, start] = useTransition();
  const reduce = useReducedMotion();

  const [plays, setPlays] = useState<Record<PreviewKey, number>>({ off: 0, fade: 0, pop: 0, trace: 0, board: 0 });
  const lastPlay = useRef<Partial<Record<PreviewKey, number>>>({});
  const replay = (key: PreviewKey) => {
    const now = clock();
    // Hovering back and forth shouldn't restart it every time.
    if (now - (lastPlay.current[key] ?? -Infinity) < 900) return;
    lastPlay.current[key] = now;
    setPlays((p) => ({ ...p, [key]: p[key] + 1 }));
  };

  const save = (next: Preferences) => {
    const before = prefs;
    setPrefs(next);
    if (inBrowser) {
      if (BrowserProfile.savePreferences(next)) setStatus("saved");
      else {
        setPrefs(before);
        setStatus("");
        toast.error("This browser wouldn't keep the change. Its storage may be off or full.");
      }
      return;
    }
    setStatus("saving");
    start(async () => {
      const result = await updatePreferences(next);
      if (result.ok) {
        setStatus("saved");
        return;
      }
      setPrefs(before);
      setStatus("");
      toast.error(result.error);
    });
  };

  return (
    <div className="grid gap-10">
      {reduce ? (
        <p className="rounded-lg bg-beige-100 px-4 py-3 text-sm leading-relaxed">
          This device is set to reduce motion, so canvas keeps these effects off here.{" "}
          {inBrowser
            ? "What you pick is kept in this browser for when motion is allowed."
            : "What you pick still applies on your other devices."}
        </p>
      ) : null}

      <motion.div
        className="grid gap-4"
        viewport={{ once: true, amount: 0.35 }}
        // The examples play once as they come into view.
        onViewportEnter={() => {
          for (const e of DRAW_EFFECTS) if (e !== "off") replay(e);
          replay("board");
        }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="draw-effect-title" className="font-bold">
            When things appear on a canvas
          </h3>
          <span role="status" data-testid="prefs-status" className="text-sm text-grey-500">
            {status === "saving" ? "Saving…" : status === "saved" ? (inBrowser ? "Saved in this browser" : "Saved") : ""}
          </span>
        </div>
        <p className="-mt-2 max-w-[44rem] text-sm leading-relaxed text-grey-500">
          This plays when a drawing opens, when someone else draws, and when you paste, undo or add an equation, graph
          or picture. What you draw yourself is on screen as you draw it, so it never replays.
        </p>
        <div role="radiogroup" aria-labelledby="draw-effect-title" className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          {DRAW_EFFECTS.map((effect) => {
            const checked = prefs.drawEffect === effect;
            const info = DRAW_EFFECT_INFO[effect];
            return (
              <label
                key={effect}
                onPointerEnter={() => replay(effect)}
                className="relative grid cursor-pointer content-start overflow-hidden rounded-xl bg-white ring-1 ring-grey-900/10 transition-shadow hover:ring-grey-900/25 has-[:checked]:ring-2 has-[:checked]:ring-grey-900 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-green"
              >
                <input
                  type="radio"
                  name="drawEffect"
                  value={effect}
                  checked={checked}
                  onChange={() => {
                    save({ ...prefs, drawEffect: effect });
                    replay(effect);
                  }}
                  className="sr-only"
                />
                <span className="block aspect-[196/104] bg-beige-100 px-2" style={PAPER}>
                  <EffectPreview effect={effect} play={plays[effect]} />
                </span>
                <span className="grid gap-1 p-3 sm:p-4">
                  <span className="flex items-center justify-between gap-2 font-bold">
                    {info.label}
                    {checked ? (
                      <span className="grid size-5 place-items-center rounded-full bg-grey-900 text-white">
                        <Check className="size-3.5" strokeWidth={3} aria-hidden />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs leading-relaxed text-grey-500 sm:text-sm">{info.text}</span>
                </span>
              </label>
            );
          })}
        </div>
      </motion.div>

      <div className="grid gap-6 border-t border-grey-100 pt-8 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @2xl:items-center @2xl:gap-10">
        <div className="grid gap-3">
          <div className="flex items-start justify-between gap-6">
            <label htmlFor="board-effects" className="grid gap-1">
              <span className="font-bold">Animate to-do boards</span>
              <span className="text-sm leading-relaxed text-grey-500">
                Cards glide into the column you drop them in, new cards pop in, the progress bar slides, and a card that
                reaches the last column is crossed out as you watch.
              </span>
            </label>
            <Switch
              id="board-effects"
              checked={prefs.boardEffects}
              onCheckedChange={(on) => {
                save({ ...prefs, boardEffects: on });
                if (on) replay("board");
              }}
            />
          </div>
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => {
                lastPlay.current.board = -Infinity;
                replay("board");
              }}
            >
              <Play /> Play the example
            </Button>
          </div>
        </div>
        <div onPointerEnter={() => replay("board")} className="rounded-xl bg-beige-100 p-4" style={PAPER}>
          <BoardPreview animated={prefs.boardEffects} play={plays.board} />
        </div>
      </div>
    </div>
  );
}
