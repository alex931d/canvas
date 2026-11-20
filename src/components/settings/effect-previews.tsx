"use client";

import { LayoutGroup, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { DrawEffect } from "@/lib/preferences";

/**
 * Small live examples for the settings page, using the same timings as the
 * canvas (src/lib/canvas/effects.ts and kanban-fx.ts). Each replays when its
 * `play` count goes up; at 0 it shows the finished picture, still.
 */

const INK = "#201f24";
const TEAL = "#277c78";
const RED = "#c94736";

/** A pen squiggle, a box and a tick: the kind of thing that's on a canvas. */
const PARTS = [
  { d: "M18 74 C 30 34, 52 30, 58 58 S 84 96, 98 52", color: INK, width: 3.2 },
  { d: "M116 30 H178 V78 H116 Z", color: TEAL, width: 2.6 },
  { d: "M131 55 L141 65 L161 43", color: RED, width: 3.2 },
] as const;

export function EffectPreview({ effect, play }: { effect: DrawEffect; play: number }) {
  return (
    <svg viewBox="0 0 196 104" className="block h-full w-full" aria-hidden>
      <g key={play}>
        {PARTS.map((part, i) => (
          <PreviewPart key={part.d} part={part} effect={play === 0 ? "off" : effect} delay={i * 0.14} />
        ))}
      </g>
    </svg>
  );
}

function PreviewPart({ part, effect, delay }: { part: (typeof PARTS)[number]; effect: DrawEffect; delay: number }) {
  const common = {
    d: part.d,
    fill: "none",
    stroke: part.color,
    strokeWidth: part.width,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (effect) {
    case "off":
      return <path {...common} />;
    case "fade":
      return (
        <motion.path
          {...common}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, delay, ease: "easeOut" }}
        />
      );
    case "pop":
      return (
        <motion.path
          {...common}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay, type: "spring", stiffness: 420, damping: 24, mass: 0.9 }}
        />
      );
    case "trace":
      return (
        <motion.path
          {...common}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            pathLength: { duration: 0.55, delay: delay * 2.5, ease: [0.45, 0, 0.25, 1] },
            opacity: { duration: 0.01, delay: delay * 2.5 },
          }}
        />
      );
  }
}

// ------------------------------------------------------------ to-do board

export function BoardPreview({ animated, play }: { animated: boolean; play: number }) {
  // A new board each time, so it starts from the beginning.
  return <MiniBoard key={play} animated={animated} startDone={play === 0} />;
}

const GLIDE = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 } as const;

function MiniBoard({ animated, startDone }: { animated: boolean; startDone: boolean }) {
  const [done, setDone] = useState(startDone);
  useEffect(() => {
    if (startDone) return;
    const t = setTimeout(() => setDone(true), 550);
    return () => clearTimeout(t);
  }, [startDone]);

  const moving = (
    <motion.div
      layoutId={animated ? "preview-card" : undefined}
      layout={animated ? "position" : false}
      transition={GLIDE}
      className="relative z-10 rounded-md bg-white px-2.5 py-2 ring-1 ring-[#e7e1da]"
      style={{ boxShadow: `inset 3px 0 0 ${done ? TEAL : "#3f82b2"}` }}
    >
      <span className={done ? "relative text-grey-500" : "relative"}>
        Read chapter 4
        {done ? (
          <motion.span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-px origin-left bg-grey-500"
            initial={animated && !startDone ? { scaleX: 0 } : false}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.4, delay: 0.18, ease: [0.3, 0, 0.2, 1] }}
          />
        ) : null}
      </span>
    </motion.div>
  );
  const card = (text: string, color: string, finished = false) => (
    <div
      className="rounded-md bg-white px-2.5 py-2 ring-1 ring-[#e7e1da]"
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <span className={finished ? "text-grey-500 line-through" : undefined}>{text}</span>
    </div>
  );

  return (
    <LayoutGroup id="board-preview">
      <div
        aria-hidden
        className="rounded-xl bg-[#f8f4f0] p-3 text-[11px] leading-tight ring-1 ring-[#e6dfd7] select-none"
      >
        <div className="flex items-baseline justify-between px-0.5 pb-1">
          <span className="text-[13px] font-bold">This week</span>
          <span className="font-semibold text-grey-500">{done ? 2 : 1} of 3 done</span>
        </div>
        <div className="mb-2.5 h-[3px] overflow-hidden rounded-full bg-[#e9e3dc]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: TEAL }}
            initial={false}
            animate={{ width: done ? "66.7%" : "33.3%" }}
            transition={animated ? { duration: 0.45, ease: [0.3, 0, 0.2, 1] } : { duration: 0 }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid content-start gap-1.5 rounded-lg bg-white/70 p-1.5">
            <span className="flex items-center gap-1.5 px-1 py-0.5 font-bold">
              <span className="size-2 rounded-full bg-[#3f82b2]" /> To do
            </span>
            {done ? null : moving}
            {card("Problem set 2", "#3f82b2")}
          </div>
          <div className="grid content-start gap-1.5 rounded-lg bg-white/70 p-1.5">
            <span className="flex items-center gap-1.5 px-1 py-0.5 font-bold">
              <span className="size-2 rounded-full" style={{ backgroundColor: TEAL }} /> Done
            </span>
            {card("Lab notes", TEAL, true)}
            {done ? moving : null}
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
}
