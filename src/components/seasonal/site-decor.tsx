"use client";

import { Egg, Ghost, Snowflake } from "lucide-react";
import { THEME_INFO, type Theme } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { Bat, CandyCane, CandyCanePair, EasterEgg, EggNest, JackOLantern, Spider } from "./art";
import { useLanternLit, useLightsOut, useLightsOutSchedule } from "./lights";
import { Particles } from "./particles";
import { setDecorationsHidden, useReducedMotion, useSeason, useSeasonState } from "./season-context";

/** Seasonal decorations for the public pages (landing and pricing). */

const ICONS: Record<Theme, React.ComponentType<{ className?: string }>> = {
  christmas: Snowflake,
  halloween: Ghost,
  easter: Egg,
};

/** Bats crossing their container now and then: three of them, at different heights and speeds. */
export function Bats({ count = 3, className }: { count?: number; className?: string }) {
  const flights = [
    { top: "12%", dur: "16s", delay: "0s", size: "h-6" },
    { top: "34%", dur: "21s", delay: "5s", size: "h-4" },
    { top: "22%", dur: "26s", delay: "11s", size: "h-5" },
  ].slice(0, count);
  return (
    <div aria-hidden data-season-bats className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {flights.map((f, i) => (
        <span
          key={i}
          className="season-bat"
          style={{ top: f.top, "--dur": f.dur, "--delay": f.delay } as React.CSSProperties}
        >
          <Bat className={cn("w-auto", f.size)} />
        </span>
      ))}
    </div>
  );
}

/**
 * The page-wide part: falling snow, flying bats or drifting petals over the
 * whole page (never in the way of a click), and a button to hide or bring
 * back the decorations in this browser.
 */
export function SeasonalEffects() {
  const { theme, hidden } = useSeasonState();
  const reduced = useReducedMotion();
  if (!theme) return null;
  const Icon = ICONS[theme];
  return (
    <>
      {!hidden && !reduced ? (
        <div aria-hidden data-season-effects={theme} className="pointer-events-none fixed inset-0 z-30">
          {theme === "christmas" ? <Particles kind="snow" density={1} className="h-full w-full" /> : null}
          {theme === "easter" ? <Particles kind="petals" density={0.35} max={60} className="h-full w-full" /> : null}
          {theme === "halloween" ? <Bats /> : null}
        </div>
      ) : null}
      {theme === "halloween" && !hidden && !reduced ? <LightsOut /> : null}
      <button
        type="button"
        onClick={() => setDecorationsHidden(!hidden)}
        aria-pressed={!hidden}
        className="fixed bottom-4 left-4 z-40 inline-flex size-11 items-center justify-center gap-2 rounded-full bg-white/95 text-sm font-bold text-grey-900 shadow-float outline-none ring-1 ring-beige-500/30 hover:bg-white focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-auto sm:px-4 sm:py-2.5"
      >
        <Icon className="size-4" />
        {/* Phones get the icon alone; the words are still there for screen readers. */}
        <span className="sr-only sm:not-sr-only">
          {hidden ? `Show ${THEME_INFO[theme].label} decorations` : `Hide ${THEME_INFO[theme].label} decorations`}
        </span>
      </button>
    </>
  );
}

/** Next to the wordmark in the header. */
export function SeasonalHeaderDecor() {
  const theme = useSeason();
  if (!theme) return null;
  return (
    <span aria-hidden data-season-decor={theme} className="flex items-center">
      {theme === "christmas" ? <CandyCanePair className="h-9 w-auto" /> : null}
      {theme === "halloween" ? <Lantern className="relative h-7 w-auto" /> : null}
      {theme === "easter" ? (
        <>
          <EasterEgg id="hdr-a" base="#f6b8c8" band="#e0789a" className="h-7 w-auto -rotate-12" />
          <EasterEgg id="hdr-b" base="#b9e3b5" band="#5ea75a" className="-ml-1 h-6 w-auto rotate-12" />
        </>
      ) : null}
    </span>
  );
}

/** Inside a dot-grid "board" (the hero): pieces hung from its top edge and set in its bottom corner. */
export function SeasonalBoardDecor() {
  const theme = useSeason();
  const reduced = useReducedMotion();
  if (!theme) return null;
  return (
    <div aria-hidden data-season-decor={theme} className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      {theme === "christmas" ? (
        <>
          <CandyCane className="absolute top-3 right-[8%] h-20 w-auto rotate-[8deg]" />
          <CandyCane className="absolute top-5 right-[calc(8%+38px)] h-14 w-auto -rotate-[6deg]" />
          <CandyCanePair className="absolute bottom-5 left-5 hidden h-24 w-auto lg:block" />
        </>
      ) : null}
      {theme === "halloween" ? (
        <>
          <div className={cn("absolute top-0 right-[10%] flex flex-col items-center", !reduced && "season-bob")}>
            <span className="h-16 w-px bg-grey-500/70" />
            <Spider className="h-8 w-auto" />
          </div>
          <Lantern className="absolute bottom-5 left-5 hidden h-16 w-auto lg:block" />
          <Lantern className="absolute bottom-5 left-[100px] hidden h-11 w-auto lg:block" />
        </>
      ) : null}
      {theme === "easter" ? (
        <>
          <EggNest className="absolute bottom-4 left-4 hidden h-20 w-32 lg:block" />
          <EasterEgg id="board-top" base="#d3c0f0" band="#9a7fd0" className="absolute top-6 right-[9%] h-12 w-auto rotate-[18deg]" />
        </>
      ) : null}
    </div>
  );
}

/**
 * A jack-o'-lantern whose light sputters out now and then. While the page is
 * dark it blazes, above the darkness (it needs a position: `relative` or
 * `absolute` in its className).
 */
export function Lantern({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const { lit, blaze } = useLanternLit(reduced);
  return <JackOLantern lit={lit} blaze={blaze} className={className} style={blaze ? { zIndex: 36 } : undefined} />;
}

/** Glowing eyes that open in the dark, here and there. */
const EYES = [
  { left: "9%", top: "28%", delay: "0.8s" },
  { left: "86%", top: "46%", delay: "2.1s" },
  { left: "38%", top: "78%", delay: "3.4s" },
  { left: "64%", top: "18%", delay: "1.5s" },
];

/**
 * Now and then the lights go out: the page fades to dark for a few seconds,
 * every jack-o'-lantern blazes, and eyes blink in the dark. Never takes a
 * click, and the "Hide decorations" button stays above it.
 */
function LightsOut() {
  useLightsOutSchedule(true);
  const dark = useLightsOut();
  return (
    <div
      aria-hidden
      data-lights-out-overlay={dark ? "dark" : "light"}
      className={cn(
        "pointer-events-none fixed inset-0 z-[35] bg-[radial-gradient(ellipse_at_50%_30%,rgba(28,18,44,0.86),rgba(8,5,14,0.94))] transition-opacity",
        dark ? "opacity-100 duration-[1400ms]" : "opacity-0 duration-[900ms]",
      )}
    >
      {dark
        ? EYES.map((e, i) => (
            <span key={i} className="season-eyes absolute flex gap-2" style={{ left: e.left, top: e.top, animationDelay: e.delay }}>
              <span className="h-2.5 w-4 rounded-[50%] bg-[#c6f25c] shadow-[0_0_10px_#c6f25c]" />
              <span className="h-2.5 w-4 rounded-[50%] bg-[#c6f25c] shadow-[0_0_10px_#c6f25c]" />
            </span>
          ))
        : null}
    </div>
  );
}
