import {
  ArrowUpRight,
  ChartSpline,
  Circle,
  Eraser,
  Frame,
  Hand,
  ImagePlus,
  Lasso,
  Minus,
  MousePointer2,
  Pen,
  ScanLine,
  Sigma,
  Square,
  SquareKanban,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { Brush, FontKind, Sketch } from "@/lib/canvas/schema";

export type Tool =
  | "select"
  | "lasso"
  | "hand"
  | "pen"
  | "eraser"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "equation"
  | "graph"
  | "kanban"
  | "frame";

/** A tool: its name, the key that picks it, its icon, and a few words for the tool search. */
export type ToolDef = { id: Tool; label: string; key: string; Icon: LucideIcon; hint: string; words?: string };

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", key: "v", Icon: MousePointer2, hint: "Pick things to move, resize or check", words: "move pointer" },
  { id: "lasso", label: "Lasso", key: "s", Icon: Lasso, hint: "Draw a loop around things to select them", words: "loop" },
  { id: "hand", label: "Pan", key: "h", Icon: Hand, hint: "Move around the board (or hold Space)", words: "hand scroll move" },
  { id: "pen", label: "Pen", key: "p", Icon: Pen, hint: "Draw freehand: ink, marker or highlighter", words: "draw brush pencil highlighter" },
  { id: "eraser", label: "Eraser", key: "e", Icon: Eraser, hint: "Rub out whole strokes, or just pixels", words: "rubber delete" },
  { id: "line", label: "Line", key: "l", Icon: Minus, hint: "Straight lines; Shift for 45° steps", words: "shape" },
  { id: "arrow", label: "Arrow", key: "a", Icon: ArrowUpRight, hint: "Lines with a head", words: "shape pointer" },
  { id: "rect", label: "Rectangle", key: "r", Icon: Square, hint: "Boxes; Shift keeps them square", words: "square box shape" },
  { id: "ellipse", label: "Ellipse", key: "o", Icon: Circle, hint: "Ovals; Shift keeps them round", words: "circle oval shape" },
  { id: "text", label: "Text", key: "t", Icon: Type, hint: "Type on the board", words: "write words note" },
  { id: "equation", label: "Equation", key: "m", Icon: Sigma, hint: "Typeset maths or chemistry", words: "math latex formula chemistry" },
  { id: "graph", label: "Graph", key: "g", Icon: ChartSpline, hint: "Plot functions of x", words: "plot chart function" },
  { id: "kanban", label: "To-do board", key: "k", Icon: SquareKanban, hint: "Columns of cards to plan with", words: "kanban tasks cards todo" },
  { id: "frame", label: "Frame", key: "f", Icon: Frame, hint: "Mark part of the board as a slide", words: "slide presentation present" },
];
/** What view-only collaborators can use. */
export const VIEW_TOOLS: Tool[] = ["select", "lasso", "hand"];

/** Things to put on the board that open a file picker rather than being a tool you draw with. */
export type ActionId = "media" | "trace";
export type ActionDef = { id: ActionId; label: string; key: string; Icon: LucideIcon; hint: string; words?: string };

export const IMAGE_ACTION: ActionDef = {
  id: "media",
  label: "Image or video",
  key: "i",
  Icon: ImagePlus,
  hint: "From your device (or paste or drop one)",
  words: "picture photo gif video upload",
};

/** A photo or screenshot of an equation, traced into pen strokes (trace-picture-dialog.tsx). */
export const TRACE_ACTION: ActionDef = {
  id: "trace",
  label: "Trace a picture",
  key: "u",
  Icon: ScanLine,
  hint: "A photo of an equation, as pen strokes",
  words: "photo scan equation handwriting",
};

/** A slot in the tool dock: one tool, or a group of related ones behind one button. */
export type ToolGroup = { id: string; label: string; items: (Tool | ActionId)[] };

/**
 * Every tool and action, how they're grouped in the dock, and which key
 * picks each. One for the app (a singleton): the dock, the tool search and
 * the board's shortcuts all ask it, so a new tool is added in one place.
 */
export class ToolRegistry {
  static readonly shared = new ToolRegistry();

  readonly tools: readonly ToolDef[] = TOOLS;
  readonly actions: readonly ActionDef[] = [IMAGE_ACTION, TRACE_ACTION];

