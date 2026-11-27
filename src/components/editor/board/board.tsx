"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
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
import type { AssetCache } from "@/lib/canvas/images";
import {
  addColumn,
  findCard,
  kanbanLayout,
  kanbanPartAt,
  type KanbanPart,
} from "@/lib/canvas/kanban";
import { useReducedMotion } from "motion/react";
import { ElementEffects } from "@/lib/canvas/effects";
import { KanbanEffects } from "@/lib/canvas/kanban-fx";
import type { RenderEnv } from "@/lib/canvas/render";
import {
  TEXT_LINE_HEIGHT,
  type CanvasElement,
  type FrameElement,
  type GraphElement,
  type KanbanElement,
  type MathElement,
  type TextElement,
} from "@/lib/canvas/schema";
import type { MathCheck } from "@/lib/ai/math-check-schema";
import type { HistoryAction } from "@/lib/collab/doc";
import type { PeerDrafts } from "@/lib/collab/peer-drafts";
import type { Peer } from "@/lib/collab/peers";
import { subscribeMath, texSource, typesetMath } from "@/lib/math/layout";
import type { FigurePart } from "@/lib/math/figures";
import type { MemberFeature } from "@/lib/billing/plan";
import type { DrawEffect } from "@/lib/preferences";
import { publishScene, publishView } from "@/lib/canvas/view-bus";
import { EquationEditor, type EquationValue } from "../equation-editor";
import { GraphEditor } from "../graph-editor";
import { KanbanEditor, type KanbanEdit, type KanbanEditorHandle } from "../kanban-editor";
import { MathCard, type MathState } from "../math-card";
import { MEDIA_ACCEPT, type Style, type Tool } from "../tools";
import { ZoomControls } from "../zoom-controls";
import { Camera, CameraMemory, type Size } from "./camera";
import { BoardClipboard, cloneElements } from "./clipboard";
import { DraftSession } from "./drafts";
import { frameBox, hitForSelect, nextSlide, withFrameContents } from "./frames";
import { corners } from "./overlays";
import { AvatarImages } from "./avatars";
import { BoardPainter, type PaintFrame } from "./painter";
import {
  equationEditorSpot,
  graphEditorSpot,
  kanbanEditorSpot,
  mathCardSpot,
  selectionToolbarSpot,
  textEditorStyle,
} from "./placement";
import { SelectionToolbar } from "./selection-toolbar";
import { Shortcuts, type BoardCommand } from "./shortcuts";
import type {
  BoardHandle,
  ClickAction,
  EquationEdit,
  FlashcardCapture,
  Handle,
  Interaction,
  MathRequest,
  TextEdit,
  TracedPicture,
} from "./types";
import { mathCheckImage, mathNote, regionBlob, selectionScene, textOf } from "./capture";
import { cardMoveResult, cardTargetAt, kanbanById, newBoardAt } from "./kanban-drag";
import { MediaImporter, isMediaFile, tracedStrokes } from "./media";
import { clamp, isEditableTarget, KEEP_ASPECT, newId, round1, UNERASABLE } from "./util";

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
  mathCheckLocked = false,
  onLocked,
  readOnly = false,
  drawEffect = "off",
  boardEffects = false,
  peers = [],
  onPointerWorld,
  onSelectionChange,
  onMakeFlashcard,
  onTracePicture,
  onOpenFrame,
  onPresentFrame,
  onDraft,
  peerDrafts,
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
  /** Checking math is part of the membership and this person isn't a member: offer it instead. */
  mathCheckLocked?: boolean;
  /** They reached for something that's part of the membership. */
  onLocked?: (feature: MemberFeature) => void;
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
  /** A frame's title was double-clicked: show it in the slides panel. */
  onOpenFrame?: (id: string) => void;
  /** Present the slides, starting from this frame. */
  onPresentFrame?: (id: string) => void;
  /** The stroke or shape being drawn here (changed in place as it grows), or null when it ends: shared live. */
  onDraft?: (draft: CanvasElement | null) => void;
  /** What other people are drawing right now, to draw as it grows. */
  peerDrafts?: PeerDrafts;
  ref?: Ref<BoardHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cam, setCam] = useState<Camera>(Camera.initial);
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
    peerDrafts: undefined as PeerDrafts | undefined,
    readOnly: false,
  });
  const interRef = useRef<Interaction>({ kind: "none" });
  const overridesRef = useRef<Map<string, CanvasElement> | null>(null);
  const hiddenRef = useRef(new Set<string>());
  const pointersRef = useRef(new Map<number, Point>());
  const hoverRef = useRef<Point | null>(null);
  /** The frame whose title or edge is under the pointer (select tool). */
  const frameHoverRef = useRef<string | null>(null);
  const spaceRef = useRef(false);
  const camReadyRef = useRef(false);
  const checkAfterLassoRef = useRef(false);
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
      peerDrafts,
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
    frameLabel: (el) => el.title,
    // Selected frames and the one under the pointer: drawn stronger.
    get activeFrameIds() {
      const ids = new Set(propsRef.current.selected);
      if (frameHoverRef.current) ids.add(frameHoverRef.current);
      return ids;
    },
  };
  /** For pictures of the board (checking maths, flashcards): no frame outlines. */
  const pictureEnv = (): RenderEnv => ({ getImage: env.getImage, getMedia: env.getMedia });

  // ------------------------------------------------------------- helpers

  /** The canvas's size in CSS pixels. */
  const canvasSize = (): Size => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    return { w: (canvas?.width ?? 0) / dpr, h: (canvas?.height ?? 0) / dpr };
  };
  const screenToWorld = (sx: number, sy: number): Point => camRef.current.toWorld(sx, sy);
  const worldToScreen = (p: Point): Point => camRef.current.toScreen(p);
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

  const [painter] = useState(() => new BoardPainter());
  const paint = painter.paint;
  const schedulePaint = painter.schedule;

  /** One painted frame's worth of the board, read from refs (so the painter never needs remaking). */
  const readFrame = (): PaintFrame | null => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return null;
    const p = propsRef.current;
    const inter = interRef.current;
    const hidden = hiddenRef.current;
    const elements = liveElements();
    const hover = hoverRef.current;
    return {
      canvas,
      wrap,
      cam: camRef.current,
      background: p.background,
      env,
      elements,
      skip: p.editingId ? new Set([...hidden, p.editingId]) : hidden,
      // A fresh copy each frame, so render caches never hold a half-finished shape.
      draft: inter.kind === "draw" ? inter.session.snapshot() : null,
      peerDrafts: drawnPeerDrafts(),
      fx: fxRef.current,
      overlay: {
        interaction: inter,
        elements,
        committed: elementsRef.current,
        selected: p.selected,
        selectionBox: selectionBox(p.selected),
        lassoRegion: p.lassoRegion,
        eraser: p.tool === "eraser" && hover && !spaceRef.current ? { at: hover, size: p.style.eraserSize } : null,
        peers: p.peers,
        avatar: (peer) => (peer.avatarUrl ? AvatarImages.shared.get(peer.avatarUrl, schedulePaint) : null),
      },
    };
  };

  /** Ids on the board now, for telling which peers' drafts have landed. */
  const elementIdsRef = useRef<Set<string>>(new Set());
  useLayoutEffect(() => {
    elementIdsRef.current = new Set(elements.map((e) => e.id));
  }, [elements]);
  // A draft whose finished element never comes (someone's click, not a stroke) goes after a moment.
  useEffect(() => {
    if (!peers.length) return;
    const t = setTimeout(schedulePaint, 1700);
    return () => clearTimeout(t);
  }, [peers, schedulePaint]);
  /**
   * Other people's strokes and shapes as they draw them. Each is noted as
   * already on screen, so it doesn't play an entrance when it lands.
   */
  const drawnPeerDrafts = () => {
    const drafts = propsRef.current.peerDrafts;
    if (!drafts) return [];
    const ids = elementIdsRef.current;
    const list = drafts.visible((id) => ids.has(id));
    for (const d of list) ownAddsRef.current.add(d.id);
    return list;
  };
  useLayoutEffect(() => painter.connect(readFrame));

  useEffect(() => {
    schedulePaint();
  }, [elements, cam, selected, lassoRegion, editing, imageVersion, background, tool, style, ready, graphPreview, peers, schedulePaint]);

  // ------------------------------------------------------------ effects

  /** The part of the drawing on screen, in world coordinates. */
  const viewRect = useCallback((): Rect => camRef.current.view(canvasSize()), []);

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
      if (painter.cursors.moving) schedulePaint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peers, painter, schedulePaint]);

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

  useEffect(() => () => painter.dispose(), [painter]);

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

  const cameraMemory = useMemo(() => new CameraMemory(drawingId), [drawingId]);

  const applyCam = useCallback(
    (next: Camera) => {
      camRef.current = next;
      setCam(next);
      schedulePaint();
      // The study buddies walking on the canvas follow it in the same frame.
      publishView(next);
    },
    [schedulePaint],
  );
  useEffect(() => () => publishView(null), []);
  // …and what's drawn, so they can keep off it.
  useEffect(() => publishScene(elements), [elements]);
  useEffect(() => () => publishScene(null), []);

  /** Zoom to `z`, keeping what's under the screen point (sx, sy) in place. */
  const zoomAt = useCallback(
    (sx: number, sy: number, z: number) => applyCam(camRef.current.zoomedAt(sx, sy, z)),
    [applyCam],
  );

  /** Fit a rectangle on screen (zoomed in no further than `maxZ`), beside a panel covering the right. */
  const zoomToRect = useCallback(
    (r: Rect | null, maxZ = 1, coveredRight = 0) => {
      if (!canvasRef.current || !r) return;
      applyCam(Camera.fitting(r, canvasSize(), maxZ, coveredRight));
    },
    [applyCam],
  );

  // Remember the view per drawing (per device): debounced while moving,
  // and flushed when leaving so a quick navigation doesn't lose it.
  const saveCamera = useCallback(() => {
    if (camReadyRef.current) cameraMemory.save(camRef.current);
  }, [cameraMemory]);

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
        const saved = cameraMemory.load();
        if (saved) {
          applyCam(saved);
        } else {
          const b = contentBounds(elementsRef.current);
          if (b) zoomToRect(padRect(b, 40), 1);
          else applyCam(new Camera(-width / 2 + 200, -80, 1));
        }
      }
      paint();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [applyCam, zoomToRect, paint, cameraMemory]);

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
        applyCam(c.panned(dx * unit, dy * unit));
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

  /** Put a new board where the pointer is, sized to look the same at any zoom, and ask for its first card. */
  const placeKanban = (p: Point) => {
    const board = newBoardAt(p, camRef.current.z);
    dispatch({ type: "add", elements: [board] });
    setTool("select");
    openKanban({ mode: "card", boardId: board.id, columnId: board.columns[0].id, cardId: null });
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
      const dataUrl = mathCheckImage(elementsRef.current, propsRef.current.background, region, polygon, pictureEnv());

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
    if (mathCheckLocked) return void onLocked?.("math-check");
    if (lassoRegion && lassoRegion.length > 2) {
      const b = polygonBounds(lassoRegion);
      if (b) return void runCheck(padRect(b, 8), lassoRegion);
    }
    const box = selectionBox(selected);
    if (box) return void runCheck(padRect(box, 16), null);
  };

  /** The selection (or lasso) as a picture: only what's selected, or everything inside the loop. */
  const captureSelection = async (): Promise<FlashcardCapture | null> => {
    const what = selectionScene(elementsRef.current, selected, lassoRegion);
    if (!what) return null;
    const picture = await regionBlob(what.scene, propsRef.current.background, what.region, what.polygon, pictureEnv());
    return picture ? { ...picture, text: textOf(what.chosen) } : null;
  };

  const makeFlashcard = async () => {
    const capture = await captureSelection();
    if (capture) onMakeFlashcard?.(capture);
  };

  const addMathNote = (result: MathCheck) => {
    if (!math) return;
    const note = mathNote(result, math.req.region);
    dispatch({ type: "add", elements: [note] });
    setSelected([note.id]);
    setLassoRegion(null);
    setMath(null);
  };

  // ---------------------------------------------------- images, GIFs, videos

  const insertFiles = useCallback(
    async (files: File[], at?: Point) => {
      const cache = propsRef.current.images;
      if (!cache || !canvasRef.current) return;
      const c = camRef.current;
      const view = c.view(canvasSize());
      const added = await new MediaImporter(cache).import(files, at ?? c.center(canvasSize()), view, c.z);
      if (!added.length) return;
      dispatch({ type: "add", elements: added });
      setSelected(added.map((a) => a.id));
      setLassoRegion(null);
      setTool("select");
    },
    [dispatch, setTool],
  );

  /** Traced strokes, placed like a picture, as one change that one undo removes. */
  const insertTraced = (picture: TracedPicture): number => {
    if (!canvasRef.current || picture.strokes.length === 0) return 0;
    const added = tracedStrokes(picture, camRef.current.view(canvasSize()), propsRef.current.style.color);
    dispatch({ type: "add", elements: added });
    setSelected(added.map((a) => a.id));
    setLassoRegion(null);
    setTool("select");
    return added.length;
  };

  /**
   * A figure from the math or chemistry tools, as one change that one undo
   * removes: in the middle of the view (moved down past what's there),
   * selected, and zoomed out to fit when it's bigger than the view. Frames
   * in it become the next slides. Returns the new ids.
   */
  const insertFigure = (parts: FigurePart[], coveredRight = 0): string[] => {
    if (readOnly || parts.length === 0) return [];
    const slides = nextSlide(elementsRef.current);
    let order = slides.order;
    const els = parts.map((p) => {
      const el = { ...p, id: newId() } as CanvasElement;
      if (el.type === "frame") el.order = order++;
      return el;
    });
    const box = unionRects(els.map(elementBounds));
    if (!box) return [];
    const c = camRef.current;
    // A side panel over the right of the board: centre in what's left.
    const covered = coveredRight < viewport.w * 0.6 ? coveredRight : 0;
    const center = { x: c.x + (viewport.w - covered) / 2 / c.z, y: c.y + viewport.h / 2 / c.z };
    let at = { x: round1(center.x - box.w / 2), y: round1(center.y - box.h / 2) };
    const boxes = elementsRef.current.filter((e) => e.type !== "eraser").map(elementBounds);
    for (let i = 0; i < 20; i++) {
      const placed = padRect({ ...at, w: box.w, h: box.h }, 24);
      const hit = boxes.find((r) => rectsIntersect(r, placed));
      if (!hit) break;
      at = { x: at.x, y: round1(hit.y + hit.h + 48) };
    }
    const dx = at.x - box.x;
    const dy = at.y - box.y;
    const moved = els.map((el) => translateElement(el, dx, dy));
    dispatch({ type: "add", elements: moved });
    setSelected(moved.map((e) => e.id));
    setLassoRegion(null);
    setTool("select");
    const placed = { ...at, w: box.w, h: box.h };
    const view = { x: c.x, y: c.y, w: (viewport.w - covered) / c.z, h: viewport.h / c.z };
    if (!rectContainsRect(view, placed)) zoomToRect(padRect(placed, 40), c.z, covered);
    return moved.map((e) => e.id);
  };

  /** A new frame's box in the frame tool's shape: around `content`, or most of the view around `at`. */
  const frameAround = (at: Point, content: Rect | null): Rect =>
    frameBox(at, content, propsRef.current.style.frameAspect, viewport, camRef.current.z);

  const goToFrame = (id: string, coveredRight = 0) => {
    const frame = elementsRef.current.find((el) => el.id === id);
    if (!frame || frame.type !== "frame") return;
    zoomToRect(elementBox(frame), 8, coveredRight);
    setSelected([id]);
    setLassoRegion(null);
  };

  const frameSelection = () => {
    if (readOnly) return null;
    const set = new Set(selected);
    const content =
      lassoRegion && lassoRegion.length > 2
        ? polygonBounds(lassoRegion)
        : unionRects(elementsRef.current.filter((el) => set.has(el.id) && el.type !== "eraser").map(elementBounds));
    const c = camRef.current;
    const center = { x: c.x + viewport.w / 2 / c.z, y: c.y + viewport.h / 2 / c.z };
    const frame: FrameElement = {
      id: newId(),
      type: "frame",
      ...frameAround(center, content),
      ...nextSlide(elementsRef.current),
    };
    ownAddsRef.current.add(frame.id);
    dispatch({ type: "add", elements: [frame] });
    setSelected([frame.id]);
    setLassoRegion(null);
    setTool("select");
    return frame.id;
  };

  useImperativeHandle(ref, () => ({
    goToFrame,
    frameSelection,
    insertFiles: (files) => void insertFiles(files),
    insertTraced,
    insertMath,
    insertFigure,
    startMathCheck: () => {
      if (mathCheckLocked) onLocked?.("math-check");
      else if (selected.length > 0 || (lassoRegion && lassoRegion.length > 2)) checkSelection();
      else {
        checkAfterLassoRef.current = true;
        setTool("lasso");
      }
    },
  }));

  // ------------------------------------------------------------ pointer

  const hitTolerance = () => 6 / camRef.current.z;

  /** What a select-tool click lands on: a frame's title first, then the topmost thing drawn. */
  const hitAt = (p: Point) => hitForSelect(elementsRef.current, p, camRef.current.z, hitTolerance());

  /** These elements, and what's inside any frame among them. */
  const carried = (ids: ReadonlySet<string>) => withFrameContents(elementsRef.current, ids);

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

  /** A stroke or shape starting at `p` with the current tool, held over a picture of the scene. */
  const startDrawing = (p: Point, e: React.PointerEvent) => {
    const session = DraftSession.start(tool, p, style, {
      pressure: e.pointerType === "pen" && e.pressure > 0 ? e.pressure : undefined,
      slide: () => nextSlide(elementsRef.current),
    });
    if (!session) return false;
    holdScene();
    interRef.current = { kind: "draw", session };
    onDraft?.(session.draft);
    setSelected([]);
    setLassoRegion(null);
    return true;
  };

  /** While a stroke is drawn, the rest of the scene is a still picture (effects settled first). */
  const holdScene = () =>
    painter.hold(() => {
      fxRef.current?.finishAll();
      kanbanFxRef.current?.dispose();
    });

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
      painter.release();
      if (interRef.current.kind === "draw") onDraft?.(null);
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
        const hit = hitAt(p);
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
            // Alt moves a frame without what's in it.
            originals: readOnly ? [] : e.altKey ? elementsRef.current.filter((el) => set.has(el.id)) : carried(set),
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
        if (!startDrawing(p, e)) return;
        break;
      }
      case "eraser":
        if (style.eraserMode === "stroke") {
          interRef.current = { kind: "erase" };
          eraseAt(p);
          break;
        }
      // falls through: pixel eraser draws like a pen
      default:
        if (!startDrawing(p, e)) return;
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
          const hit = hitAt(p);
          const frameId = hit?.type === "frame" ? hit.id : null;
          if (frameId !== frameHoverRef.current) {
            frameHoverRef.current = frameId;
            schedulePaint();
          }
          if (!h) setCursor(hoverCursor(hit, p));
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
        applyCam(inter.cam0.pinched(inter.mid0, inter.dist0, mid, dist));
        return;
      }
      case "pan": {
        applyCam(inter.cam0.panned(inter.sx - sx, inter.sy - sy));
        return;
      }
      case "draw": {
        const session = inter.session;
        if (session.freehand) {
          const coalesced = e.nativeEvent.getCoalescedEvents?.();
          const events = coalesced && coalesced.length > 0 ? coalesced : [e.nativeEvent];
          const samples = events.map((ev) => {
            const q = eventPoint(ev);
            return { ...screenToWorld(q.sx, q.sy), pressure: ev.pressure };
          });
          const done = session.addSamples(samples, 0.75 / camRef.current.z);
          if (done) {
            // A very long stroke: what's drawn so far is added, and the stroke carries on as a new one.
            ownAddsRef.current.add(done.id);
            dispatch({ type: "add", elements: [done] });
            holdScene();
          }
        } else {
          session.reshape(p, e.shiftKey, style.frameAspect);
        }
        onDraft?.(session.draft);
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
        inter.target = cardTargetAt(elementsRef.current, inter.boardId, inter.cardId, p, camRef.current.z);
        // Preview: the card's slot opens up where it would land.
        const moved = cardMoveResult(elementsRef.current, inter.boardId, inter.cardId, inter.target);
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
    painter.release();
    if (inter.kind === "draw") onDraft?.(null);

    if (!cancelled) {
      switch (inter.kind) {
        case "draw": {
          const el = inter.session.finish(camRef.current.z, (at) => frameAround(at, null));
          if (!el) break;
          if (el.type === "graph") {
            dispatch({ type: "add", elements: [el] });
            openGraph(el);
          } else if (el.type === "frame") {
            ownAddsRef.current.add(el.id);
            dispatch({ type: "add", elements: [el] });
            setSelected([el.id]);
            setTool("select");
          } else {
            ownAddsRef.current.add(el.id);
            dispatch({ type: "add", elements: [el] });
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
            const board = kanbanById(elementsRef.current, inter.boardId);
            const found = board ? findCard(board, inter.cardId) : null;
            if (found) openKanban({ mode: "card", boardId: inter.boardId, columnId: found.column.id, cardId: inter.cardId });
            break;
          }
          // Recomputed from the latest boards, in case someone else changed them meanwhile.
          const moved = cardMoveResult(elementsRef.current, inter.boardId, inter.cardId, inter.target);
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
    const hit = tool === "select" ? hitAt(p) : hitTestAll(elementsRef.current, p, hitTolerance());
    if (hit?.type === "frame") onOpenFrame?.(hit.id);
    else if (hit?.type === "text") startEditing(p, hit);
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
    BoardClipboard.shared.copy(els);
    if (cut) deleteSelection();
    return true;
  };

  /** Do what a key asked, if it applies now. */
  const run = (command: BoardCommand, e: KeyboardEvent) => {
    const center = { w: viewport.w / 2, h: viewport.h / 2 };
    switch (command.kind) {
      case "select-all":
        e.preventDefault();
        setSelected(elementsRef.current.filter((el) => el.type !== "eraser").map((el) => el.id));
        setLassoRegion(null);
        setTool("select");
        break;
      case "duplicate":
        e.preventDefault();
        duplicateSelection();
        break;
      case "copy":
        if (copySelection(command.cut)) e.preventDefault();
        break;
      case "zoom":
        e.preventDefault();
        zoomAt(center.w, center.h, camRef.current.z * command.by);
        break;
      case "zoom-reset":
        e.preventDefault();
        zoomAt(center.w, center.h, 1);
        break;
      case "delete":
        if (selected.length) {
          e.preventDefault();
          deleteSelection();
        }
        break;
      case "escape":
        if (graphEdit) finishGraphEdit(false);
        setKanbanEdit(null);
        setEquation(null);
        setSelected([]);
        setLassoRegion(null);
        setMath(null);
        break;
      case "nudge": {
        if (!selected.length) break;
        e.preventDefault();
        const z = camRef.current.z;
        const set = new Set(selected);
        const moving = command.alone ? elementsRef.current.filter((el) => set.has(el.id)) : carried(set);
        dispatch({ type: "update", elements: moving.map((el) => translateElement(el, command.dx / z, command.dy / z)) });
        break;
      }
      case "fit-all":
        zoomToRect(padRect(contentBounds(elementsRef.current) ?? { x: 0, y: 0, w: 400, h: 300 }, 40), 2);
        break;
      case "fit-selection":
        zoomToRect(selectionBox(selected), 4);
        break;
      case "tool":
        setTool(command.tool);
        break;
      case "action":
        if (command.action === "media") fileInputRef.current?.click();
        else onTracePicture?.();
        break;
    }
  };

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.key === " " && !e.repeat) {
      spaceRef.current = true;
      setCursor("grab");
      e.preventDefault();
      return;
    }
    if (!ready) return;
    const command = Shortcuts.commandFor(e, readOnly);
    if (command) run(command, e);
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
    const files = [...dt.files].filter(isMediaFile);
    const c = camRef.current;
    const hover = hoverRef.current;
    if (files.length) {
      e.preventDefault();
      void insertFiles(files, hover ?? undefined);
      return;
    }
    const text = dt.getData("text/plain");
    const els = BoardClipboard.shared.read(text);
    if (els) {
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

  const sized = viewport.w > 0;
  const toolbarPos = selBox && sized ? selectionToolbarSpot(selBox, cam, viewport) : null;
  const mathPos = math && sized ? mathCardSpot(math.req.region, cam, viewport) : null;
  const equationPos = equation && sized ? equationEditorSpot(equation, cam, viewport) : null;
  const graphPos = graphEdit && sized ? graphEditorSpot(graphPreview ?? graphEdit, cam, viewport) : null;
  const kanbanView = (() => {
    if (!kanbanEdit || !sized) return null;
    const board = elements.find((e) => e.id === kanbanEdit.boardId);
    if (board?.type !== "kanban") return null;
    const spot = kanbanEditorSpot(board, kanbanEdit, cam, viewport);
    return spot ? { board, style: spot } : null;
  })();
  const editingStyle = editing ? textEditorStyle(editing, style, cam) : null;

  return (
    <div
      ref={wrapRef}
      // Study buddies on the canvas live in here (src/components/buddy/canvas-buddies.tsx).
      data-buddy-stage
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
          frameHoverRef.current = null;
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
        <SelectionToolbar
          position={toolbarPos}
          selected={selected}
          single={selected.length === 1 ? (elements.find((x) => x.id === selected[0]) ?? null) : null}
          readOnly={readOnly}
          images={images}
          onCheck={checkSelection}
          checkLocked={mathCheckLocked}
          onFlashcard={onMakeFlashcard ? () => void makeFlashcard() : undefined}
          onPresent={onPresentFrame}
          onRenameFrame={onOpenFrame}
          onAddColumn={(board) => dispatch({ type: "update", elements: [addColumn(board, newId())] })}
          onRenameBoard={(board) => openKanban({ mode: "title", boardId: board.id })}
          onEdit={(el) => {
            if (el.type === "text") startEditing({ x: el.x, y: el.y }, el);
            else if (el.type === "math") openEquation({ x: el.x, y: el.y }, el);
            else if (el.type === "graph") openGraph(el);
          }}
          onDuplicate={duplicateSelection}
          onDelete={deleteSelection}
        />
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

