import type { Rect } from "./geometry";

/*
 * The arithmetic of presenting frames (src/components/editor/presenter.tsx):
 * where a slide sits on the screen, and the camera path of the "journey"
 * style, which flies across the canvas from one frame to the next.
 */

export type Size = { w: number; h: number };

/** A view of the canvas: the world point at the screen's centre, and screen pixels per world unit. */
export type Camera = { cx: number; cy: number; scale: number };

/** The gap around a slide, in screen pixels: a little room so it reads as a slide, not a crop. */
export function slideMargin(screen: Size) {
  return Math.round(Math.min(screen.w, screen.h) * 0.035);
}

/** The camera that shows a frame as large as fits on the screen, centred, with a margin all round. */
export function cameraFor(frame: Rect, screen: Size, margin = slideMargin(screen)): Camera {
  const aw = Math.max(1, screen.w - margin * 2);
  const ah = Math.max(1, screen.h - margin * 2);
  return {
    cx: frame.x + frame.w / 2,
    cy: frame.y + frame.h / 2,
    scale: Math.min(aw / Math.max(frame.w, 1e-6), ah / Math.max(frame.h, 1e-6)),
  };
}

/** Where a world rectangle lands on the screen through a camera. */
export function project(r: Rect, cam: Camera, screen: Size): Rect {
  return {
    x: screen.w / 2 + (r.x - cam.cx) * cam.scale,
    y: screen.h / 2 + (r.y - cam.cy) * cam.scale,
    w: r.w * cam.scale,
    h: r.h * cam.scale,
  };
}

/** Where a slide sits on the screen. */
export function slideRect(frame: Rect, screen: Size, margin = slideMargin(screen)): Rect {
  return project(frame, cameraFor(frame, screen, margin), screen);
}

const RHO = Math.SQRT2;

/**
 * A smooth zoom-and-pan from one camera to another (van Wijk and Nuij,
 * "Smooth and efficient zooming and panning", 2003): far-apart frames pull
 * back to show both on the way, near ones just glide. `at(0)` is `from`,
 * `at(1)` is `to`; `duration` grows with the distance travelled, in ms.
 */
export function flight(from: Camera, to: Camera, screen: Size) {
  // Work in "how much of the world the screen's width shows".
  const w0 = screen.w / from.scale;
  const w1 = screen.w / to.scale;
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const d2 = dx * dx + dy * dy;
  let S: number;
  let at: (t: number) => Camera;
  if (d2 < 1e-12 || !Number.isFinite(d2)) {
    S = Math.log(w1 / w0) / RHO;
    at = (t) => {
      const w = w0 * Math.exp(RHO * t * S);
      return { cx: from.cx + t * dx, cy: from.cy + t * dy, scale: screen.w / w };
    };
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / RHO;
    at = (t) => {
      if (t >= 1) return to;
      const s = t * S;
      const u = (w0 / (RHO ** 2 * d1)) * (Math.cosh(r0) * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      const w = (w0 * Math.cosh(r0)) / Math.cosh(RHO * s + r0);
      return { cx: from.cx + u * dx, cy: from.cy + u * dy, scale: screen.w / w };
    };
  }
  const duration = Math.min(1800, Math.max(650, Math.abs(S) * 900));
  return { duration, at: (t: number) => (t <= 0 ? from : at(Math.min(1, t))) };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

/**
 * How much of the stage covers the canvas around the frame during a journey:
 * all of it while resting on a slide, nearly none mid-flight so you see where
 * you're going.
 */
export function journeyVeil(t: number) {
  return 1 - Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.6 * 0.9;
}

/** Fractional slide orders after moving one slide from `from` to `to` (the rest keep their order): 1, 2, 3… */
export function reorderSlides<T extends { id: string; order: number }>(slides: readonly T[], from: number, to: number) {
  const next = slides.slice();
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next.flatMap((s, i) => (s.order === i + 1 ? [] : [{ ...s, order: i + 1 }]));
}
