"use client";

import { useSyncExternalStore } from "react";
import { isThemeMode, resolveTheme, type Theme, type ThemeMode } from "@/lib/seasons";

/*
 * Which seasonal theme to show. The mode (the admin's setting) comes from
 * GET /api/site/theme, once per page load and cached by the browser for a
 * minute; "auto" is then resolved here, with this browser's date and time
 * zone. Nothing seasonal renders on the server, so pages stay prerendered,
 * the decorations simply appear once the page is running, and someone who
 * has hidden them never sees them flash.
 */

let mode: ThemeMode | null = null; // unknown until loaded
let loading: Promise<void> | null = null;
const modeListeners = new Set<() => void>();

function loadMode(reload = false) {
  if (loading && !reload) return loading;
  loading = fetch("/api/site/theme", reload ? { cache: "reload" } : undefined)
    .then((res) => res.json())
    .then((data: { mode?: unknown }) => {
      mode = isThemeMode(data.mode) ? data.mode : "auto";
    })
    .catch(() => {
      mode ??= "auto"; // can't reach the server: the calendar decides
    })
    .finally(() => modeListeners.forEach((l) => l()));
  return loading;
}

/** After an admin saves a new mode: fetch it again, past the browser's cache. */
export function refreshSeasonalMode() {
  return loadMode(true);
}

const PREF_KEY = "canvas-seasonal";
const PREF_EVENT = "canvas-seasonal-change";

function subscribeToPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREF_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREF_EVENT, onChange);
  };
}

function readHidden() {
  try {
    return localStorage.getItem(PREF_KEY) === "off";
  } catch {
    return false;
  }
}

/** Hide (or bring back) the decorations in this browser. */
export function setDecorationsHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(PREF_KEY, "off");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* storage unavailable: it only lasts this page */
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

/** The mode, and the calendar every so often, so a page left open still turns over at midnight. */
function subscribeToTheme(onChange: () => void) {
  modeListeners.add(onChange);
  void loadMode();
  const timer = setInterval(onChange, 15 * 60_000);
  return () => {
    modeListeners.delete(onChange);
    clearInterval(timer);
  };
}

const currentTheme = () => (mode ? resolveTheme(mode, new Date()) : null);

/** The theme this browser would show, and whether its person has hidden decorations. */
export function useSeasonState(): { theme: Theme | null; hidden: boolean } {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => null);
  const hidden = useSyncExternalStore(subscribeToPreference, readHidden, () => false);
  return { theme, hidden };
}

/** The theme to decorate with right now, or null. */
export function useSeason(): Theme | null {
  const { theme, hidden } = useSeasonState();
  return hidden ? null : theme;
}

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the visitor has asked their system for less motion: decorations stay, nothing moves. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeToMotion, () => window.matchMedia(REDUCED).matches, () => false);
}
