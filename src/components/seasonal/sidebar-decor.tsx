"use client";

import type { Theme } from "@/lib/seasons";
import { CandyCanePair, EasterEgg, JackOLantern } from "./art";
import { Particles } from "./particles";
import { useReducedMotion } from "./season-context";
import { Bats } from "./site-decor";

/**
 * The menu's seasonal layer: a piece of art by the wordmark, and snow, bats
 * or petals inside the dark sidebar (on wider screens, where it's a
 * sidebar; on phones it's a bottom bar and only the active tab's striped
 * edge shows, from globals.css). `motion` is off in the editor, so nothing
 * moves next to the drawing.
 */
export function SidebarSeason({ theme, motion }: { theme: Theme; motion: boolean }) {
  const reduced = useReducedMotion();
  const moving = motion && !reduced;
  return (
    <div
      aria-hidden
      data-season-decor={theme}
      className="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-[inherit] md:block"
    >
      <span className="absolute top-7 right-5 group-data-[collapsed=true]/sidebar:hidden short:top-4">
        {theme === "christmas" ? <CandyCanePair className="h-12 w-auto" /> : null}
        {theme === "halloween" ? <JackOLantern className="h-9 w-auto" /> : null}
        {theme === "easter" ? (
          <span className="flex items-end">
            <EasterEgg id="side-a" base="#fbe29a" band="#e3b43c" className="h-9 w-auto -rotate-12" />
            <EasterEgg id="side-b" base="#a9d4f2" band="#5f9fd0" className="-ml-1.5 h-7 w-auto rotate-12" />
          </span>
        ) : null}
      </span>
      {moving && theme === "christmas" ? <Particles kind="snow" density={1.4} max={45} className="h-full w-full opacity-80" /> : null}
      {moving && theme === "easter" ? <Particles kind="petals" density={0.4} max={14} className="h-full w-full" /> : null}
      {moving && theme === "halloween" ? <Bats count={2} className="[&_svg_path]:fill-grey-300/80" /> : null}
    </div>
  );
}
