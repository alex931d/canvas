import type { Rect } from "@/lib/canvas/geometry";
import type { ElementEffects } from "@/lib/canvas/effects";
import { drawElement, drawElementFx, drawScene, type RenderEnv } from "@/lib/canvas/render";
import type { CanvasElement } from "@/lib/canvas/schema";
import type { Camera } from "./camera";
import { drawOverlays, PeerCursors, type OverlayInput } from "./overlays";

/** Everything one painted frame needs, read fresh from the board each time. */
export type PaintFrame = {
  canvas: HTMLCanvasElement;
  /** The board's wrapper, whose CSS background is the dot grid. */
  wrap: HTMLElement;
  cam: Camera;
  background: string;
  env: RenderEnv;
  /** Elements as shown (moves and resizes in progress applied). */
  elements: readonly CanvasElement[];
  /** Not drawn: erased as the eraser passes, or being edited in a text box. */
  skip: ReadonlySet<string>;
  /** A stroke or shape being drawn here (a copy; see DraftSession.snapshot). */
  draft: CanvasElement | null;
  /** Strokes and shapes other people are drawing right now. */
  peerDrafts: readonly CanvasElement[];
  fx: ElementEffects | null;
  overlay: Omit<OverlayInput, "px" | "cursors">;
};

/**
 * Paints the board: the dot grid, the drawing, and the overlays on top, at
 * most once per animation frame however often it's asked. While a stroke is
 * being drawn, nothing else changes, so it keeps a picture of the scene and
 * only draws the stroke over it.
 */
export class BoardPainter {
  private raf = 0;
  private scene: HTMLCanvasElement | null = null;
  /** Painting the picture of the scene: nothing in progress goes in it. */
  private capturing = false;
  readonly cursors = new PeerCursors();

  private source: (() => PaintFrame | null) | null = null;

  /** Where each frame's state comes from: the board, after it renders. */
  connect(source: () => PaintFrame | null) {
    this.source = source;
  }

  private read() {
    return this.source?.() ?? null;
  }

  /** Paint on the next animation frame. */
  schedule = () => {
    if (!this.raf) this.raf = requestAnimationFrame(this.paint);
  };

  /** Paint now (sizes changed, or a picture of the scene is about to be taken). */
  paint = () => {
    this.raf = 0;
    const f = this.read();
    if (!f) return;
    const { canvas, cam: c } = f;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Dot grid that moves and scales with the camera.
    let gap = 24 * c.z;
    while (gap < 12) gap *= 4;
    f.wrap.style.backgroundColor = f.background;
    f.wrap.style.backgroundSize = `${gap}px ${gap}px`;
    f.wrap.style.backgroundPosition = `${-c.x * c.z}px ${-c.y * c.z}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const world = () => ctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);

    if (f.draft && this.scene) {
      // While drawing, the committed scene doesn't change: reuse the picture of it.
      ctx.drawImage(this.scene, 0, 0);
      world();
    } else {
      world();
      const view: Rect = { x: c.x, y: c.y, w: w / c.z, h: h / c.z };
      const fx = f.fx;
      drawScene(ctx, f.elements as CanvasElement[], f.env, view, f.skip, fx?.enabled ? fx.stateOf : undefined);
      // Things that left the drawing, still on their way out.
      if (fx) for (const g of fx.ghosts()) drawElementFx(ctx, g.el, f.env, g.state);
    }
    if (this.capturing) return;
    for (const d of f.peerDrafts) drawElement(ctx, d, f.env);
    if (f.draft) drawElement(ctx, f.draft, f.env);

    const cursors = this.cursors.step(f.overlay.peers, c.z);
    drawOverlays(ctx, { ...f.overlay, px: 1 / c.z, cursors });
  };

  /**
   * Keep a picture of the scene as it is, to draw a stroke over until it
   * ends (`release`). `settle` runs first, to finish any effects in flight.
   */
  hold(settle: () => void) {
    const f = this.read();
    if (!f) return;
    settle();
    this.capturing = true;
    try {
      this.paint();
    } finally {
      this.capturing = false;
    }
    const copy = document.createElement("canvas");
    copy.width = f.canvas.width;
    copy.height = f.canvas.height;
    copy.getContext("2d")!.drawImage(f.canvas, 0, 0);
    this.scene = copy;
    this.paint(); // and with what's in progress back on top
  }

  release() {
    this.scene = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.scene = null;
  }
}
