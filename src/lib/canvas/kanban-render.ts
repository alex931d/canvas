import { KANBAN, KANBAN_FONT, fitLine, kanbanLayout, progress, type CardBox } from "./kanban";
import type { KanbanElement } from "./schema";

/** Canvas drawing for to-do boards (world coordinates, like render.ts). */

type Ctx = CanvasRenderingContext2D;

/** How one card is drawn mid-animation: offset from its slot, size, opacity, and how much of its done line shows. */
export type CardFx = { dx: number; dy: number; scale: number; alpha: number; strike: number };

/** To-do board animations as the renderer reads them (src/lib/canvas/kanban-fx.ts). */
export type KanbanFxView = {
  card(boardId: string, cardId: string): CardFx | undefined;
  /** The share of cards done that the progress bar shows right now. */
  progress(boardId: string): number | undefined;
};

const INK = "#201f24";
const MUTED = "#696868";
const PANEL = "#f8f4f0";
const PANEL_EDGE = "#e6dfd7";
const CARD_EDGE = "#e7e1da";

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawKanban(
  ctx: Ctx,
  el: KanbanElement,
  placeholderCardId: string | null = null,
  fx: KanbanFxView | null = null,
) {
  const K = KANBAN;
  const s = el.scale;
  const l = kanbanLayout(el);

  // Panel with a soft drop shadow (canvas shadows ignore the zoom, so fake it).
  ctx.fillStyle = "rgba(32,31,36,0.06)";
  ctx.beginPath();
  ctx.roundRect(l.x, l.y + 3 * s, l.w, l.h, 14 * s);
  ctx.fill();
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.roundRect(l.x, l.y, l.w, l.h, 14 * s);
  ctx.fill();
  ctx.stroke();

  // Title, and how much is done on the right.
  const { total, done } = progress(el);
  const summary = total === 0 ? "No tasks yet" : el.columns.length > 1 ? `${done} of ${total} done` : `${total} ${total === 1 ? "task" : "tasks"}`;
  ctx.textBaseline = "middle";
  const ty = l.title.y + l.title.h / 2;
  const smallFont = `600 ${K.headFont * s}px ${KANBAN_FONT}`;
  ctx.font = smallFont;
  const summaryW = ctx.measureText(summary).width;
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.fillText(summary, l.title.x + l.title.w, ty);
  ctx.textAlign = "left";
  const titleFont = `700 ${K.titleFont * s}px ${KANBAN_FONT}`;
  ctx.font = titleFont;
  ctx.fillStyle = INK;
  ctx.fillText(fitLine(el.title, l.title.w - summaryW - 16 * s, titleFont), l.title.x, ty);
  if (total > 0 && el.columns.length > 1) {
    // A thin progress bar under the title.
    const barY = l.title.y + l.title.h + 1 * s;
    ctx.fillStyle = "#e9e3dc";
    ctx.beginPath();
    ctx.roundRect(l.title.x, barY, l.title.w, 3 * s, 1.5 * s);
    ctx.fill();
    const shown = Math.min(1, Math.max(0, fx?.progress(el.id) ?? done / total));
    if (shown > 0.001) {
      ctx.fillStyle = el.columns[el.columns.length - 1].color;
      ctx.beginPath();
      ctx.roundRect(l.title.x, barY, l.title.w * shown, 3 * s, 1.5 * s);
      ctx.fill();
    }
  }

  const last = el.columns.length - 1;
  // Cards on their way to another slot go on top of every column, after them.
  const moving: { c: CardBox; color: string; done: boolean; f: CardFx }[] = [];
  l.columns.forEach((col, i) => {
    const r = col.rect;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10 * s);
    ctx.fill();
    ctx.fillStyle = hexA(col.column.color, 0.07);
    ctx.fill();

    // Header: colour dot, name, count.
    const hy = col.header.y + col.header.h / 2 + 1 * s;
    ctx.fillStyle = col.column.color;
    ctx.beginPath();
    ctx.arc(col.header.x + 14 * s, hy, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
    const headFont = `700 ${K.headFont * s}px ${KANBAN_FONT}`;
    ctx.font = smallFont;
    const count = String(col.column.cards.length);
    const countW = ctx.measureText(count).width;
    ctx.fillStyle = MUTED;
    ctx.textAlign = "right";
    ctx.fillText(count, col.header.x + col.header.w - 12 * s, hy);
    ctx.textAlign = "left";
    ctx.font = headFont;
    ctx.fillStyle = INK;
    ctx.fillText(fitLine(col.column.title, col.header.w - 44 * s - countW, headFont), col.header.x + 26 * s, hy);

    for (const c of col.cards) {
      const isDone = i === last && last > 0;
      if (c.card.id === placeholderCardId) {
        drawPlaceholder(ctx, c, s);
        continue;
      }
      const f = fx?.card(el.id, c.card.id);
      if (f && (Math.abs(f.dx) > 0.05 || Math.abs(f.dy) > 0.05)) moving.push({ c, color: col.column.color, done: isDone, f });
      else drawCardFx(ctx, c, s, col.column.color, isDone, f);
    }

    ctx.font = `600 ${K.headFont * s}px ${KANBAN_FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText("+ Add a card", col.add.x + 6 * s, col.add.y + col.add.h / 2);
  });
  for (const m of moving) drawCardFx(ctx, m.c, s, m.color, m.done, m.f);
  ctx.textAlign = "left";
}

function drawCardFx(ctx: Ctx, c: CardBox, s: number, color: string, done: boolean, f: CardFx | undefined) {
  if (!f) {
    drawCard(ctx, c, s, color, done);
    return;
  }
  if (f.alpha <= 0.001) return;
  const r = c.rect;
  ctx.save();
  ctx.translate(f.dx, f.dy);
  if (f.scale !== 1) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(f.scale, f.scale);
    ctx.translate(-cx, -cy);
  }
  ctx.globalAlpha *= Math.min(1, f.alpha);
  drawCard(ctx, c, s, color, done, f.strike);
  ctx.restore();
}

/**
 * One card: also used for the card that follows the pointer while dragging.
 * `strike` is how far across its text the done line has been drawn (0–1).
 */
export function drawCard(ctx: Ctx, c: CardBox, s: number, color: string, done: boolean, strike = 1) {
  const K = KANBAN;
  const r = c.rect;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = CARD_EDGE;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 8 * s);
  ctx.fill();
  ctx.stroke();
  // Colour stripe on the left edge.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, 3 * s, r.h);
  ctx.restore();

  ctx.font = `${K.cardFont * s}px ${KANBAN_FONT}`;
  ctx.fillStyle = done ? MUTED : INK;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const x = r.x + K.cardPadX * s;
  c.lines.forEach((line, i) => {
    const y = r.y + (K.cardPadY + K.cardLine * i + K.cardLine / 2) * s;
    ctx.fillText(line, x, y);
    if (done && line && strike > 0.001) {
      const w = ctx.measureText(line).width;
      ctx.fillRect(x, y + 0.5 * s, w * Math.min(1, strike), 1.2 * s);
    }
  });
}

function drawPlaceholder(ctx: Ctx, c: CardBox, s: number) {
  const r = c.rect;
  ctx.fillStyle = "rgba(39,124,120,0.07)";
  ctx.strokeStyle = "#277c78";
  ctx.lineWidth = 1.5 * s;
  ctx.setLineDash([6 * s, 4 * s]);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 8 * s);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}
