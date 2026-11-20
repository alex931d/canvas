import {
  ArrowUpRight,
  ChartSpline,
  Circle,
  Eraser,
  Hand,
  ImagePlus,
  Lasso,
  Minus,
  MousePointer2,
  Pen,
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
  | "kanban";

export const TOOLS: { id: Tool; label: string; key: string; Icon: LucideIcon }[] = [
  { id: "select", label: "Select", key: "v", Icon: MousePointer2 },
  { id: "lasso", label: "Lasso", key: "s", Icon: Lasso },
  { id: "hand", label: "Pan", key: "h", Icon: Hand },
  { id: "pen", label: "Pen", key: "p", Icon: Pen },
  { id: "eraser", label: "Eraser", key: "e", Icon: Eraser },
  { id: "line", label: "Line", key: "l", Icon: Minus },
  { id: "arrow", label: "Arrow", key: "a", Icon: ArrowUpRight },
  { id: "rect", label: "Rectangle", key: "r", Icon: Square },
  { id: "ellipse", label: "Ellipse", key: "o", Icon: Circle },
  { id: "text", label: "Text", key: "t", Icon: Type },
  { id: "equation", label: "Equation", key: "m", Icon: Sigma },
  { id: "graph", label: "Graph", key: "g", Icon: ChartSpline },
  { id: "kanban", label: "To-do board", key: "k", Icon: SquareKanban },
];

/** What view-only collaborators can use. */
export const VIEW_TOOLS: Tool[] = ["select", "lasso", "hand"];

export const IMAGE_ACTION = { label: "Image or video", key: "i", Icon: ImagePlus };

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

export type EraserMode = "stroke" | "pixel";

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
};

export const isShapeTool = (t: Tool) => t === "line" || t === "arrow" || t === "rect" || t === "ellipse";
export const isDrawingTool = (t: Tool) => t === "pen" || t === "eraser" || isShapeTool(t);