  /** The dock's slots, left to right. Groups remember the last one used. */
  readonly groups: readonly ToolGroup[] = [
    { id: "pointer", label: "Select", items: ["select", "lasso", "hand"] },
    { id: "pen", label: "Pen", items: ["pen"] },
    { id: "eraser", label: "Eraser", items: ["eraser"] },
    { id: "shapes", label: "Shapes", items: ["rect", "ellipse", "line", "arrow"] },
    { id: "text", label: "Text", items: ["text"] },
    { id: "insert", label: "Insert", items: ["equation", "graph", "kanban", "frame", "media", "trace"] },
  ];

  private readonly byId = new Map(TOOLS.map((t) => [t.id, t] as const));
  private readonly byKey = new Map<string, ToolDef | ActionDef>([
    ...TOOLS.map((t) => [t.key, t] as const),
    ...[IMAGE_ACTION, TRACE_ACTION].map((a) => [a.key, a] as const),
  ]);

  private constructor() {}

  tool(id: Tool): ToolDef {
    return this.byId.get(id)!;
  }

  action(id: ActionId): ActionDef {
    return this.actions.find((a) => a.id === id)!;
  }

  isAction(id: Tool | ActionId): id is ActionId {
    return id === "media" || id === "trace";
  }

  /** The tool or action a single key picks, if any. */
  forKey(key: string): ToolDef | ActionDef | undefined {
    return this.byKey.get(key.toLowerCase());
  }

  /** View-only collaborators select, lasso and pan; nothing that changes the drawing. */
  allowed(id: Tool | ActionId, readOnly: boolean) {
    return !readOnly || (!this.isAction(id) && VIEW_TOOLS.includes(id));
  }

  /** The group a tool or action sits in. */
  groupOf(id: Tool | ActionId): ToolGroup | undefined {
    return this.groups.find((g) => g.items.includes(id));
  }
}

/** What the file pickers offer: pictures, GIFs and the video formats browsers play. */
export const MEDIA_ACCEPT = "image/*,video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov";

/** Drawing colours: the app palette plus white. */
export const SWATCHES = [
  { hex: "#201f24", name: "Ink" },
  { hex: "#c94736", name: "Red" },
  { hex: "#be6c49", name: "Orange" },
  { hex: "#cab361", name: "Gold" },
  { hex: "#277c78", name: "Green" },
  { hex: "#82c9d7", name: "Cyan" },
  { hex: "#3f82b2", name: "Blue" },
  { hex: "#626070", name: "Navy" },
  { hex: "#826cb0", name: "Purple" },
  { hex: "#f2cdac", name: "Sand" },
  { hex: "#ffffff", name: "White" },
] as const;

/** Each new curve on a graph takes the next of these. */
export const GRAPH_COLORS = ["#277c78", "#c94736", "#3f82b2", "#826cb0", "#be6c49", "#cab361"];

export type EraserMode = "stroke" | "pixel";

/** The shape new frames are drawn in: a screen, a classroom projector, a square post, or any. */
export type FrameAspect = "16:9" | "4:3" | "1:1" | "free";
export const FRAME_ASPECTS: { id: FrameAspect; label: string; ratio: number | null }[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "1:1", label: "Square", ratio: 1 },
  { id: "free", label: "Any", ratio: null },
];

export type Style = {
  color: string;
  penSize: number;
  brush: Brush;
  highlighterSize: number;
  eraserMode: EraserMode;
  eraserSize: number;
  shapeSize: number;
  fill: boolean;
  sketchy: boolean;
  roughness: number;
  fillStyle: Sketch["fillStyle"];
  font: FontKind;
  fontSize: number;
  frameAspect: FrameAspect;
};

export const DEFAULT_STYLE: Style = {
  color: "#201f24",
  penSize: 4,
  brush: "ink",
  highlighterSize: 22,
  eraserMode: "stroke",
  eraserSize: 24,
  shapeSize: 3,
  fill: false,
  sketchy: true,
  roughness: 1.2,
  fillStyle: "hachure",
  font: "hand",
  fontSize: 36,
  frameAspect: "16:9",
};

export const isShapeTool = (t: Tool) => t === "line" || t === "arrow" || t === "rect" || t === "ellipse";
export const isDrawingTool = (t: Tool) => t === "pen" || t === "eraser" || isShapeTool(t);
