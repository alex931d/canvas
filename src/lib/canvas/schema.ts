import { z } from "zod";

/**
 * Shape of a drawing as stored in the `drawings.data` JSONB column.
 *
 * Version 2 is an infinite canvas: coordinates are "world units" with no
 * fixed board size, and the view (pan/zoom) is per device, not saved here.
 * Everything is vector data except images, which reference an uploaded asset
 * by id (bytes live in the `assets` table and in the browser's IndexedDB).
 *
 * Version 1 drawings (fixed 1600×1000 board) are upgraded on read by
 * `normalizeDrawing`; their coordinates carry over unchanged.
 *
 * Imported by both client (types) and server (validation): no server-only imports.
 */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color");
const coord = z.number().finite().min(-1e7).max(1e7);
const size = z.number().min(0.5).max(400);
const id = z.string().min(1).max(64);

/** rough.js options for the hand-drawn look. */
export const sketchSchema = z.object({
  seed: z.number().int().min(1).max(2 ** 31 - 1),
  roughness: z.number().min(0).max(4),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch", "zigzag", "dots"]),
});

/**
 * Pen brushes:
 *  - ink:         perfect-freehand outline, width follows pen pressure
 *  - marker:      even-width smooth line (also how v1 strokes render)
 *  - highlighter: wide, translucent, multiplies over what's below
 */
export const brushSchema = z.enum(["ink", "marker", "highlighter"]);

export const strokeElementSchema = z.object({
  id,
  type: z.literal("stroke"),
  color,
  size,
  brush: brushSchema.optional(),
  /** Flat list of points: [x0, y0, x1, y1, ...] */
  points: z.array(coord).min(2).max(40_000),
  /** Pen pressure per point (0–1), when the device reports it. */
  pressures: z.array(z.number().min(0).max(1)).max(20_000).optional(),
});

/** Pixel eraser: punches holes in everything drawn before it. */
export const eraserElementSchema = z.object({
  id,
  type: z.literal("eraser"),
  size,
  points: z.array(coord).min(2).max(40_000),
});

export const lineElementSchema = z.object({
  id,
  type: z.literal("line"),
  color,
  size,
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  arrow: z.boolean().optional(),
  sketch: sketchSchema.optional(),
});

export const rectElementSchema = z.object({
  id,
  type: z.literal("rect"),
  color,
  size,
  fill: color.nullable(),
  x: coord,
  y: coord,
  w: coord,
  h: coord,
  sketch: sketchSchema.optional(),
});

export const ellipseElementSchema = rectElementSchema.extend({
  type: z.literal("ellipse"),
});

export const fontSchema = z.enum(["sans", "hand", "mono"]);

export const textElementSchema = z.object({
  id,
  type: z.literal("text"),
  color,
  x: coord,
  y: coord,
  text: z.string().min(1).max(10_000),
  fontSize: z.number().min(4).max(800),
  font: fontSchema,
});

export const imageElementSchema = z.object({
  id,
  type: z.literal("image"),
  assetId: z.uuid(),
  x: coord,
  y: coord,
  w: z.number().positive().max(1e6),
  h: z.number().positive().max(1e6),
});

/**
 * A typeset equation. `syntax` "tex" is LaTeX; "chem" is mhchem notation
 * (rendered as \ce{source}: "2H2 + O2 -> 2H2O"). `size` is the font size in
 * world units; w and h are the typeset size at that font size, so bounds
 * never depend on whether the typesetter has loaded yet.
 */
export const mathElementSchema = z.object({
  id,
  type: z.literal("math"),
  syntax: z.enum(["tex", "chem"]),
  source: z.string().trim().min(1).max(2000),
  color,
  x: coord,
  y: coord,
  size: z.number().min(4).max(800),
  w: z.number().positive().max(1e6),
  h: z.number().positive().max(1e6),
});

export const graphFunctionSchema = z.object({
  /** A function of x as typed ("x^2 - 1", "sin(2x)"); see src/lib/math/expr.ts. */
  expr: z.string().trim().min(1).max(200),
  color,
});

const range = z.number().finite().min(-1e6).max(1e6);

/** A plot of up to six functions of x on a grid. */
export const graphElementSchema = z.object({
  id,
  type: z.literal("graph"),
  x: coord,
  y: coord,
  w: z.number().min(40).max(1e5),
  h: z.number().min(40).max(1e5),
  fns: z.array(graphFunctionSchema).min(1).max(6),
  xMin: range,
  xMax: range,
  yMin: range,
  yMax: range,
  grid: z.boolean(),
});

/** An animated GIF, kept byte-for-byte as uploaded so it keeps animating. */
export const gifElementSchema = imageElementSchema.extend({
  type: z.literal("gif"),
});

/** A video file (MP4, WebM or QuickTime). Playback is per viewer, not shared. */
export const videoElementSchema = imageElementSchema.extend({
  type: z.literal("video"),
});

export const kanbanCardSchema = z.object({
  id,
  text: z.string().trim().min(1).max(500),
});

export const kanbanColumnSchema = z.object({
  id,
  title: z.string().trim().min(1).max(60),
  color,
  cards: z.array(kanbanCardSchema).max(100),
});

/**
 * A to-do board: columns of cards that are dragged between columns (and
 * between boards). The last column counts as done. `w` is the width in world
 * units and `scale` sizes the text and spacing; the height follows from the
 * cards (see src/lib/canvas/kanban.ts), so it is never stored.
 */
