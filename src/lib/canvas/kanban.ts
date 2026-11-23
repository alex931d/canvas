import type { KanbanCard, KanbanColumn, KanbanElement } from "./schema";

/**
 * To-do boards: layout, hit-testing and the card moves behind drag and drop.
 *
 * Everything is measured in base units at scale 1 and multiplied by the
 * element's `scale`, so a board looks the same at any size. Layouts are
 * cached per element object (elements are immutable).
 */

type Rect = { x: number; y: number; w: number; h: number };

export const KANBAN = {
  pad: 14,
  titleH: 36,
  titleFont: 17,
  colGap: 10,
  colPad: 8,
  headH: 32,
  headFont: 13,
  cardFont: 14,
  cardLine: 19,
  cardPadX: 10,
  cardPadY: 8,
  cardGap: 6,
  addH: 30,
  minColW: 120,
  defaultColW: 220,
} as const;

export const KANBAN_FONT = '"Public Sans Variable", ui-sans-serif, system-ui, sans-serif';

/** Column colours in a new board and for added columns (from the drawing palette). */
export const COLUMN_COLORS = ["#3f82b2", "#be6c49", "#277c78", "#826cb0", "#c94736", "#cab361"] as const;

export type CardBox = { card: KanbanCard; rect: Rect; lines: string[] };

export type ColumnBox = {
  column: KanbanColumn;
  /** The whole column, header to bottom (all columns share one height). */
  rect: Rect;
  header: Rect;
  cards: CardBox[];
  /** "+ Add a card", just under the last card. */
  add: Rect;
};

export type KanbanLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The width this many columns need at this scale. */
  minW: number;
  title: Rect;
  columns: ColumnBox[];
};

// ------------------------------------------------------------ text

let measureCtx: CanvasRenderingContext2D | null = null;

function textWidth(text: string, font: string): number {
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 7.6; // no canvas (server, tests): a rough average
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Word-wrap at `maxW` base units; words longer than a line are broken. */
export function wrapText(text: string, maxW: number, fontPx: number = KANBAN.cardFont): string[] {
  const font = `${fontPx}px ${KANBAN_FONT}`;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font) <= maxW) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // A single word wider than the line: split it by characters.
      if (textWidth(word, font) > maxW) {
        let part = "";
        for (const ch of word) {
          if (part && textWidth(part + ch, font) > maxW) {
            out.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      } else line = word;
    }
    out.push(line);
  }
  return out;
}

/** Truncate one line to fit, with an ellipsis. */
export function fitLine(text: string, maxW: number, font: string): string {
  if (textWidth(text, font) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid) + "…", font) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

// ------------------------------------------------------------ layout

let layoutCache = new WeakMap<KanbanElement, KanbanLayout>();

/** Forget measurements (call when web fonts finish loading). */
export function resetKanbanLayouts() {
  layoutCache = new WeakMap();
}

export function kanbanMinWidth(columns: number, scale: number) {
  const K = KANBAN;
  return (K.pad * 2 + columns * K.minColW + (columns - 1) * K.colGap) * scale;
}

