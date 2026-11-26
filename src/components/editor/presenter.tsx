"use client";

import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { elementBox, slidesOf } from "@/lib/canvas/geometry";
import {
  cameraFor,
  easeInOut,
  flight,
  journeyVeil,
  lerpRect,
  project,
  slideRect,
  type Size,
} from "@/lib/canvas/present";
import { drawScene, renderRegion, type RenderEnv } from "@/lib/canvas/render";
import type { CanvasElement, FrameElement, Presentation } from "@/lib/canvas/schema";
import { cn } from "@/lib/utils";

/** The dark stage around slides: the app's ink colour. */
const DARK_STAGE = "#201f24";
const CHROME_IDLE_MS = 2500;

type Transition = {
  kind: "fade" | "swipe" | "journey";
  from: FrameElement | null;
  to: FrameElement | null;
  /** +1 forwards, -1 back. */
  dir: 1 | -1;
  start: number;
  duration: number;
  fly: ReturnType<typeof flight> | null;
};

type SlideImage = {
  elements: readonly CanvasElement[];
  imageVersion: number;
  key: string;
  canvas: HTMLCanvasElement;
};

/**
 * Full-screen slides from the drawing's frames (Slides panel → Present).
 * Frames themselves never show: each slide is what's inside one frame, on
 * the drawing's background. Edits other people make while you present show
 * up as they happen.
 */
