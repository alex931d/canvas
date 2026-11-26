/**
 * Turns a picture of writing (an equation, a formula, a sketch) into pen
 * strokes: the center lines of the ink, with a pen width that matches it.
 * Pure functions on RGBA pixels, so the editor runs them in the browser and
 * the unit tests run them in Node (e2e/unit.ts).
 *
 *   1. Ink or not, per pixel: each pixel is compared with the average of the
 *      pixels around it (Bradley's adaptive threshold), so shadows and uneven
 *      light in photos don't turn into ink, and it also has to be clearly
 *      darker than the paper. Light writing on a dark background (a
 *      blackboard, a dark-mode screenshot) is flipped first.
 *   2. Specks smaller than a fraction of a pen dot are dropped; pinholes in
 *      the ink are filled.
 *   3. The ink is thinned to lines one pixel wide (Zhang–Suen), and corner
 *      pixels that don't hold anything together are removed.
 *   4. The lines are walked into strokes (from loose ends, then out of
 *      junctions, then closed loops), short spurs from ragged edges are
 *      dropped, and each stroke is simplified (Ramer–Douglas–Peucker).
 *
 * Coordinates are in the input's pixels (pixel centers at +0.5).
 */

export type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type Box = { x: number; y: number; w: number; h: number };

export type TraceOptions = {
  /** 0–1: higher finds fainter lines (and more specks). Default 0.5. */
  detail?: number;
  /** Light ink on a dark background; "auto" (default) decides from the picture. */
  darkBackground?: boolean | "auto";
};

export type TracedStroke = {
  /** Flat [x0, y0, x1, y1, …]; a single point is a dot. */
  points: number[];
  /** Pen width that matches the ink under this stroke, in pixels. */
  size: number;
};

export type TraceResult = {
  strokes: TracedStroke[];
  /** The typical pen width, in pixels. */
  thickness: number;
  /** Whether it was read as light ink on a dark background. */
  darkBackground: boolean;
  /** Where the ink is, or null for none. */
  inkBox: Box | null;
};

/** More strokes than this is a photo of a page, not an equation. */
export const MAX_TRACED_STROKES = 2000;
/** Branches shorter than this many pen widths, hanging off a junction, are ragged edges. */
const SPUR = 0.6;
/** A stroke element holds at most this many points (schema: 40,000 coordinates). */
const MAX_POINTS_PER_STROKE = 19_999;

// ------------------------------------------------------------------ pixels

/** Brightness 0–255 per pixel, with transparent parts read as white paper. */
export function grayscale({ width, height, data }: Pixels): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    const a = data[p + 3] / 255;
    out[i] = Math.round(255 - a * (255 - lum));
  }
  return out;
}

function median(values: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of values) hist[v]++;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen * 2 >= values.length) return v;
  }
  return 255;
}

/** Light ink on a dark background? Most of a picture of writing is background. */
export function looksDark(gray: Uint8Array): boolean {
  return median(gray) < 110;
}

/** 1 where there's ink. */
export function inkMask(gray: Uint8Array, width: number, height: number, detail: number, dark: boolean): Uint8Array {
  const g = dark ? gray.map((v) => 255 - v) : gray;
  const W1 = width + 1;
  const sums = new Float64Array(W1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += g[y * width + x];
      sums[(y + 1) * W1 + x + 1] = sums[y * W1 + x + 1] + row;
    }
  }
  const half = Math.max(7, Math.round(Math.max(width, height) / 24));
  const t = 0.32 - 0.24 * detail; // how much darker than the neighbourhood ink must be
  const paper = median(g);
  const minContrast = 16 + (1 - detail) * 24; // and than the paper overall
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const v = g[y * width + x];
      if (v > paper - minContrast) continue;
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const sum = sums[y1 * W1 + x1] - sums[y0 * W1 + x1] - sums[y1 * W1 + x0] + sums[y0 * W1 + x0];
      const count = (x1 - x0) * (y1 - y0);
      if (v * count <= sum * (1 - t)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

// -------------------------------------------------------------- components

const N8 = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1];
const N4 = [0, -1, -1, 0, 1, 0, 0, 1];

/**
 * Connected regions where mask === value (8-connected for ink, 4 for
 * background). Calls `visit` with each region's pixels and whether it
 * touches the edge of the picture.
 */
function regions(
  mask: Uint8Array,
  width: number,
  height: number,
  value: 0 | 1,
  visit: (pixels: Int32Array, count: number, touchesEdge: boolean) => void,
) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const dirs = value === 1 ? N8 : N4;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || seen[start]) continue;
    let top = 0;
    let count = 0;
    let edge = false;
    stack[top++] = start;
    seen[start] = 1;
    const pixels: number[] = [];
    while (top > 0) {
      const i = stack[--top];
      pixels.push(i);
      count++;
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (let d = 0; d < dirs.length; d += 2) {
        const nx = x + dirs[d];
        const ny = y + dirs[d + 1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (mask[j] === value && !seen[j]) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    visit(Int32Array.from(pixels), count, edge);
  }
}

/** Typical ink width: area over half the outline (a long stroke's outline is twice its length). */
function roughThickness(mask: Uint8Array, width: number, height: number): number {
  let area = 0;
  let edge = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      area++;
      if (
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !mask[y * width + x - 1] || !mask[y * width + x + 1] || !mask[(y - 1) * width + x] || !mask[(y + 1) * width + x]
      ) {
        edge++;
      }
    }
  }
  return edge ? Math.max(1, (2 * area) / edge) : 1;
}