export function kanbanLayout(el: KanbanElement): KanbanLayout {
  const cached = layoutCache.get(el);
  if (cached) return cached;
  const K = KANBAN;
  const s = el.scale;
  const n = el.columns.length;
  const minW = kanbanMinWidth(n, s);
  const w = Math.max(el.w, minW);
  const colW = (w / s - K.pad * 2 - K.colGap * (n - 1)) / n; // base units
  const textW = colW - K.colPad * 2 - K.cardPadX * 2;
  const top = K.pad + K.titleH;

  // First pass: card heights and each column's content height.
  const measured = el.columns.map((column) => {
    let y = K.headH;
    const cards = column.cards.map((card) => {
      const lines = wrapText(card.text, textW);
      const h = lines.length * K.cardLine + K.cardPadY * 2;
      const box = { card, y, h, lines };
      y += h + K.cardGap;
      return box;
    });
    return { column, cards, addY: y, bottom: y + K.addH + K.colPad };
  });
  const colH = Math.max(...measured.map((m) => m.bottom));

  const columns: ColumnBox[] = measured.map((m, i) => {
    const cx = el.x + (K.pad + i * (colW + K.colGap)) * s;
    const cy = el.y + top * s;
    const inner = (K.colPad * 2) * s;
    return {
      column: m.column,
      rect: { x: cx, y: cy, w: colW * s, h: colH * s },
      header: { x: cx, y: cy, w: colW * s, h: K.headH * s },
      cards: m.cards.map((c) => ({
        card: c.card,
        lines: c.lines,
        rect: { x: cx + K.colPad * s, y: cy + c.y * s, w: colW * s - inner, h: c.h * s },
      })),
      add: { x: cx + K.colPad * s, y: cy + m.addY * s, w: colW * s - inner, h: K.addH * s },
    };
  });

  const layout: KanbanLayout = {
    x: el.x,
    y: el.y,
    w,
    h: (top + colH + K.pad) * s,
    minW,
    title: { x: el.x + K.pad * s, y: el.y + K.pad * s, w: w - K.pad * 2 * s, h: (K.titleH - 8) * s },
    columns,
  };
  layoutCache.set(el, layout);
  return layout;
}

// ------------------------------------------------------------ hit-testing

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export type KanbanPart =
  | { kind: "card"; columnId: string; cardId: string }
  | { kind: "add"; columnId: string }
  | { kind: "header"; columnId: string }
  | { kind: "title" }
  | { kind: "body" };

/** Which part of the board is at world point `p` (assumed inside the board). */
export function kanbanPartAt(el: KanbanElement, p: { x: number; y: number }): KanbanPart {
  const layout = kanbanLayout(el);
  if (inside(p, layout.title)) return { kind: "title" };
  for (const col of layout.columns) {
    if (!inside(p, col.rect)) continue;
    if (inside(p, col.header)) return { kind: "header", columnId: col.column.id };
    for (const c of col.cards) if (inside(p, c.rect)) return { kind: "card", columnId: col.column.id, cardId: c.card.id };
    if (inside(p, col.add)) return { kind: "add", columnId: col.column.id };
    return { kind: "body" };
  }
  return { kind: "body" };
}

/** Where a card dropped at `p` would go: a column and an index in it. */
export function dropSlot(el: KanbanElement, p: { x: number; y: number }): { columnId: string; index: number } {
  const layout = kanbanLayout(el);
  // The column under the pointer, or the nearest one.
  let best = layout.columns[0];
  let bestDist = Infinity;
  for (const col of layout.columns) {
    const r = col.rect;
    const d = p.x < r.x ? r.x - p.x : p.x > r.x + r.w ? p.x - (r.x + r.w) : 0;
    if (d < bestDist) {
      bestDist = d;
      best = col;
    }
  }
  let index = 0;
  for (const c of best.cards) if (p.y > c.rect.y + c.rect.h / 2) index++;
  return { columnId: best.column.id, index };
}

// ------------------------------------------------------------ editing

export function findCard(el: KanbanElement, cardId: string) {
  for (const column of el.columns) {
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { column, index, card: column.cards[index] };
  }
  return null;
}

export function withoutCard(el: KanbanElement, cardId: string): KanbanElement {
  return {
    ...el,
    columns: el.columns.map((c) =>
      c.cards.some((k) => k.id === cardId) ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) } : c,
    ),
  };
}

export function withCard(el: KanbanElement, columnId: string, index: number, card: KanbanCard): KanbanElement {
  return {
    ...el,
    columns: el.columns.map((c) => {
      if (c.id !== columnId) return c;
      const cards = [...c.cards];
      cards.splice(Math.max(0, Math.min(index, cards.length)), 0, card);
      return { ...c, cards };
    }),
  };
}

