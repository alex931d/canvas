import { hitTestAll, insideFrame, pointInRect, slidesOf, type Point, type Rect } from "@/lib/canvas/geometry";
import { frameLabelRect } from "@/lib/canvas/render";
import type { CanvasElement, FrameElement } from "@/lib/canvas/schema";
import { FRAME_ASPECTS, type FrameAspect } from "../tools";
import type { Size } from "./camera";
import { round1 } from "./util";

/*
 * Frames on the board (slides; see src/components/editor/presenter.tsx):
 * grabbed by their title, carrying what's inside them, and where new ones go.
 */

/** A frame whose title is at this point (titles sit above frames, at screen size; `z` is the zoom). */
export function frameTitleAt(elements: readonly CanvasElement[], p: Point, z: number): FrameElement | null {
  const px = 1 / z;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type === "frame" && pointInRect(p, frameLabelRect(el, el.title, px))) return el;
  }
  return null;
}

/** What a select-tool click lands on: a frame's title first, then the topmost thing drawn. */
export function hitForSelect(elements: readonly CanvasElement[], p: Point, z: number, tolerance: number) {
  return frameTitleAt(elements, p, z) ?? hitTestAll(elements, p, tolerance);
}

/** These elements, plus whatever sits wholly inside any frame among them: frames carry their contents. */
export function withFrameContents(elements: readonly CanvasElement[], ids: ReadonlySet<string>): CanvasElement[] {
  const carried = new Set(ids);
  for (const el of elements) {
    if (el.type === "frame" && ids.has(el.id)) for (const c of insideFrame(elements, el)) carried.add(c.id);
  }
  return elements.filter((el) => carried.has(el.id));
}

/**
 * A new frame's box in the given shape: around `content` (padded), or 60% of
 * the view centred on `at`.
 */
export function frameBox(at: Point, content: Rect | null, aspect: FrameAspect, viewport: Size, z: number): Rect {
  const ratio = FRAME_ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;
  let w: number;
  let h: number;
  let cx = at.x;
  let cy = at.y;
  if (content) {
    const pad = Math.max(content.w, content.h) * 0.06 + 16 / z;
    w = content.w + pad * 2;
    h = content.h + pad * 2;
    cx = content.x + content.w / 2;
    cy = content.y + content.h / 2;
    if (ratio) {
      if (w / ratio >= h) h = w / ratio;
      else w = h * ratio;
    }
  } else {
    const r = ratio ?? 16 / 9;
    const vw = Math.max(viewport.w, 320) / z;
    const vh = Math.max(viewport.h, 240) / z;
    w = vw * 0.6;
    h = w / r;
    if (h > vh * 0.6) {
      h = vh * 0.6;
      w = h * r;
    }
  }
  return { x: round1(cx - w / 2), y: round1(cy - h / 2), w: round1(Math.max(1, w)), h: round1(Math.max(1, h)) };
}

/** A new frame's title and place in the slide order: after the last slide. */
export function nextSlide(elements: readonly CanvasElement[]): Pick<FrameElement, "title" | "order"> {
  const slides = slidesOf(elements);
  return {
    title: `Slide ${slides.length + 1}`,
    order: slides.length ? Math.floor(slides[slides.length - 1].order) + 1 : 1,
  };
}
