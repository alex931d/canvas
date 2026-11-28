"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/*
 * Halloween's lights: every jack-o'-lantern flickers and goes out now and
 * then on its own, and every minute or two the whole page goes dark for a
 * few seconds while all of them blaze. Only on the public pages, never with
 * reduced motion, and never while decorations are hidden (the components
 * that start it aren't rendered then).
 */

let dark = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function setDark(next: boolean) {
  if (dark === next) return;
  dark = next;
  if (next) document.documentElement.dataset.lightsOut = "";
  else delete document.documentElement.dataset.lightsOut;
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** True while the page is dark and the lanterns blaze. */
export function useLightsOut(): boolean {
  return useSyncExternalStore(subscribe, () => dark, () => false);
}

/** Dispatch this on window to turn the lights out now (the tests do; so could a lantern click). */
export const LIGHTS_OUT_EVENT = "canvas:lights-out";

const DARK_MS = 7000;
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Runs the lights-out schedule while mounted: the first after 15–25 seconds,
 * then every 60–120 seconds, each lasting 7 seconds. Not while the tab is
 * hidden, so nobody comes back to a dark page.
 */
export function useLightsOutSchedule(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let next: ReturnType<typeof setTimeout>;
    let end: ReturnType<typeof setTimeout>;
    const goDark = () => {
      clearTimeout(next);
      clearTimeout(end);
      if (document.visibilityState === "visible") {
        setDark(true);
        end = setTimeout(() => setDark(false), DARK_MS);
      }
      next = setTimeout(goDark, DARK_MS + between(60_000, 120_000));
    };
    next = setTimeout(goDark, between(15_000, 25_000));
    window.addEventListener(LIGHTS_OUT_EVENT, goDark);
    return () => {
      clearTimeout(next);
      clearTimeout(end);
      window.removeEventListener(LIGHTS_OUT_EVENT, goDark);
      setDark(false);
    };
  }, [active]);
}

/**
 * One lantern's light: on most of the time, but every few seconds it may
 * sputter (off, on, off) and stay out for a moment before catching again.
 * Always on while the page is dark. With `still`, steadily on.
 */
export function useLanternLit(still: boolean): { lit: boolean; blaze: boolean } {
  const blaze = useLightsOut();
  const [lit, setLit] = useState(true);
  useEffect(() => {
    if (still) return;
    let timer: ReturnType<typeof setTimeout>;
    const steps: [boolean, number][] = [];
    const run = () => {
      const step = steps.shift();
      if (step) {
        setLit(step[0]);
        timer = setTimeout(run, step[1]);
        return;
      }
      setLit(true);
      if (Math.random() < 0.45) {
        // A sputter: a quick flicker, then out for a moment.
        steps.push([false, 110], [true, 90], [false, between(700, 2600)], [true, 120], [false, 80]);
      }
      timer = setTimeout(run, between(3000, 9000));
    };
    timer = setTimeout(run, between(1500, 6000));
    return () => clearTimeout(timer);
  }, [still]);
  return { lit: still || blaze || lit, blaze };
}
