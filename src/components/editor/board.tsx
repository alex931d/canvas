"use client";

import { Columns3, Copy, GalleryVerticalEnd, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Button, toast } from "@/components/kit";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type Ref,
} from "react";
import {
  contentBounds,
  elementBounds,
  elementBox,
  hitTest,
  hitTestAll,
  insidePolygon,
  measureText,
  padRect,
  polygonBounds,
  rectContainsRect,
  rectFromPoints,
  rectsIntersect,
  resetTextMetrics,
  scaleElement,
  translateElement,
  unionRects,
  type Point,
  type Rect,
} from "@/lib/canvas/geometry";
import { AssetError, fileType, inspectGif, type AssetCache } from "@/lib/canvas/images";
import {
  addColumn,
  dropSlot,
  findCard,
  kanbanLayout,
  kanbanPartAt,
  moveCard,
  newKanban,
  withoutCard,
  type KanbanPart,
} from "@/lib/canvas/kanban";
import { drawCard } from "@/lib/canvas/kanban-render";
import { useReducedMotion } from "motion/react";
import { ElementEffects } from "@/lib/canvas/effects";
import { KanbanEffects } from "@/lib/canvas/kanban-fx";
import { drawElement, drawElementFx, drawScene, renderRegion, type RenderEnv } from "@/lib/canvas/render";
import {
  FONT_FAMILIES,
  TEXT_LINE_HEIGHT,
  isVideoType,
  type AssetElement,
  type CanvasElement,
  type GraphElement,
  type KanbanElement,
  type MathElement,
  type TextElement,
} from "@/lib/canvas/schema";
import type { MathCheck } from "@/lib/ai/math-check-schema";
import type { HistoryAction } from "@/lib/collab/doc";
import type { Peer } from "@/lib/collab/peers";
import { subscribeMath, texSource, typesetMath } from "@/lib/math/layout";
import type { DrawEffect } from "@/lib/preferences";
import { EquationEditor, type EquationValue } from "./equation-editor";
import { GRAPH_COLORS, GraphEditor } from "./graph-editor";
import { KanbanEditor, type KanbanEdit, type KanbanEditorHandle } from "./kanban-editor";
import { MathCard, type MathState } from "./math-card";
import { MediaControls } from "./media-controls";
import { MEDIA_ACCEPT, TOOLS, TRACE_ACTION, VIEW_TOOLS, type Style, type Tool } from "./tools";
import { ZoomControls } from "./zoom-controls";

// ------------------------------------------------------------------ types

/** screen = (world - {x, y}) * z */
export type Camera = { x: number; y: number; z: number };

/** Part of the canvas captured for a flashcard. */
export type FlashcardCapture = {
  blob: Blob;
  width: number;
  height: number;
  /** Text and equation sources in the selection, to prefill the card. */
  text: string;
};

/** Strokes traced from part of a picture (src/lib/canvas/trace.ts), in the traced pixels. */
export type TracedPicture = {
  strokes: { points: number[]; size: number }[];
  /** The traced pixels' size. */
  width: number;
  height: number;
  /** How big that part of the picture is, in the picture's own pixels (sets the size on the board). */
  naturalWidth: number;
  naturalHeight: number;
};

export type BoardHandle = {
  /** Put images, GIFs and videos on the board. */
  insertFiles: (files: File[]) => void;
  /** Put traced strokes in the middle of the view, in the pen colour, selected. Returns how many. */
  insertTraced: (picture: TracedPicture) => number;
  startMathCheck: () => void;
  /** Typeset and place an equation in the middle of the view. */
  insertMath: (value: Pick<MathElement, "syntax" | "source">) => Promise<void>;
};

type Handle = "nw" | "ne" | "sw" | "se";

/** What a click (press and release without dragging) does. */
type ClickAction = { kind: "add-card"; boardId: string; columnId: string } | { kind: "media"; id: string };

/** Where a dragged to-do card would land. */
type CardTarget = { boardId: string; columnId: string; index: number };

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; cam0: Camera }
  | { kind: "pinch"; dist0: number; mid0: Point; cam0: Camera }
  | { kind: "draw"; draft: CanvasElement; origin: Point }
  | { kind: "erase" }
  | { kind: "move"; start: Point; originals: CanvasElement[]; moved: boolean; click: ClickAction | null }
  | {
      kind: "card";
      boardId: string;
      cardId: string;
      start: Point;
      /** Pointer position relative to the card's top-left corner. */
      grab: Point;
      at: Point;
      active: boolean;
      target: CardTarget | null;
    }
  | { kind: "resize"; handle: Handle; box0: Rect; originals: CanvasElement[]; keepAspect: boolean }
  | { kind: "marquee"; start: Point; current: Point; base: string[] }
  | { kind: "lasso"; points: Point[]; checkAfter: boolean };

type TextEdit = {
  id: string;
  existing: TextElement | null;
  x: number;
  y: number;
  text: string;
};

type MathRequest = { region: Rect; polygon: Point[] | null; token: number };

type EquationEdit = { at: Point; existing: MathElement | null };

const MIN_Z = 0.1;
const MAX_Z = 8;
const MAX_STROKE_COORDS = 39_998;
const CLIPBOARD_MARKER = "canvas-elements:v1:";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const randomSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

function isEditableTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true']");
}

// ------------------------------------------------------------------ board