/** Drop specks and fill pinholes, in place. */
function clean(mask: Uint8Array, width: number, height: number) {
  const t = roughThickness(mask, width, height);
  const minSpeck = Math.max(3, Math.round(0.2 * t * t));
  regions(mask, width, height, 1, (pixels, count) => {
    if (count < minSpeck) for (const i of pixels) mask[i] = 0;
  });
  const maxHole = Math.max(2, Math.round(0.6 * t * t));
  regions(mask, width, height, 0, (pixels, count, edge) => {
    if (!edge && count <= maxHole) for (const i of pixels) mask[i] = 1;
  });
}

/** Where the ink is, after cleaning (for the dialog's first selection). Specks and things cut off at the edges don't count, unless that's all there is. */
export function findInk(pixels: Pixels, options: TraceOptions = {}): Box | null {
  const { width, height } = pixels;
  const gray = grayscale(pixels);
  const dark = options.darkBackground === "auto" || options.darkBackground === undefined ? looksDark(gray) : options.darkBackground;
  const mask = inkMask(gray, width, height, options.detail ?? 0.5, dark);
  clean(mask, width, height);
  const inner = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const all = { ...inner };
  const grow = (b: typeof inner, i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  };
  regions(mask, width, height, 1, (px, count, edge) => {
    for (let k = 0; k < count; k++) {
      grow(all, px[k]);
      if (!edge) grow(inner, px[k]);
    }
  });
  const b = Number.isFinite(inner.x0) ? inner : Number.isFinite(all.x0) ? all : null;
  return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 } : null;
}

// ---------------------------------------------------------------- thinning

/** Zhang–Suen thinning, in place: ink becomes lines one pixel wide. */
function thin(mask: Uint8Array, width: number, height: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
  let live: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) live.push(i);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const drop: number[] = [];
      for (const i of live) {
        const x = i % width;
        const y = (i - x) / width;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let a = 0;
        for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        drop.push(i);
      }
      if (drop.length) {
        changed = true;
        for (const i of drop) mask[i] = 0;
        live = live.filter((i) => mask[i]);
      }
    }
  }
  // Corners of staircases: a pixel whose neighbours still touch each other without it.
  const OFFS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (const i of live) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    const present = OFFS.filter(([dx, dy]) => at(x + dx, y + dy));
    if (present.length < 2 || present.length > 4) continue;
    const reached = [present[0]];
    const rest = present.slice(1);
    for (let k = 0; k < reached.length; k++) {
      for (let j = rest.length - 1; j >= 0; j--) {
        if (Math.abs(rest[j][0] - reached[k][0]) <= 1 && Math.abs(rest[j][1] - reached[k][1]) <= 1) {
          reached.push(rest[j]);
          rest.splice(j, 1);
        }
      }
    }
    if (rest.length === 0) mask[i] = 0;
  }
}

/** Distance from each ink pixel to the nearest paper (chamfer 1, √2). */
function distanceToPaper(mask: Uint8Array, width: number, height: number): Float32Array {
  const d = new Float32Array(mask.length);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const D = Math.SQRT2;
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x - 1, y) + 1, get(x, y - 1) + 1, get(x - 1, y - 1) + D, get(x + 1, y - 1) + D);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], get(x + 1, y) + 1, get(x, y + 1) + 1, get(x + 1, y + 1) + D, get(x - 1, y + 1) + D);
    }
  }
  return d;
}

// ----------------------------------------------------------------- tracing