export function Presenter({
  elements,
  background,
  env,
  imageVersion,
  presentation,
  startId,
  onClose,
}: {
  elements: readonly CanvasElement[];
  background: string;
  /** Pictures, GIFs and videos (no frame outlines). */
  env: RenderEnv;
  imageVersion: number;
  presentation: Presentation;
  /** Start on this frame (default: the first). */
  startId: string | null;
  /** Leaving: the frame on screen last, to show on the canvas. */
  onClose: (lastId: string | null) => void;
}) {
  const slides = useMemo(() => slidesOf(elements), [elements]);

  // Where we are: by frame, so reordering or adding slides mid-show doesn't jump. `index` covers deleted frames.
  const [pos, setPos] = useState(() => {
    const i = Math.max(0, slides.findIndex((s) => s.id === startId));
    return { id: slides[i]?.id ?? null, index: i };
  });
  const found = pos.id ? slides.findIndex((s) => s.id === pos.id) : -1;
  const index = found >= 0 ? found : Math.min(pos.index, slides.length);
  const atEnd = index >= slides.length;
  const current = slides[index] ?? null;

  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const rafRef = useRef(0);
  const transitionRef = useRef<Transition | null>(null);
  const cacheRef = useRef(new Map<string, SlideImage>());
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressRef = useRef<{ x: number; y: number; type: string } | null>(null);

  const latest = useRef({ elements, background, env, imageVersion, presentation, current, slides, index });
  useLayoutEffect(() => {
    latest.current = { elements, background, env, imageVersion, presentation, current, slides, index };
  });

  // ------------------------------------------------------------ drawing

  const stageColor = () => (latest.current.presentation.stage === "dark" ? DARK_STAGE : latest.current.background);

  /** What's inside a frame at the size it takes on screen (cached until something changes). */
  const slideImage = (frame: FrameElement): HTMLCanvasElement | null => {
    const { elements, background, env, imageVersion } = latest.current;
    const size = sizeRef.current;
    if (!size.w || !size.h) return null;
    const dpr = window.devicePixelRatio || 1;
    const r = slideRect(elementBox(frame), size);
    const pw = Math.max(1, Math.round(r.w * dpr));
    const key = `${frame.x},${frame.y},${frame.w},${frame.h}@${pw}`;
    const hit = cacheRef.current.get(frame.id);
    if (hit && hit.elements === elements && hit.imageVersion === imageVersion && hit.key === key) return hit.canvas;
    const canvas = renderRegion({ elements, background, region: elementBox(frame), scale: pw / frame.w, env });
    cacheRef.current.set(frame.id, { elements, imageVersion, key, canvas });
    return canvas;
  };

  const drawSlide = (ctx: CanvasRenderingContext2D, frame: FrameElement | null, dx: number, alpha: number) => {
    if (!frame || alpha <= 0) return;
    const img = slideImage(frame);
    if (!img) return;
    const dpr = window.devicePixelRatio || 1;
    const r = slideRect(elementBox(frame), sizeRef.current);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, Math.round((r.x + dx) * dpr), Math.round(r.y * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr));
    ctx.globalAlpha = 1;
  };

  /** Mid-journey: the whole canvas through the flying camera, the stage veiling all but the frame. */
  const drawJourney = (ctx: CanvasRenderingContext2D, tr: Transition, e: number) => {
    const { elements, background, env } = latest.current;
    const size = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cam = tr.fly!.at(e);
    const canvas = ctx.canvas;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ink on its own layer so pixel erasers only take ink away.
    const layer = (layerRef.current ??= document.createElement("canvas"));
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    }
    const lctx = layer.getContext("2d")!;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    const s = cam.scale;
    lctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (size.w / 2 - cam.cx * s), dpr * (size.h / 2 - cam.cy * s));
    const view = { x: cam.cx - size.w / 2 / s, y: cam.cy - size.h / 2 / s, w: size.w / s, h: size.h / s };
    drawScene(lctx, elements, env, view);
    ctx.drawImage(layer, 0, 0);

    const win = project(lerpRect(elementBox(tr.from!), elementBox(tr.to!), e), cam, size);
    ctx.globalAlpha = journeyVeil(e);
    ctx.fillStyle = stageColor();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(win.x * dpr, win.y * dpr, win.w * dpr, win.h * dpr);
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
  };

  /** One picture of the show at `now`. True while a transition still has frames to go. */
  const draw = (now: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !sizeRef.current.w) return false;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = stageColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tr = transitionRef.current;
    const t = tr ? Math.min(1, (now - tr.start) / tr.duration) : 1;
    if (!tr || t >= 1) {
      transitionRef.current = null;
      drawSlide(ctx, latest.current.current, 0, 1);
      return false;
    }
    const e = easeInOut(t);
    const w = sizeRef.current.w;
    if (tr.kind === "journey") drawJourney(ctx, tr, e);
    else if (tr.kind === "swipe") {
      drawSlide(ctx, tr.from, -tr.dir * e * w, 1);
      drawSlide(ctx, tr.to, tr.dir * (1 - e) * w, 1);
    } else {
      drawSlide(ctx, tr.from, 0, 1 - e);
      drawSlide(ctx, tr.to, 0, e);
    }
    return true;
  };

  const loop = (now: number) => {
    rafRef.current = 0;
    if (draw(now)) rafRef.current = requestAnimationFrame(loop);
    else warmNeighbours();
  };
  const schedule = () => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  };

  /** Render the slides either side ahead of time, so moving on starts straight away. */
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmNeighbours = () => {
    if (warmTimer.current) clearTimeout(warmTimer.current);
    warmTimer.current = setTimeout(() => {
      const { slides, index } = latest.current;
      for (const f of [slides[index + 1], slides[index - 1]]) if (f) slideImage(f);
    }, 120);
  };

  // Redraw when the drawing, the slide or the settings change.
  useEffect(() => {
    schedule();
    // schedule reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, imageVersion, presentation, index, current]);

  // Size the canvas to the screen.
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = root.clientWidth;
      const h = root.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      schedule();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (warmTimer.current) clearTimeout(warmTimer.current);
    };
    // schedule reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ moving

  const go = (to: number) => {
    const { slides, index, current, presentation } = latest.current;
    const target = Math.max(0, Math.min(slides.length, to));
    if (target === index) return;
    const next = slides[target] ?? null;
    const size = sizeRef.current;
    // Asked when moving, so a change to the setting applies straight away.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && size.w) {
      const style = presentation.style;
      const fly =
        style === "journey" && current && next
          ? flight(cameraFor(elementBox(current), size), cameraFor(elementBox(next), size), size)
          : null;
      transitionRef.current = {
        kind: fly ? "journey" : style === "swipe" ? "swipe" : "fade",
        from: current,
        to: next,
        dir: target > index ? 1 : -1,
        start: performance.now(),
        duration: fly ? fly.duration : style === "swipe" ? 520 : 420,
        fly,
      };
    } else {
      transitionRef.current = null;
    }
    setPos({ id: next?.id ?? null, index: target });
    schedule();
  };

  const close = () => onClose(latest.current.current?.id ?? latest.current.slides.at(-1)?.id ?? null);

  const showChrome = () => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), CHROME_IDLE_MS);
  };
  useEffect(() => {
    // The controls show to begin with, then tuck away until the pointer moves.
    chromeTimer.current = setTimeout(() => setChrome(false), CHROME_IDLE_MS);
    return () => {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    };
  }, []);

  // Full screen where the browser allows it; leaving full screen leaves the show.
  const ownsFullscreen = useRef(false);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      /* not allowed here: the show still fills the window */
    }
  };
  // Keys, before the board or the editor see them.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const onButton = (e.target as HTMLElement | null)?.closest?.("button");
    if ((e.key === "Enter" || e.key === " ") && onButton) return; // let the focused button work
    const i = latest.current.index;
    let handled = true;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
      case "Enter":
      case "n":
        go(i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
      case "p":
        go(i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(Math.max(0, latest.current.slides.length - 1));
        break;
      case "Escape":
        close();
        break;
      case "f":
        void toggleFullscreen();
        break;
      default:
        handled = false;
    }
    e.stopPropagation();
    if (handled) e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const onFullscreenChange = useEffectEvent(() => {
    const on = document.fullscreenElement === rootRef.current;
    setFullscreen(on);
    if (on) ownsFullscreen.current = true;
    else if (ownsFullscreen.current) {
      ownsFullscreen.current = false;
      close();
    }
  });
  useEffect(() => {
    const root = rootRef.current;
    const handler = () => onFullscreenChange();
    document.addEventListener("fullscreenchange", handler);
    root?.focus();
    root?.requestFullscreen?.().catch(() => {});
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      ownsFullscreen.current = false;
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  // ------------------------------------------------------------ view

  const dark = presentation.stage === "dark";
  const quiet = dark ? "text-white/65" : "text-grey-500";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Presenting"
      tabIndex={-1}
      data-testid="presenter"
      data-slide={atEnd ? "end" : String(index + 1)}
      data-transition={presentation.style}
      className={cn("fixed inset-0 z-[60] touch-none overflow-hidden outline-none select-none", !chrome && "cursor-none")}
      style={{ background: dark ? DARK_STAGE : background }}
      onPointerMove={showChrome}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        pressRef.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
      }}
      onPointerUp={(e) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!press) return;
        const dx = e.clientX - press.x;
        const dy = e.clientY - press.y;
        const i = latest.current.index;
        const w = sizeRef.current.w;
        if (press.type !== "mouse" && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
          go(dx < 0 ? i + 1 : i - 1); // a swipe
        } else if (Math.hypot(dx, dy) < 10) {
          if (press.type === "mouse") {
            // A click: the left edge goes back, anywhere else moves on.
            go(e.clientX < w * 0.25 ? i - 1 : i + 1);
          } else if (e.clientX < w * 0.2) go(i - 1);
          else if (e.clientX > w * 0.8) go(i + 1);
          // A tap in the middle brings the controls back (or tucks them away).
          else if (chrome) setChrome(false);
          else showChrome();
        }
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" data-testid="presenter-canvas" />

      <p className="sr-only" aria-live="polite">
        {atEnd
          ? "End of the slides. Press Escape to go back to the canvas."
          : `Slide ${index + 1} of ${slides.length}${current ? `: ${current.title}` : ""}`}
      </p>

      {atEnd ? (
        <div className={cn("absolute inset-0 grid place-content-center gap-2 text-center", quiet)}>
          <p className={cn("text-2xl font-semibold", dark ? "text-white/85" : "text-grey-900")}>
            {slides.length ? "End of the slides" : "There are no slides yet"}
          </p>
          <p className="text-sm">
            {slides.length
              ? "Press Esc to go back to the canvas, or ← to look again."
              : "Draw a frame (F) around what you want to show, then present again."}
          </p>
        </div>
      ) : null}

      {/* The controls show the count too: the corner one is for while they're hidden. */}
      {presentation.numbers && !atEnd && slides.length && !chrome ? (
        <p
          data-testid="presenter-count"
          className={cn("pointer-events-none absolute right-5 bottom-4 text-sm font-semibold tabular-nums", quiet)}
        >
          {index + 1} / {slides.length}
        </p>
      ) : null}

      <div
        className={cn(
          "absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-grey-900/85 p-1.5 text-white shadow-float transition-opacity duration-300",
          chrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onFocusCapture={showChrome}
      >
        <ChromeButton label="Previous slide" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft />
        </ChromeButton>
        <span className="min-w-14 px-1 text-center text-sm font-semibold tabular-nums">
          {atEnd ? "End" : `${index + 1} / ${slides.length}`}
        </span>
        <ChromeButton label="Next slide" disabled={atEnd} onClick={() => go(index + 1)}>
          <ChevronRight />
        </ChromeButton>
        <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
        <ChromeButton label={fullscreen ? "Leave full screen (F)" : "Full screen (F)"} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize /> : <Maximize />}
        </ChromeButton>
        <ChromeButton label="Stop presenting (Esc)" onClick={close} testId="presenter-exit">
          <X />
        </ChromeButton>
      </div>
    </div>
  );
}

function ChromeButton({
  label,
  disabled,
  onClick,
  testId,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35 [&_svg]:size-4.5"
    >
      {children}
    </button>
  );
}