export function Board({
  drawingId,
  elements,
  background,
  dispatch,
  tool,
  setTool,
  style,
  ready,
  images,
  imageVersion,
  onCheckMath,
  readOnly = false,
  drawEffect = "off",
  boardEffects = false,
  peers = [],
  onPointerWorld,
  onSelectionChange,
  onMakeFlashcard,
  onTracePicture,
  ref,
}: {
  drawingId: string;
  elements: CanvasElement[];
  background: string;
  dispatch: Dispatch<HistoryAction>;
  tool: Tool;
  setTool: (t: Tool) => void;
  style: Style;
  ready: boolean;
  images: AssetCache | null;
  imageVersion: number;
  onCheckMath: (imageDataUrl: string) => Promise<MathCheck>;
  /** View-only: select, pan and lasso, nothing that changes the drawing. */
  readOnly?: boolean;
  /** How things arriving on the board animate (settings page); off when the device asks for less motion. */
  drawEffect?: DrawEffect;
  /** To-do board cards glide, pop in and get crossed out as you watch. */
  boardEffects?: boolean;
  /** Other people on this drawing: their cursors and selections are drawn. */
  peers?: Peer[];
  /** Where the pointer is, in world coordinates (null = left the canvas). */
  onPointerWorld?: (p: Point | null) => void;
  onSelectionChange?: (ids: string[]) => void;
  /** Capture the selection as a picture and start a flashcard from it. */
  onMakeFlashcard?: (capture: FlashcardCapture) => void;
  /** Open "Trace a picture" (the U key). */
  onTracePicture?: () => void;
  ref?: Ref<BoardHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cam, setCam] = useState<Camera>({ x: -80, y: -60, z: 1 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [lassoRegion, setLassoRegion] = useState<Point[] | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [editing, setEditing] = useState<TextEdit | null>(null);
  const [math, setMath] = useState<{ req: MathRequest; state: MathState } | null>(null);
  const [equation, setEquation] = useState<EquationEdit | null>(null);
  const [graphEdit, setGraphEdit] = useState<GraphElement | null>(null);
  const [graphPreview, setGraphPreview] = useState<GraphElement | null>(null);
  const [kanbanEdit, setKanbanEdit] = useState<(KanbanEdit & { newCardId: string }) | null>(null);

  // Mutable state read by the render loop and pointer handlers.
  const camRef = useRef(cam);
  const elementsRef = useRef(elements);
  const propsRef = useRef({
    background,
    images,
    tool,
    style,
    selected,
    lassoRegion,
    editingId: null as string | null,
    graphPreview: null as GraphElement | null,
    peers: [] as Peer[],
    readOnly: false,
  });
  /** Where each peer's cursor is drawn, easing toward where it really is. */
  const cursorAnimRef = useRef(new Map<string, Point>());
  const cursorsMovingRef = useRef(false);
  const interRef = useRef<Interaction>({ kind: "none" });
  const overridesRef = useRef<Map<string, CanvasElement> | null>(null);
  const hiddenRef = useRef(new Set<string>());
  const pointersRef = useRef(new Map<number, Point>());
  const sceneCacheRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<Point | null>(null);
  const spaceRef = useRef(false);
  const camReadyRef = useRef(false);
  const rafRef = useRef(0);
  const checkAfterLassoRef = useRef(false);
  const clipboardRef = useRef<CanvasElement[]>([]);
  const mathTokenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kanbanEditorRef = useRef<KanbanEditorHandle>(null);
  /** Drawing and to-do board effects (created before the first paint, below). */
  const fxRef = useRef<ElementEffects | null>(null);
  const kanbanFxRef = useRef<KanbanEffects | null>(null);
  /** Elements as of the last change we compared, to see what arrived and what left. */
  const seenRef = useRef<Map<string, CanvasElement> | null>(null);
  /** Added by drawing or typing here: already on screen, so no entrance. */
  const ownAddsRef = useRef(new Set<string>());
  /** Removed in a way that already showed it going (the eraser, emptying a text). */
  const quietRemovesRef = useRef(new Set<string>());
  const openedRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const effect: DrawEffect = reduceMotion ? "off" : drawEffect;
  const cardEffects = !reduceMotion && boardEffects;

  useLayoutEffect(() => {
    camRef.current = cam;
    elementsRef.current = elements;
    propsRef.current = {
      background,
      images,
      tool,
      style,
      selected,
      lassoRegion,
      editingId: editing?.id ?? null,
      graphPreview,
      peers,
      readOnly,
    };
  });

  const env: RenderEnv = {
    getImage: (id) => propsRef.current.images?.get(id) ?? null,
    getMedia: (el) => propsRef.current.images?.media(el) ?? null,
    // The paint callback keeps the first env, so read the drag as it happens.
    get draggingCardId() {
      const inter = interRef.current;
      return inter.kind === "card" && inter.active ? inter.cardId : null;
    },
    get kanbanFx() {
      return kanbanFxRef.current;
    },
  };

  // ------------------------------------------------------------- helpers

  const screenToWorld = (sx: number, sy: number): Point => {
    const c = camRef.current;
    return { x: c.x + sx / c.z, y: c.y + sy / c.z };
  };
  const worldToScreen = (p: Point): Point => {
    const c = camRef.current;
    return { x: (p.x - c.x) * c.z, y: (p.y - c.y) * c.z };
  };
  const eventPoint = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  /** Elements as currently shown (with in-progress moves/resizes applied). */
  const liveElements = () => {
    const o = overridesRef.current;
    const g = propsRef.current.graphPreview;
    if (!o && !g) return elementsRef.current;
    return elementsRef.current.map((e) => o?.get(e.id) ?? (g && e.id === g.id ? g : e));
  };

  const selectionBox = (ids: readonly string[]): Rect | null => {
    if (ids.length === 0) return null;
    const set = new Set(ids);
    return unionRects(liveElements().filter((e) => set.has(e.id)).map(elementBounds));
  };

  // ------------------------------------------------------------ rendering

  const paint = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const c = camRef.current;
    const p = propsRef.current;
    const inter = interRef.current;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Dot grid that moves and scales with the camera.
    let gap = 24 * c.z;
    while (gap < 12) gap *= 4;
    wrap.style.backgroundColor = p.background;
    wrap.style.backgroundSize = `${gap}px ${gap}px`;
    wrap.style.backgroundPosition = `${-c.x * c.z}px ${-c.y * c.z}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const world = (tctx: CanvasRenderingContext2D) =>
      tctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, -c.x * c.z * dpr, -c.y * c.z * dpr);

    if (inter.kind === "draw" && sceneCacheRef.current) {
      // While drawing, the committed scene doesn't change: reuse a snapshot.
      ctx.drawImage(sceneCacheRef.current, 0, 0);
      world(ctx);
      // The draft is mutated in place while drawing; render a fresh copy so the
      // per-element caches in render.ts never hold a half-finished shape.
      drawElement(ctx, cloneDraft(inter.draft), env);
    } else {
      world(ctx);
      const view = { x: c.x, y: c.y, w: w / c.z, h: h / c.z };
      const hidden = hiddenRef.current;
      const skip = p.editingId ? new Set([...hidden, p.editingId]) : hidden;
      const fx = fxRef.current;
      drawScene(ctx, liveElements(), env, view, skip, fx?.enabled ? fx.stateOf : undefined);
      // Things that left the drawing, still on their way out.
      if (fx) for (const g of fx.ghosts()) drawElementFx(ctx, g.el, env, g.state);
    }

    // ---- overlays (constant screen-space thickness)
    const px = 1 / c.z;
    ctx.save();
    if (p.lassoRegion && p.lassoRegion.length > 2) {
      tracePolygon(ctx, p.lassoRegion);
      ctx.fillStyle = "rgba(39,124,120,0.06)";
      ctx.fill();
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.strokeStyle = "#277c78";
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const box = inter.kind === "lasso" || inter.kind === "marquee" ? null : selectionBox(p.selected);
    if (box) {
      const b = padRect(box, 4 * px);
      ctx.strokeStyle = "#277c78";
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      if (p.selected.length > 1 && !p.lassoRegion) {
        ctx.setLineDash([3 * px, 3 * px]);
        for (const id of p.selected) {
          const el = liveElements().find((e) => e.id === id);
          if (!el) continue;
          const eb = elementBounds(el);
          ctx.strokeRect(eb.x, eb.y, eb.w, eb.h);
        }
        ctx.setLineDash([]);
      }
      const hs = 9 * px;
      ctx.fillStyle = "#ffffff";
      for (const [hx, hy] of corners(b)) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
    }
    if (inter.kind === "card" && inter.active) drawDraggedCard(ctx, inter, elementsRef.current);
    if (inter.kind === "marquee") {
      const r = rectFromPoints(inter.start, inter.current);
      ctx.fillStyle = "rgba(39,124,120,0.08)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#277c78";
      ctx.lineWidth = 1 * px;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (inter.kind === "lasso" && inter.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(inter.points[0].x, inter.points[0].y);
      for (const q of inter.points) ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = "#277c78";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.stroke();
    }
    const hover = hoverRef.current;
    if (p.tool === "eraser" && hover && !spaceRef.current) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, p.style.eraserSize / 2, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = "rgba(32,31,36,0.65)";
      ctx.stroke();
    }

    // Other people: what they have selected, then their cursors on top.
    if (p.peers.length) {
      const byId = new Map(liveElements().map((e) => [e.id, e]));
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      for (const peer of p.peers) {
        const boxes = peer.selection.flatMap((id) => (byId.has(id) ? [elementBounds(byId.get(id)!)] : []));
        const b = unionRects(boxes);
        if (!b) continue;
        const r = padRect(b, 6 * px);
        ctx.strokeStyle = peer.color;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      ctx.setLineDash([]);
      const anim = cursorAnimRef.current;
      let moving = false;
      for (const peer of p.peers) {
        if (!peer.cursor) {
          anim.delete(peer.clientId);
          continue;
        }
        const target = peer.cursor;
        const prev = anim.get(peer.clientId);
        let at = target;
        if (prev) {
          const dx = target.x - prev.x;
          const dy = target.y - prev.y;
          if (Math.hypot(dx, dy) * c.z > 0.5) {
            at = { x: prev.x + dx * 0.35, y: prev.y + dy * 0.35 };
            moving = true;
          }
        }
        anim.set(peer.clientId, at);
        drawPeerCursor(ctx, at, peer.name, peer.color, px);
      }
      cursorsMovingRef.current = moving;
    }
    ctx.restore();
    // env and helpers only read refs, so this callback never needs to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedulePaint = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    schedulePaint();
  }, [elements, cam, selected, lassoRegion, editing, imageVersion, background, tool, style, ready, graphPreview, peers, schedulePaint]);

  // ------------------------------------------------------------ effects

  /** The part of the drawing on screen, in world coordinates. */
  const viewRect = useCallback((): Rect => {
    const c = camRef.current;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    return { x: c.x, y: c.y, w: (canvas?.width ?? 0) / dpr / c.z, h: (canvas?.height ?? 0) / dpr / c.z };
  }, []);

  // Made before the first paint, so a drawing that's opening stays hidden until its replay starts.
  useLayoutEffect(() => {
    const fx = new ElementEffects(effect, schedulePaint);
    const kanban = new KanbanEffects(cardEffects, schedulePaint);
    fxRef.current = fx;
    kanbanFxRef.current = kanban;
    const release = setTimeout(() => fx.release(), 2500);
    return () => {
      clearTimeout(release);
      fx.dispose();
      kanban.dispose();
      fxRef.current = null;
      kanbanFxRef.current = null;
    };
    // Made once per board; setting changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulePaint]);

  useEffect(() => fxRef.current?.setEffect(effect), [effect]);
  useEffect(() => kanbanFxRef.current?.setEnabled(cardEffects), [cardEffects]);

  // The drawing opened: once it's loaded and has a size, replay what's in view.
  useLayoutEffect(() => {
    if (openedRef.current || !ready || viewport.w === 0) return;
    openedRef.current = true;
    fxRef.current?.open(elementsRef.current, viewRect(), camRef.current.z);
  }, [ready, viewport.w, viewRect]);

  // What arrived and what left since last time: they come and go with the effect.
  useLayoutEffect(() => {
    if (!ready) return;
    const next = new Map(elements.map((e) => [e.id, e] as const));
    const prev = seenRef.current;
    seenRef.current = next;
    if (!prev) return;
    const own = ownAddsRef.current;
    const quiet = quietRemovesRef.current;
    const added: CanvasElement[] = [];
    for (const el of elements) if (!prev.has(el.id) && !own.delete(el.id)) added.push(el);
    const removed: CanvasElement[] = [];
    for (const [id, el] of prev) if (!next.has(id) && !quiet.delete(id)) removed.push(el);
    const fx = fxRef.current;
    if (fx?.enabled && (added.length > 0 || removed.length > 0)) {
      const view = viewRect();
      if (added.length) fx.enterMany(added, view, camRef.current.z);
      if (removed.length) fx.leaveMany(removed, view);
    }
    const kanban = kanbanFxRef.current;
    if (kanban) {
      for (const el of elements) {
        const before = prev.get(el.id);
        if (el.type === "kanban" && before?.type === "kanban" && before !== el) kanban.change(before, el);
      }
    }
  }, [elements, ready, viewRect]);

  // Ease other people's cursors toward their latest position.
  useEffect(() => {
    if (!peers.some((p) => p.cursor)) return;
    let raf = 0;
    const tick = () => {
      if (cursorsMovingRef.current) schedulePaint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peers, schedulePaint]);

  // GIFs animate and playing videos show new frames: a light loop while any are on the board.
  const hasMedia = elements.some((e) => e.type === "gif" || e.type === "video");
  useEffect(() => {
    if (!hasMedia || !images) return;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const c = camRef.current;
      const dpr = window.devicePixelRatio || 1;
      const view = { x: c.x, y: c.y, w: canvas.width / dpr / c.z, h: canvas.height / dpr / c.z };
      const visible = new Set<string>();
      const onBoard = new Set<string>();
      for (const el of elementsRef.current) {
        if (el.type !== "gif" && el.type !== "video") continue;
        onBoard.add(el.assetId);
        if (rectsIntersect(elementBounds(el), view)) visible.add(el.assetId);
      }
      if (images.tick(now, visible, onBoard)) schedulePaint();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Nothing left to play (or leaving): stop any sound.
      images.tick(performance.now(), new Set(), new Set());
    };
  }, [hasMedia, images, schedulePaint]);

  // Share this tab's selection with the others.
  useEffect(() => {
    onSelectionChange?.(selected);
  }, [selected, onSelectionChange]);

  // Equations typeset in the background; repaint as each one is ready.
  useEffect(() => subscribeMath(schedulePaint), [schedulePaint]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Re-measure text once web fonts (Caveat, Public Sans) are ready.
  useEffect(() => {
    const onFonts = () => {
      resetTextMetrics();
      schedulePaint();
    };
    void document.fonts?.ready.then(onFonts);
    document.fonts?.addEventListener?.("loadingdone", onFonts);
    return () => document.fonts?.removeEventListener?.("loadingdone", onFonts);
  }, [schedulePaint]);

  // ------------------------------------------------------------- camera

  const cameraKey = `canvas-camera:${drawingId}`;

  const applyCam = useCallback(
    (next: Camera) => {
      const c = { x: next.x, y: next.y, z: clamp(next.z, MIN_Z, MAX_Z) };
      camRef.current = c;
      setCam(c);
      schedulePaint();
    },
    [schedulePaint],
  );

  const zoomAt = useCallback(
    (sx: number, sy: number, z: number) => {
      const c = camRef.current;
      const nz = clamp(z, MIN_Z, MAX_Z);
      const wx = c.x + sx / c.z;
      const wy = c.y + sy / c.z;
      applyCam({ x: wx - sx / nz, y: wy - sy / nz, z: nz });
    },
    [applyCam],
  );

  const zoomToRect = useCallback(
    (r: Rect | null, maxZ = 1) => {
      const canvas = canvasRef.current;
      if (!canvas || !r) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const z = clamp(Math.min((w * 0.85) / Math.max(r.w, 1), (h * 0.85) / Math.max(r.h, 1)), MIN_Z, maxZ);
      applyCam({ x: r.x + r.w / 2 - w / 2 / z, y: r.y + r.h / 2 - h / 2 / z, z });
    },
    [applyCam],
  );

  // Remember the view per drawing (per device): debounced while moving,
  // and flushed when leaving so a quick navigation doesn't lose it.
  const saveCamera = useCallback(() => {
    if (!camReadyRef.current) return;
    try {
      localStorage.setItem(cameraKey, JSON.stringify(camRef.current));
    } catch {
      /* storage full or disabled: not important */
    }
  }, [cameraKey]);

  useEffect(() => {
    const t = setTimeout(saveCamera, 300);
    return () => clearTimeout(t);
  }, [cam, saveCamera]);

  useEffect(() => {
    window.addEventListener("pagehide", saveCamera);
    return () => {
      window.removeEventListener("pagehide", saveCamera);
      saveCamera();
    };
  }, [saveCamera]);

  // Canvas size follows its container; the first measurement also sets up
  // the camera (saved view, or fit the drawing on first open).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      setViewport({ w: width, h: height });
      if (!camReadyRef.current && width > 0 && height > 0) {
        camReadyRef.current = true;
        let saved: Camera | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(cameraKey) ?? "null");
        } catch {
          saved = null;
        }
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.z)) {
          applyCam(saved);
        } else {
          const b = contentBounds(elementsRef.current);
          if (b) zoomToRect(padRect(b, 40), 1);
          else applyCam({ x: -width / 2 + 200, y: -80, z: 1 });
        }
      }
      paint();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [applyCam, zoomToRect, paint, cameraKey]);

  // Wheel: pan by default, zoom with Ctrl/⌘ (also what trackpad pinch sends).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (isEditableTarget(e.target) && !(e.target as HTMLElement).closest("canvas")) {
        if ((e.target as HTMLElement).closest("[data-scrollable]")) return;
      }
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      const c = camRef.current;
      if (e.ctrlKey || e.metaKey) {
        const delta = clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, -60, 60);
        zoomAt(e.clientX - r.left, e.clientY - r.top, c.z * Math.exp(-delta * 0.01));
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        const unit = e.deltaMode === 1 ? 16 : 1;
        applyCam({ x: c.x + (dx * unit) / c.z, y: c.y + (dy * unit) / c.z, z: c.z });
      }
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [applyCam, zoomAt]);

  // --------------------------------------------------------- text editing

  const commitText = useCallback(() => {
    setEditing((cur) => {
      if (!cur) return null;
      const text = cur.text.replace(/\s+$/, "");
      if (!text) {
        if (cur.existing) {
          quietRemovesRef.current.add(cur.existing.id);
          dispatch({ type: "remove", ids: [cur.existing.id] });
        }
      } else if (cur.existing) {
        if (text !== cur.existing.text) dispatch({ type: "update", elements: [{ ...cur.existing, text }] });
      } else {
        const s = propsRef.current.style;
        ownAddsRef.current.add(cur.id);
        dispatch({
          type: "add",
          elements: [
            {
              id: cur.id,
              type: "text",
              x: round1(cur.x),
              y: round1(cur.y),
              text,
              color: s.color,
              fontSize: s.fontSize,
              font: s.font,
            },
          ],
        });
      }
      return null;
    });
  }, [dispatch]);

  const startEditing = (p: Point, existing: TextElement | null) => {
    if (editing) commitText();
    setSelected([]);
    setLassoRegion(null);
    const s = propsRef.current.style;
    // Click places the middle of the first line at the cursor.
    setEditing(
      existing
        ? { id: existing.id, existing, x: existing.x, y: existing.y, text: existing.text }
        : { id: newId(), existing: null, x: p.x, y: p.y - (s.fontSize * TEXT_LINE_HEIGHT) / 2, text: "" },
    );
  };

  useEffect(() => {
    if (editing) requestAnimationFrame(() => textareaRef.current?.focus());
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------- equations and graphs

  const openEquation = (at: Point, existing: MathElement | null) => {
    if (editing) commitText();
    setLassoRegion(null);
    setMath(null);
    setSelected(existing ? [existing.id] : []);
    setEquation({ at, existing });
  };

  const submitEquation = (v: EquationValue) => {
    const cur = equation;
    setEquation(null);
    if (!cur) return;
    const fit = (size: number) => ({
      w: Math.max(0.1, v.layout.width * size),
      h: Math.max(0.1, v.layout.height * size),
    });
    if (cur.existing) {
      const el = cur.existing;
      if (el.source === v.source && el.syntax === v.syntax) return;
      dispatch({ type: "update", elements: [{ ...el, syntax: v.syntax, source: v.source, ...fit(el.size) }] });
      return;
    }
    const s = propsRef.current.style;
    const size = s.fontSize;
    const { w, h } = fit(size);
    const el: MathElement = {
      id: newId(),
      type: "math",
      syntax: v.syntax,
      source: v.source,
      color: s.color,
      x: round1(cur.at.x),
      y: round1(cur.at.y - h / 2),
      size,
      w,
      h,
    };
    dispatch({ type: "add", elements: [el] });
  };

  const insertMath = async (value: Pick<MathElement, "syntax" | "source">) => {
    const layout = await typesetMath(texSource(value));
    const s = propsRef.current.style;
    const c = camRef.current;
    const size = Math.max(16, s.fontSize);
    const w = Math.max(0.1, layout.width * size);
    const h = Math.max(0.1, layout.height * size);
    const center = { x: c.x + viewport.w / 2 / c.z, y: c.y + viewport.h / 2 / c.z };
    // In the middle of the view, moved down past anything already there.
    let at = { x: round1(center.x - w / 2), y: round1(center.y - h / 2) };
    const boxes = elementsRef.current.filter((e) => e.type !== "eraser").map(elementBounds);
    for (let i = 0; i < 12; i++) {
      const box = padRect({ ...at, w, h }, 12);
      const hit = boxes.find((r) => rectsIntersect(r, box));
      if (!hit) break;
      at = { x: at.x, y: round1(hit.y + hit.h + 24) };
    }
    const el: MathElement = {
      id: newId(),
      type: "math",
      syntax: value.syntax,
      source: value.source,
      color: s.color === "#ffffff" ? "#201f24" : s.color,
      x: at.x,
      y: at.y,
      size,
      w,
      h,
    };
    dispatch({ type: "add", elements: [el] });
    setSelected([el.id]);
    setLassoRegion(null);
    setTool("select");
  };

  /** Close the graph editor, saving what it shows (or not, when cancelled). */
  const finishGraphEdit = (save: boolean, next?: GraphElement) => {
    const original = graphEdit;
    const result = next ?? graphPreview;
    setGraphEdit(null);
    setGraphPreview(null);
    if (!original) return;
    if (save && result && JSON.stringify(result) !== JSON.stringify(original)) {
      dispatch({ type: "update", elements: [result] });
    }
    setSelected([original.id]);
    if (propsRef.current.tool === "graph") setTool("select");
  };

  const openGraph = (el: GraphElement) => {
    if (editing) commitText();
    setLassoRegion(null);
    setMath(null);
    setSelected([el.id]);
    setGraphPreview(null);
    setGraphEdit(el);
  };

  // ---------------------------------------------------------- to-do boards

  const openKanban = (edit: KanbanEdit) => {
    if (editing) commitText();
    setLassoRegion(null);
    setMath(null);
    setSelected([edit.boardId]);
    setKanbanEdit({ ...edit, newCardId: newId() });
  };

  const boardById = (id: string) => {
    const el = elementsRef.current.find((e) => e.id === id);
    return el?.type === "kanban" ? el : null;
  };

  /** Put a new board where the pointer is, sized to look the same at any zoom, and ask for its first card. */
  const placeKanban = (p: Point) => {
    const scale = Math.round(clamp(1 / camRef.current.z, 0.05, 50) * 1000) / 1000;
    const draft = newKanban({ id: newId(), x: 0, y: 0, scale, ids: newId });
    const w = kanbanLayout(draft).w;
    const board: KanbanElement = { ...draft, x: round1(p.x - w / 2), y: round1(p.y - 24 * scale) };
    dispatch({ type: "add", elements: [board] });
    setTool("select");
    openKanban({ mode: "card", boardId: board.id, columnId: board.columns[0].id, cardId: null });
  };

  /** Where a dragged card would land if dropped at `p`: the topmost board under it. */
  const cardTargetAt = (boardId: string, cardId: string, p: Point): CardTarget | null => {
    const src = boardById(boardId);
    if (!src || !findCard(src, cardId)) return null;
    const without = withoutCard(src, cardId);
    const els = elementsRef.current;
    const slack = 16 / camRef.current.z;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.type !== "kanban") continue;
      const b = el.id === src.id ? without : el;
      const l = kanbanLayout(b);
      if (p.x < l.x - slack || p.x > l.x + l.w + slack || p.y < l.y - slack || p.y > l.y + l.h + slack) continue;
      return { boardId: el.id, ...dropSlot(b, p) };
    }
    return null;
  };

  /** The boards as they'd be after dropping the card on `target`, or null if nothing would change. */
  const cardMoveResult = (boardId: string, cardId: string, target: CardTarget | null) => {
    if (!target) return null;
    const src = boardById(boardId);
    const dst = boardById(target.boardId);
    if (!src || !dst) return null;
    return moveCard(src, dst, { cardId, columnId: target.columnId, index: target.index });
  };

  const runClick = (click: ClickAction) => {
    if (click.kind === "add-card") {
      openKanban({ mode: "card", boardId: click.boardId, columnId: click.columnId, cardId: null });
      return;
    }
    const el = elementsRef.current.find((e) => e.id === click.id);
    if (el && (el.type === "gif" || el.type === "video")) propsRef.current.images?.toggle(el);
  };

  // ---------------------------------------------------------- math check

  const runCheck = useCallback(
    async (region: Rect, polygon: Point[] | null) => {
      const token = ++mathTokenRef.current;
      const req: MathRequest = { region, polygon, token };
      setMath({ req, state: { status: "loading" } });

      const longest = Math.max(region.w, region.h, 1);
      const scale = clamp(1400 / longest, 0.5, 4);
      const canvas = renderRegion({
        elements: elementsRef.current,
        background: propsRef.current.background,
        region,
        scale,
        env,
        clip: polygon ?? undefined,
      });
      let dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length > 4_000_000) dataUrl = canvas.toDataURL("image/jpeg", 0.9);

      try {
        const result = await onCheckMath(dataUrl);
        if (mathTokenRef.current === token) setMath({ req, state: { status: "done", result } });
      } catch (err) {
        if (mathTokenRef.current === token) {
          setMath({
            req,
            state: { status: "error", error: err instanceof Error ? err.message : "Checking failed." },
          });
        }
      }
    },
    // env reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCheckMath],
  );

  /** Check whatever is selected (lasso region or selected items). */
  const checkSelection = () => {
    if (lassoRegion && lassoRegion.length > 2) {
      const b = polygonBounds(lassoRegion);
      if (b) return void runCheck(padRect(b, 8), lassoRegion);
    }
    const box = selectionBox(selected);
    if (box) return void runCheck(padRect(box, 16), null);
  };

  /** The selection (or lasso) as a picture: only what's selected, or everything inside the loop. */
  const captureSelection = async (): Promise<FlashcardCapture | null> => {
    const set = new Set(selected);
    const chosen = elementsRef.current.filter((el) => set.has(el.id));
    let region: Rect | null = null;
    let polygon: Point[] | undefined;
    let scene: CanvasElement[] = chosen;
    if (lassoRegion && lassoRegion.length > 2) {
      const b = polygonBounds(lassoRegion);
      region = b ? padRect(b, 8) : null;
      polygon = lassoRegion;
      scene = elementsRef.current;
    } else {
      const box = unionRects(chosen.map(elementBounds));
      region = box ? padRect(box, 16) : null;
    }
    if (!region) return null;
    const scale = clamp(1200 / Math.max(region.w, region.h, 1), 0.25, 3);
    const canvas = renderRegion({
      elements: scene,
      background: propsRef.current.background,
      region,
      scale,
      env,
      clip: polygon,
    });
    const blob =
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9))) ??
      (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")));
    if (!blob) return null;
    const text = chosen
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
    return { blob, width: canvas.width, height: canvas.height, text };
  };

  const makeFlashcard = async () => {
    const capture = await captureSelection();
    if (capture) onMakeFlashcard?.(capture);
  };

  const addMathNote = (result: MathCheck) => {
    if (!math) return;
    const r = math.req.region;
    const good = result.verdict === "correct";
    const fontSize = clamp(Math.round(r.h / 5), 20, 64);
    const words = (good ? "✓ Correct" : `✗ ${result.summary || "Check this step"}`).split(/\s+/);
    const lines: string[] = [];
    for (const word of words) {
      const last = lines[lines.length - 1];
      if (last && (last + " " + word).length <= 34) lines[lines.length - 1] = last + " " + word;
      else lines.push(word);
    }
    const note: TextElement = {
      id: newId(),
      type: "text",
      x: round1(r.x + r.w + 16),
      y: round1(r.y),
      text: lines.join("\n"),
      color: good ? "#277c78" : "#c94736",
      fontSize,
      font: "hand",
    };
    dispatch({ type: "add", elements: [note] });
    setSelected([note.id]);
    setLassoRegion(null);
    setMath(null);
  };

  // ---------------------------------------------------- images, GIFs, videos

  const insertFiles = useCallback(
    async (files: File[], at?: Point) => {
      const cache = propsRef.current.images;
      if (!cache) return;
      const usable = files.filter((f) => {
        const type = fileType(f);
        return type.startsWith("image/") || isVideoType(type);
      });
      if (usable.length === 0) {
        if (files.length) toast.error("Only images, GIFs and videos (MP4, WebM, MOV) can go on the board.");
        return;
      }
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      const c = camRef.current;
      const viewW = canvas.width / dpr / c.z;
      const viewH = canvas.height / dpr / c.z;
      const center = at ?? { x: c.x + viewW / 2, y: c.y + viewH / 2 };
      const added: AssetElement[] = [];
      let offset = 0;
      for (const file of usable) {
        const type = fileType(file);
        try {
          let kind: AssetElement["type"] = "image";
          let a: { id: string; width: number; height: number };
          let pixelScale = dpr;
          if (isVideoType(type)) {
            if (usable.length === 1) toast.loading("Adding the video…", { id: "media" });
            a = await cache.addVideo(file, type);
            kind = "video";
            pixelScale = 1;
          } else {
            const gif = type === "image/gif" ? await inspectGif(file) : null;
            if (gif && gif.frames > 1) {
              a = await cache.addGif(file, gif);
              kind = "gif";
              pixelScale = 1;
            } else {
              a = await cache.add(file);
            }
          }
          // Screenshots are usually 2× pixels: show them at their on-screen size,
          // but no bigger than 60 % of the view.
          let w = a.width / pixelScale;
          let h = a.height / pixelScale;
          const fit = Math.min(1, (viewW * 0.6) / w, (viewH * 0.6) / h);
          w *= fit;
          h *= fit;
          added.push({
            id: newId(),
            type: kind,
            assetId: a.id,
            x: round1(center.x - w / 2 + offset),
            y: round1(center.y - h / 2 + offset),
            w: round1(w),
            h: round1(h),
          });
          offset += 24 / c.z;
        } catch (err) {
          if (err instanceof AssetError) toast.error(err.message, { id: "media" });
          else {
            console.warn("[board] couldn't add file", err);
            toast.error(`Couldn't add ${file.name || "that file"}.`, { id: "media" });
          }
        }
      }
      if (added.length) {
        toast.dismiss("media");
        dispatch({ type: "add", elements: added });
        setSelected(added.map((a) => a.id));
        setLassoRegion(null);
        setTool("select");
      }
    },
    [dispatch, setTool],
  );

  /**
   * Traced strokes go where a picture would: in the middle of the view, at
   * the picture's on-screen size (a phone photo is shrunk to 60 % of the
   * view; a screenshot keeps its size), as one change that one undo removes.
   */
  const insertTraced = (picture: TracedPicture): number => {
    const canvas = canvasRef.current;
    if (!canvas || picture.strokes.length === 0) return 0;
    const dpr = window.devicePixelRatio || 1;
    const c = camRef.current;
    const viewW = canvas.width / dpr / c.z;
    const viewH = canvas.height / dpr / c.z;
    const w0 = picture.naturalWidth / dpr;
    const h0 = picture.naturalHeight / dpr;
    const fit = Math.min(1, (viewW * 0.6) / w0, (viewH * 0.6) / h0);
    const k = (w0 * fit) / picture.width; // world units per traced pixel
    const x0 = c.x + viewW / 2 - (picture.width * k) / 2;
    const y0 = c.y + viewH / 2 - (picture.height * k) / 2;
    const s = propsRef.current.style;
    const color = s.color === "#ffffff" ? "#201f24" : s.color;
    const added: CanvasElement[] = picture.strokes.map((st) => ({
      id: newId(),
      type: "stroke",
      color,
      brush: "marker",
      size: clamp(round1(st.size * k), 0.5, 400),
      points: st.points.slice(0, MAX_STROKE_COORDS).map((v, i) => round1(i % 2 === 0 ? x0 + v * k : y0 + v * k)),
    }));
    dispatch({ type: "add", elements: added });
    setSelected(added.map((a) => a.id));
    setLassoRegion(null);
    setTool("select");
    return added.length;
  };

  useImperativeHandle(ref, () => ({
    insertFiles: (files) => void insertFiles(files),
    insertTraced,
    insertMath,
    startMathCheck: () => {
      if (selected.length > 0 || (lassoRegion && lassoRegion.length > 2)) checkSelection();
      else {
        checkAfterLassoRef.current = true;
        setTool("lasso");
      }
    },
  }));

  // ------------------------------------------------------------ pointer

  const hitTolerance = () => 6 / camRef.current.z;

  const handleAt = (sx: number, sy: number): Handle | null => {
    const box = selectionBox(selected);
    if (!box) return null;
    const b = padRect(box, 4 / camRef.current.z);
    const names: Handle[] = ["nw", "ne", "sw", "se"];
    const cs = corners(b);
    for (let i = 0; i < 4; i++) {
      const s = worldToScreen({ x: cs[i][0], y: cs[i][1] });
      if (Math.abs(s.x - sx) <= 8 && Math.abs(s.y - sy) <= 8) return names[i];
    }
    return null;
  };

  const setCursor = (c: string) => {
    if (canvasRef.current && canvasRef.current.style.cursor !== c) canvasRef.current.style.cursor = c;
  };

  const hoverCursor = (hit: CanvasElement | null, p: Point) => {
    if (!hit) return "default";
    if (hit.type === "gif" || hit.type === "video" || readOnly) return "pointer";
    if (hit.type === "kanban") {
      const part = kanbanPartAt(hit, p);
      return part.kind === "card" ? "grab" : part.kind === "add" ? "pointer" : "move";
    }
    return "move";
  };

  const toolCursor = () => {
    if (spaceRef.current || tool === "hand") return interRef.current.kind === "pan" ? "grabbing" : "grab";
    switch (tool) {
      case "select":
        return "default";
      case "text":
        return "text";
      case "eraser":
        return "none";
      default:
        return "crosshair";
    }
  };

  const startDraft = (p: Point, e: React.PointerEvent): CanvasElement | null => {
    const s = style;
    const id = newId();
    const sketch = s.sketchy ? { seed: randomSeed(), roughness: s.roughness, fillStyle: s.fillStyle } : undefined;
    switch (tool) {
      case "pen": {
        const pressure = e.pointerType === "pen" && e.pressure > 0 ? [round2(e.pressure)] : undefined;
        return {
          id,
          type: "stroke",
          color: s.color,
          size: s.brush === "highlighter" ? s.highlighterSize : s.penSize,
          brush: s.brush,
          points: [round1(p.x), round1(p.y)],
          ...(pressure && s.brush === "ink" ? { pressures: pressure } : {}),
        };
      }
      case "eraser":
        return s.eraserMode === "pixel"
          ? { id, type: "eraser", size: s.eraserSize, points: [round1(p.x), round1(p.y)] }
          : null;
      case "line":
      case "arrow":
        return {
          id,
          type: "line",
          color: s.color,
          size: s.shapeSize,
          x1: round1(p.x),
          y1: round1(p.y),
          x2: round1(p.x),
          y2: round1(p.y),
          ...(tool === "arrow" ? { arrow: true } : {}),
          ...(sketch ? { sketch } : {}),
        };
      case "graph":
        return {
          id,
          type: "graph",
          x: round1(p.x),
          y: round1(p.y),
          w: 0,
          h: 0,
          fns: [{ expr: "sin(x)", color: GRAPH_COLORS[0] }],
          xMin: -10,
          xMax: 10,
          yMin: -4,
          yMax: 4,
          grid: true,
        };
      case "rect":
      case "ellipse":
        return {
          id,
          type: tool,
          color: s.color,
          size: s.shapeSize,
          fill: s.fill ? s.color : null,
          x: round1(p.x),
          y: round1(p.y),
          w: 0,
          h: 0,
          ...(sketch ? { sketch } : {}),
        };
      default:
        return null;
    }
  };

  const snapshotScene = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The snapshot is drawn over until the stroke ends, so settle any effects first.
    fxRef.current?.finishAll();
    kanbanFxRef.current?.dispose();
    paint(); // make sure the canvas shows the committed scene
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d")!.drawImage(canvas, 0, 0);
    sceneCacheRef.current = copy;
  };

  const eraseAt = (p: Point) => {
    const r = style.eraserSize / 2;
    const hidden = hiddenRef.current;
    for (const el of elementsRef.current) {
      if (UNERASABLE.has(el.type) || hidden.has(el.id)) continue;
      if (hitTest(el, p, r)) {
        hidden.add(el.id);
        // It leaves now, as the eraser passes; the removal itself comes when the pointer lifts.
        quietRemovesRef.current.add(el.id);
        fxRef.current?.leave(el);
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    if (editing) {
      commitText();
      if (tool !== "text") return;
    }
    // A click on the canvas closes an open equation or graph editor.
    if (equation) {
      setEquation(null);
      return;
    }
    if (graphEdit) {
      finishGraphEdit(true);
      return;
    }
    if (kanbanEdit) {
      setKanbanEdit(null);
      // Saves what's typed (the editor is gone if its board was deleted meanwhile).
      if (kanbanEditorRef.current) {
        kanbanEditorRef.current.commit();
        return;
      }
    }
    const { sx, sy } = eventPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: sx, y: sy });

    // Two fingers: pinch-zoom / pan, abandoning whatever the first finger began.
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      hiddenRef.current.clear();
      overridesRef.current = null;
      sceneCacheRef.current = null;
      interRef.current = {
        kind: "pinch",
        dist0: Math.hypot(a.x - b.x, a.y - b.y),
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cam0: camRef.current,
      };
      schedulePaint();
      return;
    }
    if (pointersRef.current.size > 2) return;

    const p = screenToWorld(sx, sy);
    // View-only: anything but selecting and lassoing pans.
    const viewOnlyPan = readOnly && tool !== "select" && tool !== "lasso";
    const pan = e.button === 1 || tool === "hand" || spaceRef.current || viewOnlyPan;
    if (pan) {
      interRef.current = { kind: "pan", sx, sy, cam0: camRef.current };
      setCursor("grabbing");
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setMath(null);

    switch (tool) {
      case "select": {
        const handle = readOnly ? null : handleAt(sx, sy);
        if (handle) {
          const ids = new Set(selected);
          const originals = elementsRef.current.filter((el) => ids.has(el.id));
          const keepAspect = originals.some((el) => KEEP_ASPECT.has(el.type)) !== e.shiftKey;
          interRef.current = { kind: "resize", handle, box0: unionRects(originals.map(elementBox))!, originals, keepAspect };
          break;
        }
        const hit = hitTestAll(elementsRef.current, p, hitTolerance());
        if (hit) {
          let ids = selected;
          if (e.shiftKey) {
            ids = selected.includes(hit.id) ? selected.filter((i) => i !== hit.id) : [...selected, hit.id];
          } else if (!selected.includes(hit.id)) {
            ids = [hit.id];
          }
          setSelected(ids);
          setLassoRegion(null);
          const set = new Set(ids);
          const part: KanbanPart | null = hit.type === "kanban" ? kanbanPartAt(hit, p) : null;
          if (part?.kind === "card" && !readOnly && !e.shiftKey) {
            // Pressing a card picks it up (dragging it), rather than the whole board.
            const box = kanbanLayout(hit as KanbanElement).columns.flatMap((c) => c.cards).find((c) => c.card.id === part.cardId);
            interRef.current = {
              kind: "card",
              boardId: hit.id,
              cardId: part.cardId,
              start: p,
              grab: box ? { x: p.x - box.rect.x, y: p.y - box.rect.y } : { x: 0, y: 0 },
              at: p,
              active: false,
              target: null,
            };
            break;
          }
          const click: ClickAction | null = e.shiftKey
            ? null
            : part?.kind === "add" && !readOnly
              ? { kind: "add-card", boardId: hit.id, columnId: part.columnId }
              : hit.type === "gif" || hit.type === "video"
                ? { kind: "media", id: hit.id }
                : null;
          // View-only selections can be checked, copied or played, not moved.
          interRef.current = {
            kind: "move",
            start: p,
            originals: readOnly ? [] : elementsRef.current.filter((el) => set.has(el.id)),
            moved: false,
            click,
          };
        } else {
          if (!e.shiftKey) setSelected([]);
          setLassoRegion(null);
          interRef.current = { kind: "marquee", start: p, current: p, base: e.shiftKey ? selected : [] };
        }
        break;
      }
      case "lasso":
        setSelected([]);
        setLassoRegion(null);
        interRef.current = { kind: "lasso", points: [p], checkAfter: checkAfterLassoRef.current };
        checkAfterLassoRef.current = false;
        break;
      case "text": {
        const hit = hitTestAll(elementsRef.current, p, hitTolerance());
        startEditing(p, hit?.type === "text" ? hit : null);
        return;
      }
      case "equation": {
        const hit = hitTestAll(elementsRef.current, p, hitTolerance());
        openEquation(p, hit?.type === "math" ? hit : null);
        return;
      }
      case "kanban":
        placeKanban(p);
        return;
      case "graph": {
        const hit = hitTestAll(elementsRef.current, p, hitTolerance());
        if (hit?.type === "graph") {
          openGraph(hit);
          return;
        }
        const draft = startDraft(p, e);
        if (!draft) return;
        snapshotScene();
        interRef.current = { kind: "draw", draft, origin: p };
        setSelected([]);
        setLassoRegion(null);
        break;
      }
      case "eraser":
        if (style.eraserMode === "stroke") {
          interRef.current = { kind: "erase" };
          eraseAt(p);
          break;
        }
      // falls through: pixel eraser draws like a pen
      default: {
        const draft = startDraft(p, e);
        if (!draft) return;
        snapshotScene();
        interRef.current = { kind: "draw", draft, origin: p };
        setSelected([]);
        setLassoRegion(null);
      }
    }
    setInteracting(true);
    schedulePaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = eventPoint(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: sx, y: sy });
    const p = screenToWorld(sx, sy);
    hoverRef.current = p;
    onPointerWorld?.(p);
    const inter = interRef.current;

    switch (inter.kind) {
      case "none": {
        if (tool === "select" && !spaceRef.current) {
          const h = readOnly ? null : handleAt(sx, sy);
          if (h) setCursor(h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize");
          else setCursor(hoverCursor(hitTestAll(elementsRef.current, p, hitTolerance()), p));
        } else {
          setCursor(toolCursor());
        }
        if (tool === "eraser") schedulePaint();
        return;
      }
      case "pinch": {
        if (pointersRef.current.size < 2) return;
        const [a, b] = [...pointersRef.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const c0 = inter.cam0;
        const z = clamp((c0.z * dist) / Math.max(inter.dist0, 1), MIN_Z, MAX_Z);
        // Keep the world point that was under the starting midpoint under the fingers.
        const wx = c0.x + inter.mid0.x / c0.z;
        const wy = c0.y + inter.mid0.y / c0.z;
        applyCam({ x: wx - mid.x / z, y: wy - mid.y / z, z });
        return;
      }
      case "pan": {
        const c0 = inter.cam0;
        applyCam({ x: c0.x - (sx - inter.sx) / c0.z, y: c0.y - (sy - inter.sy) / c0.z, z: c0.z });
        return;
      }
      case "draw": {
        const d = inter.draft;
        if (d.type === "stroke" || d.type === "eraser") {
          const coalesced = e.nativeEvent.getCoalescedEvents?.();
          const events = coalesced && coalesced.length > 0 ? coalesced : [e.nativeEvent];
          const minStep = 0.75 / camRef.current.z;
          for (const ev of events) {
            const q = eventPoint(ev);
            const w = screenToWorld(q.sx, q.sy);
            const n = d.points.length;
            const dx = w.x - d.points[n - 2];
            const dy = w.y - d.points[n - 1];
            if (dx * dx + dy * dy < minStep * minStep) continue;
            d.points.push(round1(w.x), round1(w.y));
            if (d.type === "stroke" && d.pressures) d.pressures.push(round2(ev.pressure || 0.5));
          }
          if (d.points.length >= MAX_STROKE_COORDS) {
            ownAddsRef.current.add(d.id);
            dispatch({ type: "add", elements: [cloneDraft(d)] });
            inter.draft = {
              ...d,
              id: newId(),
              points: d.points.slice(-2),
              ...(d.type === "stroke" && d.pressures ? { pressures: d.pressures.slice(-1) } : {}),
            } as CanvasElement;
            snapshotScene();
          }
        } else {
          const o = inter.origin;
          let dx = p.x - o.x;
          let dy = p.y - o.y;
          if (d.type === "line") {
            if (e.shiftKey) {
              const step = Math.PI / 4;
              const ang = Math.round(Math.atan2(dy, dx) / step) * step;
              const len = Math.hypot(dx, dy);
              dx = Math.cos(ang) * len;
              dy = Math.sin(ang) * len;
            }
            d.x2 = round1(o.x + dx);
            d.y2 = round1(o.y + dy);
          } else if (d.type === "graph") {
            const r = rectFromPoints(o, p);
            d.x = round1(r.x);
            d.y = round1(r.y);
            d.w = round1(r.w);
            d.h = round1(r.h);
          } else if (d.type === "rect" || d.type === "ellipse") {
            if (e.shiftKey) {
              const m = Math.max(Math.abs(dx), Math.abs(dy));
              dx = Math.sign(dx || 1) * m;
              dy = Math.sign(dy || 1) * m;
            }
            d.w = round1(dx);
            d.h = round1(dy);
          }
        }
        break;
      }
      case "erase": {
        const coalesced = e.nativeEvent.getCoalescedEvents?.();
        const events = coalesced && coalesced.length > 0 ? coalesced : [e.nativeEvent];
        for (const ev of events) {
          const q = eventPoint(ev);
          eraseAt(screenToWorld(q.sx, q.sy));
        }
        break;
      }
      case "move": {
        const dx = p.x - inter.start.x;
        const dy = p.y - inter.start.y;
        if (!inter.moved && Math.hypot(dx, dy) * camRef.current.z < 3) return;
        inter.moved = true;
        if (inter.originals.length === 0) return;
        overridesRef.current = new Map(inter.originals.map((el) => [el.id, translateElement(el, dx, dy)]));
        break;
      }
      case "card": {
        inter.at = p;
        if (!inter.active) {
          if (Math.hypot(p.x - inter.start.x, p.y - inter.start.y) * camRef.current.z < 4) return;
          inter.active = true;
          setCursor("grabbing");
        }
        inter.target = cardTargetAt(inter.boardId, inter.cardId, p);
        // Preview: the card's slot opens up where it would land.
        const moved = cardMoveResult(inter.boardId, inter.cardId, inter.target);
        overridesRef.current = moved ? new Map(moved.map((el) => [el.id, el])) : null;
        break;
      }
      case "resize": {
        const b = inter.box0;
        const fixed = {
          x: inter.handle.includes("w") ? b.x + b.w : b.x,
          y: inter.handle.includes("n") ? b.y + b.h : b.y,
        };
        let w = p.x - fixed.x;
        let h = p.y - fixed.y;
        if (inter.keepAspect && b.w > 0 && b.h > 0) {
          const s = Math.max(Math.abs(w) / b.w, Math.abs(h) / b.h);
          w = Math.sign(w || 1) * b.w * s;
          h = Math.sign(h || 1) * b.h * s;
        }
        const minSize = 4 / camRef.current.z;
        w = Math.sign(w || 1) * Math.max(Math.abs(w), minSize);
        h = Math.sign(h || 1) * Math.max(Math.abs(h), minSize);
        const to = rectFromPoints(fixed, { x: fixed.x + w, y: fixed.y + h });
        overridesRef.current = new Map(inter.originals.map((el) => [el.id, scaleElement(el, b, to)]));
        break;
      }
      case "marquee":
        inter.current = p;
        break;
      case "lasso": {
        const last = inter.points[inter.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * camRef.current.z >= 3) inter.points.push(p);
        break;
      }
    }
    schedulePaint();
  };

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointersRef.current.delete(e.pointerId);
    const inter = interRef.current;
    if (inter.kind === "pinch") {
      if (pointersRef.current.size === 0) interRef.current = { kind: "none" };
      return;
    }
    interRef.current = { kind: "none" };
    sceneCacheRef.current = null;

    if (!cancelled) {
      switch (inter.kind) {
        case "draw": {
          const d = inter.draft;
          if (d.type === "graph") {
            const z = camRef.current.z;
            let g: GraphElement;
            if (d.w * z >= 40 && d.h * z >= 40) {
              g = { ...d, w: Math.max(40, d.w), h: Math.max(40, d.h) };
            } else {
              // A click: a graph about 480 × 320 on screen, centred there.
              const w = round1(clamp(480 / z, 80, 4000));
              const h = round1(clamp(320 / z, 60, 3000));
              g = { ...d, x: round1(inter.origin.x - w / 2), y: round1(inter.origin.y - h / 2), w, h };
            }
            dispatch({ type: "add", elements: [g] });
            openGraph(g);
            break;
          }
          const meaningful =
            d.type === "line"
              ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 1
              : d.type === "rect" || d.type === "ellipse"
                ? Math.abs(d.w) >= 1 || Math.abs(d.h) >= 1
                : true;
          if (meaningful) {
            ownAddsRef.current.add(d.id);
            dispatch({ type: "add", elements: [cloneDraft(d)] });
          }
          break;
        }
        case "erase":
          if (hiddenRef.current.size) dispatch({ type: "remove", ids: [...hiddenRef.current] });
          break;
        case "move":
        case "resize":
          if (overridesRef.current?.size && (inter.kind === "resize" || inter.moved)) {
            dispatch({ type: "update", elements: [...overridesRef.current.values()] });
          }
          if (inter.kind === "move" && !inter.moved && inter.click) runClick(inter.click);
          break;
        case "card": {
          if (!inter.active) {
            // A click (no drag) opens the card.
            const board = boardById(inter.boardId);
            const found = board ? findCard(board, inter.cardId) : null;
            if (found) openKanban({ mode: "card", boardId: inter.boardId, columnId: found.column.id, cardId: inter.cardId });
            break;
          }
          // Recomputed from the latest boards, in case someone else changed them meanwhile.
          const moved = cardMoveResult(inter.boardId, inter.cardId, inter.target);
          if (moved) {
            // It glides into its slot from where it was let go.
            const to = inter.target?.boardId ?? inter.boardId;
            kanbanFxRef.current?.noteDrop(
              to,
              inter.cardId,
              { x: inter.at.x - inter.grab.x, y: inter.at.y - inter.grab.y },
              moved,
            );
            dispatch({ type: "update", elements: moved });
          }
          break;
        }
        case "marquee": {
          const r = rectFromPoints(inter.start, inter.current);
          if (r.w * camRef.current.z > 3 || r.h * camRef.current.z > 3) {
            const inside = elementsRef.current
              .filter((el) => el.type !== "eraser" && rectContainsRect(r, elementBounds(el)))
              .map((el) => el.id);
            setSelected([...new Set([...inter.base, ...inside])]);
          }
          break;
        }
        case "lasso": {
          const poly = inter.points;
          const b = polygonBounds(poly);
          if (poly.length > 4 && b && b.w * camRef.current.z > 8 && b.h * camRef.current.z > 8) {
            setLassoRegion(poly);
            setSelected(
              elementsRef.current.filter((el) => el.type !== "eraser" && insidePolygon(el, poly)).map((el) => el.id),
            );
            if (inter.checkAfter) void runCheck(padRect(b, 8), poly);
          }
          break;
        }
      }
    }

    hiddenRef.current.clear();
    overridesRef.current = null;
    setInteracting(false);
    setCursor(toolCursor());
    schedulePaint();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly || (tool !== "select" && tool !== "text")) return;
    const { sx, sy } = eventPoint(e);
    const p = screenToWorld(sx, sy);
    const hit = hitTestAll(elementsRef.current, p, hitTolerance());
    if (hit?.type === "text") startEditing(p, hit);
    else if (hit?.type === "math") openEquation(p, hit);
    else if (hit?.type === "graph") openGraph(hit);
    else if (hit?.type === "kanban") {
      const part = kanbanPartAt(hit, p);
      if (part.kind === "card") openKanban({ mode: "card", boardId: hit.id, columnId: part.columnId, cardId: part.cardId });
      else if (part.kind === "header") openKanban({ mode: "column", boardId: hit.id, columnId: part.columnId });
      else if (part.kind === "title") openKanban({ mode: "title", boardId: hit.id });
    } else if (!hit && tool === "select") startEditing(p, null);
  };

  // ----------------------------------------------------------- keyboard

  const deleteSelection = () => {
    if (selected.length === 0) return;
    dispatch({ type: "remove", ids: selected });
    setSelected([]);
    setLassoRegion(null);
  };

  const cloneElements = (els: CanvasElement[], offset: number) =>
    els.map((el) => {
      const moved = translateElement(el, offset, offset);
      if (moved.type === "kanban") {
        // Fresh ids for the copy's columns and cards too, so moving cards between the two boards works.
        return {
          ...moved,
          id: newId(),
          columns: moved.columns.map((c) => ({ ...c, id: newId(), cards: c.cards.map((k) => ({ ...k, id: newId() })) })),
        };
      }
      return { ...moved, id: newId(), ...("sketch" in moved && moved.sketch ? { sketch: { ...moved.sketch, seed: randomSeed() } } : {}) } as CanvasElement;
    });

  const duplicateSelection = () => {
    const set = new Set(selected);
    const copies = cloneElements(
      elementsRef.current.filter((el) => set.has(el.id)),
      20 / camRef.current.z,
    );
    if (copies.length === 0) return;
    dispatch({ type: "add", elements: copies });
    setSelected(copies.map((c) => c.id));
    setLassoRegion(null);
  };

  const copySelection = (cut: boolean) => {
    const set = new Set(selected);
    const els = elementsRef.current.filter((el) => set.has(el.id));
    if (els.length === 0) return false;
    clipboardRef.current = els;
    void navigator.clipboard?.writeText(CLIPBOARD_MARKER + JSON.stringify(els)).catch(() => {});
    if (cut) deleteSelection();
    return true;
  };

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (e.key === " " && !e.repeat) {
      spaceRef.current = true;
      setCursor("grab");
      e.preventDefault();
      return;
    }
    if (!ready) return;

    if (mod) {
      if (readOnly && (key === "d" || key === "x")) return;
      if (key === "a") {
        e.preventDefault();
        setSelected(elementsRef.current.filter((el) => el.type !== "eraser").map((el) => el.id));
        setLassoRegion(null);
        setTool("select");
      } else if (key === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (key === "c" || key === "x") {
        if (copySelection(key === "x")) e.preventDefault();
      } else if (key === "=" || key === "+") {
        e.preventDefault();
        zoomAt(viewport.w / 2, viewport.h / 2, camRef.current.z * 1.25);
      } else if (key === "-") {
        e.preventDefault();
        zoomAt(viewport.w / 2, viewport.h / 2, camRef.current.z / 1.25);
      } else if (key === "0") {
        e.preventDefault();
        zoomAt(viewport.w / 2, viewport.h / 2, 1);
      }
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selected.length && !readOnly) {
        e.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (e.key === "Escape") {
      if (graphEdit) finishGraphEdit(false);
      setKanbanEdit(null);
      setEquation(null);
      setSelected([]);
      setLassoRegion(null);
      setMath(null);
      return;
    }
    if (e.key.startsWith("Arrow") && selected.length && !readOnly) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / camRef.current.z;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const set = new Set(selected);
      dispatch({
        type: "update",
        elements: elementsRef.current.filter((el) => set.has(el.id)).map((el) => translateElement(el, dx, dy)),
      });
      return;
    }
    if (e.shiftKey && e.key === "!") {
      zoomToRect(padRect(contentBounds(elementsRef.current) ?? { x: 0, y: 0, w: 400, h: 300 }, 40), 2);
      return;
    }
    if (e.shiftKey && e.key === "@") {
      zoomToRect(selectionBox(selected), 4);
      return;
    }
    if (e.altKey || e.shiftKey) return;
    if (key === "i") {
      if (!readOnly) fileInputRef.current?.click();
      return;
    }
    if (key === TRACE_ACTION.key) {
      if (!readOnly) onTracePicture?.();
      return;
    }
    const t = TOOLS.find((x) => x.key === key);
    if (t && (!readOnly || VIEW_TOOLS.includes(t.id))) setTool(t.id);
  });

  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === " ") {
      spaceRef.current = false;
      setCursor(toolCursor());
      schedulePaint();
    }
  });

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (!ready || readOnly || isEditableTarget(e.target)) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...dt.files].filter((f) => fileType(f).startsWith("image/") || isVideoType(fileType(f)));
    const c = camRef.current;
    const hover = hoverRef.current;
    if (files.length) {
      e.preventDefault();
      void insertFiles(files, hover ?? undefined);
      return;
    }
    const text = dt.getData("text/plain");
    let els: CanvasElement[] | null = null;
    if (text.startsWith(CLIPBOARD_MARKER)) {
      try {
        els = JSON.parse(text.slice(CLIPBOARD_MARKER.length));
      } catch {
        els = null;
      }
    } else if (!text && clipboardRef.current.length) {
      els = clipboardRef.current;
    }
    if (els && els.length) {
      e.preventDefault();
      const copies = cloneElements(els, 24 / c.z);
      dispatch({ type: "add", elements: copies });
      setSelected(copies.map((x) => x.id));
      setTool("select");
      return;
    }
    if (text.trim()) {
      e.preventDefault();
      const at = hover ?? { x: c.x + viewport.w / 2 / c.z, y: c.y + viewport.h / 2 / c.z };
      const el: TextElement = {
        id: newId(),
        type: "text",
        x: round1(at.x),
        y: round1(at.y),
        text: text.slice(0, 10_000),
        color: style.color,
        fontSize: style.fontSize,
        font: style.font,
      };
      dispatch({ type: "add", elements: [el] });
      setSelected([el.id]);
    }
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const up = (e: KeyboardEvent) => onKeyUp(e);
    const paste = (e: ClipboardEvent) => onPaste(e);
    const blur = () => {
      spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("paste", paste);
    };
  }, []);

  // Keep the cursor in step with the active tool.
  useEffect(() => {
    if (canvasRef.current) canvasRef.current.style.cursor = toolCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ---------------------------------------------------------------- UI

  // A board editor is open (unless its board was deleted meanwhile).
  const kanbanEditOpen = !!kanbanEdit && elements.some((e) => e.id === kanbanEdit.boardId);

  // Outside of a drag there are no overrides, so props are the source of truth.
  const selBox =
    !interacting && !editing && !equation && !graphEdit && !kanbanEditOpen
      ? lassoRegion && lassoRegion.length > 2
        ? polygonBounds(lassoRegion)
        : unionRects(elements.filter((e) => selected.includes(e.id)).map(elementBounds))
      : null;

  const toolbarPos = (() => {
    if (!selBox || viewport.w === 0) return null;
    const tl = { x: (selBox.x - cam.x) * cam.z, y: (selBox.y - cam.y) * cam.z };
    const w = selBox.w * cam.z;
    const left = clamp(tl.x + w / 2, 140, viewport.w - 140);
    const above = tl.y - 56;
    const top = above > 8 ? above : Math.min(tl.y + selBox.h * cam.z + 12, viewport.h - 56);
    return { left, top };
  })();

  const mathPos = (() => {
    if (!math || viewport.w === 0) return null;
    const r = math.req.region;
    const sx = (r.x - cam.x) * cam.z;
    const sy = (r.y - cam.y) * cam.z;
    const sw = r.w * cam.z;
    const cardW = Math.min(352, viewport.w - 24);
    let left = sx + sw + 16;
    if (left + cardW > viewport.w - 12) left = sx - cardW - 16;
    if (left < 12) left = clamp(sx + sw / 2 - cardW / 2, 12, viewport.w - cardW - 12);
    const top = clamp(sy, 12, Math.max(12, viewport.h - 420));
    return { left, top };
  })();

  const equationPos = (() => {
    if (!equation || viewport.w === 0) return null;
    const ex = equation.existing;
    const anchor = ex ? { x: ex.x, y: ex.y + ex.h } : equation.at;
    const sx = (anchor.x - cam.x) * cam.z;
    const sy = (anchor.y - cam.y) * cam.z;
    const width = Math.min(400, viewport.w - 24);
    const left = clamp(sx - 24, 12, Math.max(12, viewport.w - width - 12));
    const height = 330;
    const aboveY = (ex ? (ex.y - cam.y) * cam.z : sy) - height - 16;
    const top = sy + 16 + height <= viewport.h ? sy + 16 : aboveY >= 12 ? aboveY : clamp(sy + 16, 12, Math.max(12, viewport.h - height - 12));
    return { left, top };
  })();

  const graphPos = (() => {
    if (!graphEdit || viewport.w === 0) return null;
    const g = graphPreview ?? graphEdit;
    const width = Math.min(360, viewport.w - 24);
    const gx = (g.x - cam.x) * cam.z;
    const gy = (g.y - cam.y) * cam.z;
    const gw = g.w * cam.z;
    let left = gx + gw + 16;
    if (left + width > viewport.w - 12) left = gx - width - 16;
    if (left < 12) left = viewport.w - width - 12;
    return { left: Math.max(12, left), top: clamp(gy, 12, Math.max(12, viewport.h - 460)) };
  })();

  const kanbanView = (() => {
    if (!kanbanEdit || viewport.w === 0) return null;
    const board = elements.find((e) => e.id === kanbanEdit.boardId);
    if (board?.type !== "kanban") return null;
    const l = kanbanLayout(board);
    let anchor: Rect = l.title;
    if (kanbanEdit.mode !== "title") {
      const col = l.columns.find((c) => c.column.id === kanbanEdit.columnId);
      if (!col) return null;
      const card = kanbanEdit.mode === "card" && kanbanEdit.cardId ? col.cards.find((c) => c.card.id === kanbanEdit.cardId) : null;
      anchor = kanbanEdit.mode === "column" ? col.header : (card?.rect ?? col.add);
    }
    const width = Math.min(320, viewport.w - 24);
    const height = kanbanEdit.mode === "card" ? 200 : kanbanEdit.mode === "column" ? 160 : 112;
    const left = clamp((anchor.x - cam.x) * cam.z - 8, 12, Math.max(12, viewport.w - width - 12));
    const top = clamp((anchor.y - cam.y) * cam.z - 8, 12, Math.max(12, viewport.h - height - 12));
    return { board, style: { left, top } };
  })();

  const editingStyle = (() => {
    if (!editing) return null;
    const s = editing.existing ?? style;
    const fontSize = s.fontSize;
    const font = "font" in s ? s.font : style.font;
    const color = s.color;
    const m = measureText({
      id: "measure",
      type: "text",
      x: 0,
      y: 0,
      text: editing.text || " ",
      color,
      fontSize,
      font,
    });
    return {
      left: (editing.x - cam.x) * cam.z,
      top: (editing.y - cam.y) * cam.z,
      width: Math.max(m.w * cam.z + fontSize * cam.z, 40),
      height: m.h * cam.z + 4,
      fontSize: fontSize * cam.z,
      lineHeight: TEXT_LINE_HEIGHT,
      fontFamily: FONT_FAMILIES[font],
      color,
    };
  })();

  return (
    <div
      ref={wrapRef}
      // Absolutely filling the card avoids percentage heights, which don't
      // resolve inside nested column flex layouts on phones.
      className="absolute inset-0 overflow-hidden"
      style={{
        backgroundImage: "radial-gradient(circle, #d8d1ca 1.1px, transparent 1.3px)",
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (readOnly) return;
        const files = [...e.dataTransfer.files];
        if (files.length === 0) return;
        e.preventDefault();
        const { sx, sy } = eventPoint(e);
        void insertFiles(files, screenToWorld(sx, sy));
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Drawing with ${elements.length} items. Zoom ${Math.round(cam.z * 100)}%.`}
        data-testid="board"
        className="absolute inset-0 h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        onPointerLeave={() => {
          hoverRef.current = null;
          onPointerWorld?.(null);
          if (tool === "eraser") schedulePaint();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void insertFiles(files);
        }}
      />

      {editing && editingStyle ? (
        <textarea
          ref={textareaRef}
          aria-label="Text"
          value={editing.text}
          spellCheck={false}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              commitText();
            }
          }}
          className="absolute z-20 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre outline-2 outline-offset-4 outline-green/60 outline-dashed"
          style={editingStyle}
        />
      ) : null}

      {toolbarPos && selBox ? (
        <div
          role="toolbar"
          aria-label="Selection"
          className="absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border bg-card p-1 shadow-float"
          style={toolbarPos}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button size="sm" className="bg-green hover:bg-green/90" onClick={checkSelection}>
            <Sparkles /> Check math
          </Button>
          {onMakeFlashcard ? (
            <Button size="sm" variant="ghost" onClick={() => void makeFlashcard()} title="Make a flashcard from this">
              <GalleryVerticalEnd /> Flashcard
            </Button>
          ) : null}
          {(() => {
            if (readOnly) return null;
            const el = selected.length === 1 ? elements.find((x) => x.id === selected[0]) : undefined;
            if (el?.type === "kanban") {
              return (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={el.columns.length >= 6}
                    title={el.columns.length >= 6 ? "Boards have up to 6 columns" : undefined}
                    onClick={() => dispatch({ type: "update", elements: [addColumn(el, newId())] })}
                  >
                    <Columns3 /> Add column
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Rename board"
                    title="Rename board"
                    onClick={() => openKanban({ mode: "title", boardId: el.id })}
                  >
                    <Pencil />
                  </Button>
                </>
              );
            }
            if (el?.type !== "text" && el?.type !== "math" && el?.type !== "graph") return null;
            const label = el.type === "text" ? "Edit text" : el.type === "math" ? "Edit equation" : "Edit graph";
            return (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={label}
                title={label}
                onClick={() => {
                  if (el.type === "text") startEditing({ x: el.x, y: el.y }, el);
                  else if (el.type === "math") openEquation({ x: el.x, y: el.y }, el);
                  else openGraph(el);
                }}
              >
                <Pencil />
              </Button>
            );
          })()}
          {(() => {
            const el = selected.length === 1 ? elements.find((x) => x.id === selected[0]) : undefined;
            return images && (el?.type === "gif" || el?.type === "video") ? <MediaControls el={el} cache={images} /> : null;
          })()}
          {selected.length > 0 && !readOnly ? (
            <>
              <Button size="icon-sm" variant="ghost" aria-label="Duplicate" onClick={duplicateSelection}>
                <Copy />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete selection"
                className="hover:text-destructive"
                onClick={deleteSelection}
              >
                <Trash2 />
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {equation && equationPos ? (
        <EquationEditor
          key={equation.existing?.id ?? `${equation.at.x},${equation.at.y}`}
          initial={equation.existing}
          color={equation.existing?.color ?? style.color}
          style={equationPos}
          onSubmit={submitEquation}
          onCancel={() => setEquation(null)}
        />
      ) : null}

      {graphEdit && graphPos ? (
        <GraphEditor
          key={graphEdit.id}
          element={graphEdit}
          style={graphPos}
          onPreview={setGraphPreview}
          onDone={(el) => finishGraphEdit(true, el)}
          onCancel={() => finishGraphEdit(false)}
        />
      ) : null}

      {kanbanEdit && kanbanView ? (
        <KanbanEditor
          key={`${kanbanEdit.mode}:${kanbanEdit.boardId}:${"columnId" in kanbanEdit ? kanbanEdit.columnId : ""}:${
            kanbanEdit.mode === "card" ? (kanbanEdit.cardId ?? kanbanEdit.newCardId) : ""
          }`}
          ref={kanbanEditorRef}
          edit={kanbanEdit}
          board={kanbanView.board}
          newCardId={kanbanEdit.newCardId}
          style={kanbanView.style}
          onCommit={(next) => dispatch({ type: "update", elements: [next] })}
          onClose={() => setKanbanEdit(null)}
        />
      ) : null}

      {math && mathPos ? (
        <MathCard
          state={math.state}
          style={mathPos}
          onClose={() => setMath(null)}
          onRetry={() => void runCheck(math.req.region, math.req.polygon)}
          onAddNote={addMathNote}
        />
      ) : null}

      {tool === "lasso" && !lassoRegion && !interacting ? (
        <p className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5 text-sm text-background">
          Draw a loop around the math you want to check
        </p>
      ) : null}

      <ZoomControls
        zoom={cam.z}
        onZoomIn={() => zoomAt(viewport.w / 2, viewport.h / 2, cam.z * 1.25)}
        onZoomOut={() => zoomAt(viewport.w / 2, viewport.h / 2, cam.z / 1.25)}
        onZoomTo={(z) => zoomAt(viewport.w / 2, viewport.h / 2, z)}
        onFit={() =>
          zoomToRect(padRect(contentBounds(elements) ?? { x: 0, y: 0, w: 400, h: 300 }, 40), 2)
        }
        onFitSelection={selected.length ? () => zoomToRect(selectionBox(selected), 4) : undefined}
      />
    </div>
  );
}

// ------------------------------------------------------------------ utils

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The stroke eraser leaves these alone (delete them with the selection instead). */
const UNERASABLE = new Set<CanvasElement["type"]>(["image", "gif", "video", "graph", "kanban", "eraser"]);

/** Corner drags keep these in proportion (Shift to stretch, or for a board: to change only its width). */
const KEEP_ASPECT = new Set<CanvasElement["type"]>(["image", "gif", "video", "text", "kanban"]);

/** A to-do card following the pointer, tilted a little, with a shadow. */
function drawDraggedCard(
  ctx: CanvasRenderingContext2D,
  inter: Extract<Interaction, { kind: "card" }>,
  elements: readonly CanvasElement[],
) {
  const board = elements.find((e) => e.id === inter.boardId);
  if (board?.type !== "kanban") return;
  const found = findCard(board, inter.cardId);
  if (!found) return;
  const box = kanbanLayout(board)
    .columns.find((c) => c.column.id === found.column.id)
    ?.cards.find((c) => c.card.id === inter.cardId);
  if (!box) return;
  const s = board.scale;
  const rect = { x: inter.at.x - inter.grab.x, y: inter.at.y - inter.grab.y, w: box.rect.w, h: box.rect.h };
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.035);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = "rgba(32,31,36,0.14)";
  ctx.beginPath();
  ctx.roundRect(rect.x + 3 * s, rect.y + 7 * s, rect.w, rect.h, 8 * s);
  ctx.fill();
  drawCard(ctx, { card: box.card, rect, lines: box.lines }, s, found.column.color, false);
  ctx.restore();
}

/** A detached copy of an in-progress element (new object, new arrays). */
function cloneDraft(d: CanvasElement): CanvasElement {
  if (d.type === "stroke") return { ...d, points: [...d.points], ...(d.pressures ? { pressures: [...d.pressures] } : {}) };
  if (d.type === "eraser") return { ...d, points: [...d.points] };
  return { ...d };
}

function corners(b: Rect): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
}

/** Someone else's pointer: an arrow and their name, the same size at any zoom. */
function drawPeerCursor(ctx: CanvasRenderingContext2D, at: Point, name: string, color: string, px: number) {
  const arrow = [
    [0, 0],
    [0, 17],
    [4.6, 12.6],
    [7.6, 19.4],
    [10.6, 18.1],
    [7.7, 11.6],
    [13.6, 11.6],
  ];
  ctx.beginPath();
  arrow.forEach(([x, y], i) => (i ? ctx.lineTo(at.x + x * px, at.y + y * px) : ctx.moveTo(at.x + x * px, at.y + y * px)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  const label = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  ctx.font = `700 ${12 * px}px "Public Sans Variable", ui-sans-serif, system-ui, sans-serif`;
  const w = ctx.measureText(label).width + 12 * px;
  const h = 20 * px;
  const x = at.x + 12 * px;
  const y = at.y + 19 * px;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6 * px);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, x + 6 * px, y + h / 2 + 0.5 * px);
}

function tracePolygon(ctx: CanvasRenderingContext2D, poly: readonly Point[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}
