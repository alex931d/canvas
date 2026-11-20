/** [a, b, c, d, e, f] as in CanvasRenderingContext2D.transform(). */
export type Matrix = [number, number, number, number, number, number];

type Paint = {
  /** null = the equation's own color; "none" = not filled. */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  m: Matrix;
};

export type MathOp =
  | ({ t: "path"; d: string } & Paint)
  | ({ t: "rect"; x: number; y: number; w: number; h: number } & Paint)
  | ({ t: "line"; x1: number; y1: number; x2: number; y2: number } & Paint)
  | ({ t: "text"; text: string; x: number; y: number; size: number; family: string; weight: string; style: string } & Paint);

/** A typeset equation in em units, origin at the top-left corner. */
export type MathLayout = { width: number; height: number; ops: MathOp[] };