/** Walks a one-pixel-wide skeleton into paths of pixel indices. */
function walk(skel: Uint8Array, width: number, height: number) {
  const neighbours = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    const out: number[] = [];
    // Orthogonal first: a path prefers them, which follows the line's own shape.
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && skel[ny * width + nx]) out.push(ny * width + nx);
    }
    return out;
  };
  const degree = new Uint8Array(skel.length);
  const pixels: number[] = [];
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue;
    pixels.push(i);
    degree[i] = neighbours(i).length;
  }
  const junction = (i: number) => degree[i] >= 3;
  const visited = new Uint8Array(skel.length);
  const linked = new Set<number>(); // junction-to-junction steps already taken
  const paths: number[][] = [];

  const follow = (from: number, to: number) => {
    const path = [from, to];
    if (!junction(from)) visited[from] = 1;
    let prev = from;
    let cur = to;
    while (!junction(cur)) {
      visited[cur] = 1;
      const options = neighbours(cur).filter((n) => n !== prev && (junction(n) || !visited[n]));
      if (!options.length) break;
      const next = options.find(junction) ?? options[0];
      path.push(next);
      prev = cur;
      cur = next;
    }
    paths.push(path);
  };

  // Loose ends, then the branches out of junctions, then closed loops.
  for (const i of pixels) {
    if (visited[i]) continue;
    if (degree[i] === 0) {
      visited[i] = 1;
      paths.push([i]);
    } else if (degree[i] === 1) {
      follow(i, neighbours(i)[0]);
    }
  }
  for (const i of pixels) {
    if (!junction(i)) continue;
    for (const n of neighbours(i)) {
      if (junction(n)) {
        const key = Math.min(i, n) * skel.length + Math.max(i, n);
        if (linked.has(key)) continue;
        linked.add(key);
        paths.push([i, n]);
      } else if (!visited[n]) {
        follow(i, n);
      }
    }
  }
  for (const i of pixels) {
    if (visited[i] || junction(i)) continue;
    const start = i;
    const next = neighbours(i).find((n) => !visited[n]);
    if (next === undefined) {
      visited[i] = 1;
      paths.push([i]);
      continue;
    }
    follow(start, next);
    const path = paths[paths.length - 1];
    const last = path[path.length - 1];
    if (path.length > 2 && neighbours(last).includes(start)) path.push(start); // close the loop
  }
  return { paths, junction };
}

/** Ramer–Douglas–Peucker on flat [x, y, …] points. */
export function simplify(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2], ay = points[a * 2 + 1];
    const bx = points[b * 2], by = points[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farDist = epsilon;
    for (let k = a + 1; k < b; k++) {
      const px = points[k * 2], py = points[k * 2 + 1];
      const dist = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (dist > farDist) {
        farDist = dist;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[k * 2], points[k * 2 + 1]);
  return out;
}

function pathLength(points: number[]) {
  let len = 0;
  for (let k = 2; k < points.length; k += 2) len += Math.hypot(points[k] - points[k - 2], points[k + 1] - points[k - 1]);
  return len;
}

/** The whole thing: pixels in, strokes out (see the top of this file). */
export function traceStrokes(pixels: Pixels, options: TraceOptions = {}): TraceResult {
  const { width, height } = pixels;
  const gray = grayscale(pixels);
  const dark = options.darkBackground === "auto" || options.darkBackground === undefined ? looksDark(gray) : options.darkBackground;
  const mask = inkMask(gray, width, height, options.detail ?? 0.5, dark);
  clean(mask, width, height);

  let inkBox: Box | null = null;
  {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (Number.isFinite(x0)) inkBox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  if (!inkBox) return { strokes: [], thickness: 1, darkBackground: dark, inkBox: null };

  const dist = distanceToPaper(mask, width, height);
  const skel = mask; // thinned in place
  thin(skel, width, height);

  // Pen width: twice the distance from the middle of the ink to its edge.
  const penFor = (pixelsOnLine: number[]) => {
    const radii = pixelsOnLine.map((i) => dist[i]).sort((a, b) => a - b);
    const radius = radii.length ? radii[Math.floor(radii.length / 2)] : 1;
    return Math.max(1, 2 * radius - 1);
  };
  const all: number[] = [];
  for (let i = 0; i < skel.length; i++) if (skel[i]) all.push(i);
  const thickness = penFor(all);

  const { paths, junction } = walk(skel, width, height);
  const strokes: TracedStroke[] = [];
  for (const path of paths) {
    const pts: number[] = [];
    for (const i of path) {
      const x = i % width;
      pts.push(x + 0.5, (i - x) / width + 0.5);
    }
    // A short whisker off a junction is a ragged edge, not a line.
    const atJunction = Number(junction(path[0])) + Number(junction(path[path.length - 1]));
    if (path.length > 1 && atJunction === 1 && pathLength(pts) < thickness * SPUR) continue;
    // Steps between the pixels of one crossing are covered by the lines' round ends.
    if (atJunction === 2 && pathLength(pts) < thickness) continue;
    // Each stroke keeps the weight of its own ink, in half-pixel steps: dots (a decimal point,
    // a multiplication dot, a radical's electrons) as big as they are; lines a little bolder or
    // lighter than the typical pen (a bold bar, a thin arrow shaft); short bits as the typical
    // pen, since the ink where lines meet is wider than either line.
    const length = pathLength(pts);
    const own = penFor(path);
    const dot = atJunction === 0 && length < thickness;
    const pen = dot
      ? Math.min(thickness * 3, Math.max(thickness * 0.5, own))
      : length < thickness * 2
        ? thickness
        : Math.min(thickness * 1.5, Math.max(thickness * 0.75, own));
    const size = Math.round(pen * 2) / 2;
    const simple = simplify(pts, 0.75);
    for (let k = 0; k < simple.length; k += MAX_POINTS_PER_STROKE * 2 - 2) {
      strokes.push({ points: simple.slice(k, k + MAX_POINTS_PER_STROKE * 2), size });
    }
  }
  return { strokes, thickness, darkBackground: dark, inkBox };
}
