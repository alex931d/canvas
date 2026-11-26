import { elementBounds, padRect, polygonBounds, unionRects, type Point, type Rect } from "@/lib/canvas/geometry";
import { renderRegion, type RenderEnv } from "@/lib/canvas/render";
import type { CanvasElement, TextElement } from "@/lib/canvas/schema";
import type { MathCheck } from "@/lib/ai/math-check-schema";
import { clamp, newId, round1 } from "./util";

/*
 * Pictures of part of the board: for Check math (sent to the model) and for
 * flashcards, plus the note Check math leaves beside what it checked.
 */

/** What to picture for a selection: everything inside a lasso loop, or only the selected things. */
export function selectionScene(
  elements: readonly CanvasElement[],
  selected: readonly string[],
  lasso: Point[] | null,
): { scene: readonly CanvasElement[]; chosen: CanvasElement[]; region: Rect; polygon?: Point[] } | null {
  const set = new Set(selected);
  const chosen = elements.filter((el) => set.has(el.id));
  if (lasso && lasso.length > 2) {
    const b = polygonBounds(lasso);
    return b ? { scene: elements, chosen, region: padRect(b, 8), polygon: lasso } : null;
  }
  const box = unionRects(chosen.map(elementBounds));
  return box ? { scene: chosen, chosen, region: padRect(box, 16) } : null;
}

/** A region as a PNG data URL about 1,400 px across for Check math (JPEG if the PNG is huge). */
export function mathCheckImage(
  elements: readonly CanvasElement[],
  background: string,
  region: Rect,
  polygon: Point[] | null,
  env: RenderEnv,
): string {
  const scale = clamp(1400 / Math.max(region.w, region.h, 1), 0.5, 4);
  const canvas = renderRegion({
    elements,
    background,
    region,
    scale,
    env,
    clip: polygon ?? undefined,
  });
  const png = canvas.toDataURL("image/png");
  return png.length > 4_000_000 ? canvas.toDataURL("image/jpeg", 0.9) : png;
}

/** A picture about 1,200 px across, as WebP (PNG where the browser can't), and its size. */
export async function regionBlob(
  elements: readonly CanvasElement[],
  background: string,
  region: Rect,
  polygon: Point[] | undefined,
  env: RenderEnv,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const scale = clamp(1200 / Math.max(region.w, region.h, 1), 0.25, 3);
  const canvas = renderRegion({ elements, background, region, scale, env, clip: polygon });
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")));
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}

/** The words in some elements (texts, equations' sources, to-do cards), to prefill a flashcard. */
export function textOf(elements: readonly CanvasElement[]): string {
  return elements
    .flatMap((el) =>
      el.type === "text"
        ? [el.text]
        : el.type === "math"
          ? [el.source]
          : el.type === "kanban"
            ? [el.title, ...el.columns.flatMap((c) => c.cards.map((k) => `${c.title}: ${k.text}`))]
            : [],
    )
    .join("\n")
    .slice(0, 2000);
}

/** Check math's verdict as a handwritten note to the right of what was checked: green when right, red when not. */
export function mathNote(result: MathCheck, region: Rect): TextElement {
  const good = result.verdict === "correct";
  const fontSize = clamp(Math.round(region.h / 5), 20, 64);
  const words = (good ? "✓ Correct" : `✗ ${result.summary || "Check this step"}`).split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 34) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return {
    id: newId(),
    type: "text",
    x: round1(region.x + region.w + 16),
    y: round1(region.y),
    text: lines.join("\n"),
    color: good ? "#277c78" : "#c94736",
    fontSize,
    font: "hand",
  };
}
