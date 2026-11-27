import type { Point, Rect } from "@/lib/canvas/geometry";
import type { CanvasElement, MathElement, TextElement } from "@/lib/canvas/schema";
import type { FigurePart } from "@/lib/math/figures";
import type { Camera } from "./camera";
import type { DraftSession } from "./drafts";

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
  /**
   * Place a figure from the math or chemistry tools in the middle of the view
   * (left of `coveredRight` pixels taken by a side panel), selected. Returns the new ids.
   */
  insertFigure: (parts: FigurePart[], coveredRight?: number) => string[];
  /** Typeset and place an equation in the middle of the view. */
  insertMath: (value: Pick<MathElement, "syntax" | "source">) => Promise<void>;
  /** Bring a frame into view and select it, in the part of the board not covered on the right. */
  goToFrame: (id: string, coveredRight?: number) => void;
  /** A new frame around what's selected (or the view), in the frame tool's shape. Returns its id. */
  frameSelection: () => string | null;
};

export type Handle = "nw" | "ne" | "sw" | "se";

/** What a click (press and release without dragging) does. */
export type ClickAction = { kind: "add-card"; boardId: string; columnId: string } | { kind: "media"; id: string };

/** Where a dragged to-do card would land. */
export type CardTarget = { boardId: string; columnId: string; index: number };

/** What the pointer is doing on the board right now. */
export type Interaction =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; cam0: Camera }
  | { kind: "pinch"; dist0: number; mid0: Point; cam0: Camera }
  | { kind: "draw"; session: DraftSession }
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

export type TextEdit = {
  id: string;
  existing: TextElement | null;
  x: number;
  y: number;
  text: string;
};

export type MathRequest = { region: Rect; polygon: Point[] | null; token: number };

export type EquationEdit = { at: Point; existing: MathElement | null };