export const kanbanElementSchema = z.object({
  id,
  type: z.literal("kanban"),
  x: coord,
  y: coord,
  w: z.number().min(10).max(1e6),
  scale: z.number().min(0.05).max(50),
  title: z.string().trim().min(1).max(120),
  columns: z.array(kanbanColumnSchema).min(1).max(6),
});

/**
 * A part of the canvas marked as a slide: presenting shows each frame in
 * turn, filling the screen (src/components/editor/presenter.tsx). Frames are
 * drawn behind everything else, and moving one moves what's inside it.
 */
export const frameElementSchema = z.object({
  id,
  type: z.literal("frame"),
  x: coord,
  y: coord,
  w: z.number().min(1).max(1e6),
  h: z.number().min(1).max(1e6),
  title: z.string().trim().min(1).max(80),
  /** Slide order, lowest first. Reordering gives one frame a number between two others. */
  order: z.number().finite(),
});

/** How a drawing's frames are presented (drawings.presentation; set in the Slides panel). */
export const presentationSchema = z.object({
  /** fade: one slide fades into the next; swipe: slides slide in from the side; journey: the camera flies across the canvas. */
  style: z.enum(["fade", "swipe", "journey"]),
  /** What's around a slide that doesn't fill the screen: dark, or the drawing's own background. */
  stage: z.enum(["dark", "paper"]),
  /** Show "3 / 12" in the corner. */
  numbers: z.boolean(),
});
export type Presentation = z.infer<typeof presentationSchema>;
export const DEFAULT_PRESENTATION: Presentation = { style: "fade", stage: "dark", numbers: true };

/** A stored presentation setting, or the defaults (unknown styles from newer versions fall back too). */
export function normalizePresentation(raw: unknown): Presentation {
  const parsed = presentationSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PRESENTATION;
}

export const elementSchema = z.discriminatedUnion("type", [
  strokeElementSchema,
  eraserElementSchema,
  lineElementSchema,
  rectElementSchema,
  ellipseElementSchema,
  textElementSchema,
  imageElementSchema,
  gifElementSchema,
  videoElementSchema,
  mathElementSchema,
  graphElementSchema,
  kanbanElementSchema,
  frameElementSchema,
]);

export const drawingDataSchema = z.object({
  version: z.literal(2),
  background: color,
  elements: z.array(elementSchema).max(20_000),
});

/** What older rows may contain. */
const drawingDataV1Schema = z.object({
  version: z.literal(1),
  width: z.number(),
  height: z.number(),
  background: color,
  elements: z.array(elementSchema),
});

export type Sketch = z.infer<typeof sketchSchema>;
export type Brush = z.infer<typeof brushSchema>;
export type FontKind = z.infer<typeof fontSchema>;
export type CanvasElement = z.infer<typeof elementSchema>;
export type StrokeElement = z.infer<typeof strokeElementSchema>;
export type EraserElement = z.infer<typeof eraserElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type MathElement = z.infer<typeof mathElementSchema>;
export type GraphElement = z.infer<typeof graphElementSchema>;
export type GraphFunction = z.infer<typeof graphFunctionSchema>;
export type GifElement = z.infer<typeof gifElementSchema>;
export type VideoElement = z.infer<typeof videoElementSchema>;
export type MediaElement = GifElement | VideoElement;
export type AssetElement = ImageElement | GifElement | VideoElement;
export type KanbanCard = z.infer<typeof kanbanCardSchema>;
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;
export type KanbanElement = z.infer<typeof kanbanElementSchema>;
export type FrameElement = z.infer<typeof frameElementSchema>;
export type ShapeElement = RectElement | EllipseElement;
export type DrawingData = z.infer<typeof drawingDataSchema>;

export function emptyDrawing(): DrawingData {
  return { version: 2, background: "#ffffff", elements: [] };
}

/** Upgrade whatever is stored to the current version. */
export function normalizeDrawing(raw: unknown): DrawingData {
  const v2 = drawingDataSchema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = drawingDataV1Schema.safeParse(raw);
  if (v1.success) {
    return { version: 2, background: v1.data.background, elements: v1.data.elements };
  }
  // Unreadable data shouldn't brick the editor; start empty rather than crash.
  console.warn("[canvas] stored drawing failed validation; opening it empty");
  return emptyDrawing();
}

export const FONT_FAMILIES: Record<FontKind, string> = {
  sans: '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif',
  hand: 'Caveat, "Comic Sans MS", cursive',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

export const TEXT_LINE_HEIGHT = 1.25;

/** Small image data URL used as the gallery preview. */
export const thumbnailSchema = z
  .string()
  .max(300_000, "Thumbnail too large")
  .regex(/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/, "Invalid thumbnail");

export const titleSchema = z.string().trim().min(1).max(120);

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ASSET_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES] as const;
/** Largest image or GIF file. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
/** Largest video file. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** Uploaded files across all the drawings one person owns. */
export const MAX_ACCOUNT_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

export const isVideoType = (mime: string) => (VIDEO_MIME_TYPES as readonly string[]).includes(mime);

export function isAssetElement(el: CanvasElement): el is AssetElement {
  return el.type === "image" || el.type === "gif" || el.type === "video";
}

/** Asset ids referenced by these elements (images, GIFs and videos). */
export function assetIdsOf(els: readonly CanvasElement[]): Set<string> {
  const ids = new Set<string>();
  for (const el of els) if (isAssetElement(el)) ids.add(el.assetId);
  return ids;
}