export type CardMove = {
  cardId: string;
  fromId: string;
  toId: string;
  columnId: string;
  index: number;
};

/**
 * Move a card within a board or onto another one. `index` counts cards in
 * the target column without the moved card. Returns the changed elements, or
 * null when nothing changes or the card or column is gone.
 */
export function moveCard(from: KanbanElement, to: KanbanElement, move: Omit<CardMove, "fromId" | "toId">): KanbanElement[] | null {
  const found = findCard(from, move.cardId);
  if (!found) return null;
  const sameBoard = from.id === to.id;
  const targetBase = sameBoard ? withoutCard(from, move.cardId) : to;
  const target = targetBase.columns.find((c) => c.id === move.columnId);
  if (!target) return null;
  if (sameBoard && found.column.id === move.columnId && found.index === Math.min(move.index, target.cards.length)) return null;
  if (!sameBoard && target.cards.length >= 100) return null;
  const placed = withCard(targetBase, move.columnId, move.index, found.card);
  return sameBoard ? [placed] : [withoutCard(from, move.cardId), placed];
}

export function updateCard(el: KanbanElement, cardId: string, text: string): KanbanElement {
  return {
    ...el,
    columns: el.columns.map((c) => ({ ...c, cards: c.cards.map((k) => (k.id === cardId ? { ...k, text } : k)) })),
  };
}

export function updateColumn(el: KanbanElement, columnId: string, patch: Partial<Pick<KanbanColumn, "title" | "color">>): KanbanElement {
  return { ...el, columns: el.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)) };
}

/** A new empty column at the end; the board grows so the others keep their width. */
export function addColumn(el: KanbanElement, id: string): KanbanElement {
  if (el.columns.length >= 6) return el;
  const layout = kanbanLayout(el);
  const colW = layout.columns[0]?.rect.w ?? KANBAN.defaultColW * el.scale;
  const used = new Set(el.columns.map((c) => c.color));
  const color = COLUMN_COLORS.find((c) => !used.has(c)) ?? COLUMN_COLORS[el.columns.length % COLUMN_COLORS.length];
  return {
    ...el,
    w: Math.round((layout.w + colW + KANBAN.colGap * el.scale) * 10) / 10,
    columns: [...el.columns, { id, title: "New column", color, cards: [] }],
  };
}

/** Remove a column; the board shrinks by one column's width. */
export function removeColumn(el: KanbanElement, columnId: string): KanbanElement {
  if (el.columns.length <= 1) return el;
  const layout = kanbanLayout(el);
  const colW = layout.columns[0]?.rect.w ?? 0;
  const columns = el.columns.filter((c) => c.id !== columnId);
  const w = Math.max(kanbanMinWidth(columns.length, el.scale), layout.w - colW - KANBAN.colGap * el.scale);
  return { ...el, w: Math.round(w * 10) / 10, columns };
}

/** Cards in the last column count as done. */
export function progress(el: KanbanElement) {
  const total = el.columns.reduce((n, c) => n + c.cards.length, 0);
  const done = el.columns.length > 1 ? el.columns[el.columns.length - 1].cards.length : 0;
  return { total, done };
}

export function newKanban(opts: { id: string; x: number; y: number; scale: number; ids: () => string }): KanbanElement {
  const K = KANBAN;
  const s = opts.scale;
  return {
    id: opts.id,
    type: "kanban",
    x: opts.x,
    y: opts.y,
    w: Math.round((K.pad * 2 + 3 * K.defaultColW + 2 * K.colGap) * s * 10) / 10,
    scale: s,
    title: "To-do",
    columns: [
      { id: opts.ids(), title: "To do", color: COLUMN_COLORS[0], cards: [] },
      { id: opts.ids(), title: "Doing", color: COLUMN_COLORS[1], cards: [] },
      { id: opts.ids(), title: "Done", color: COLUMN_COLORS[2], cards: [] },
    ],
  };
}
