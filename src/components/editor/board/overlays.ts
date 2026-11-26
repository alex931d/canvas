import { elementBounds, padRect, rectFromPoints, unionRects, type Point, type Rect } from "@/lib/canvas/geometry";
import { findCard, kanbanLayout } from "@/lib/canvas/kanban";
import { drawCard } from "@/lib/canvas/kanban-render";
import type { CanvasElement } from "@/lib/canvas/schema";
import type { Peer } from "@/lib/collab/peers";
import type { Interaction } from "./types";

/*
 * What's drawn over the drawing itself, the same thickness at any zoom:
 * selection boxes and handles, the lasso, the marquee, the eraser's ring,
 * a to-do card being dragged, and other people's selections and cursors.
 * Everything here is in world coordinates under the camera's transform;
 * `px` is one screen pixel.
 */

const ACCENT = "#277c78";

export function corners(b: Rect): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
}

export function tracePolygon(ctx: CanvasRenderingContext2D, poly: readonly Point[]) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

export type OverlayInput = {
  px: number;
  interaction: Interaction;
  /** Elements as shown (with a move or resize in progress applied). */
  elements: readonly CanvasElement[];
  /** Elements as committed (for a dragged card's board). */
  committed: readonly CanvasElement[];
  selected: readonly string[];
  selectionBox: Rect | null;
  lassoRegion: Point[] | null;
  /** The pixel eraser's ring, where the pointer is. */
  eraser: { at: Point; size: number } | null;
  peers: readonly Peer[];
  /** Where each peer's cursor is drawn this frame (see PeerCursors). */
  cursors: ReadonlyMap<string, Point>;
};

export function drawOverlays(ctx: CanvasRenderingContext2D, o: OverlayInput) {
  const { px, interaction: inter } = o;
  ctx.save();
  if (o.lassoRegion && o.lassoRegion.length > 2) {
    tracePolygon(ctx, o.lassoRegion);
    ctx.fillStyle = "rgba(39,124,120,0.06)";
    ctx.fill();
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.selectionBox && inter.kind !== "lasso" && inter.kind !== "marquee") {
    drawSelection(ctx, o.selectionBox, o.selected, o.elements, !o.lassoRegion, px);
  }
  if (inter.kind === "card" && inter.active) drawDraggedCard(ctx, inter, o.committed);
  if (inter.kind === "marquee") {
    const r = rectFromPoints(inter.start, inter.current);
    ctx.fillStyle = "rgba(39,124,120,0.08)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1 * px;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  if (inter.kind === "lasso" && inter.points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(inter.points[0].x, inter.points[0].y);
    for (const q of inter.points) ctx.lineTo(q.x, q.y);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.stroke();
  }
  if (o.eraser) {
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(o.eraser.at.x, o.eraser.at.y, o.eraser.size / 2, 0, Math.PI * 2);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "rgba(32,31,36,0.65)";
    ctx.stroke();
  }
  if (o.peers.length) drawPeers(ctx, o.peers, o.elements, o.cursors, px);
  ctx.restore();
}

/** The selection's box with its corner handles; with several things, a dashed box round each. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  selected: readonly string[],
  elements: readonly CanvasElement[],
  eachBox: boolean,
  px: number,
) {
  const b = padRect(box, 4 * px);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5 * px;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  if (selected.length > 1 && eachBox) {
    const set = new Set(selected);
    ctx.setLineDash([3 * px, 3 * px]);
    for (const el of elements) {
      if (!set.has(el.id)) continue;
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

/** Other people: what they have selected (dashed, in their colour), then their cursors on top. */
function drawPeers(
  ctx: CanvasRenderingContext2D,
  peers: readonly Peer[],
  elements: readonly CanvasElement[],
  cursors: ReadonlyMap<string, Point>,
  px: number,
) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.lineWidth = 1.5 * px;
  for (const peer of peers) {
    const b = unionRects(peer.selection.flatMap((id) => (byId.has(id) ? [elementBounds(byId.get(id)!)] : [])));
    if (!b) continue;
    const r = padRect(b, 6 * px);
    ctx.strokeStyle = peer.color;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  ctx.setLineDash([]);
  for (const peer of peers) {
    const at = cursors.get(peer.clientId);
    if (at) drawPeerCursor(ctx, at, peer.name, peer.color, px);
  }
}

/**
 * Other people's cursors glide toward where they really are, rather than
 * jumping with each update. One per board; `step` once per painted frame.
 */
export class PeerCursors {
  private readonly at = new Map<string, Point>();
  /** Some cursor hasn't arrived yet: keep painting. */
  moving = false;

  step(peers: readonly Peer[], z: number): ReadonlyMap<string, Point> {
    let moving = false;
    const live = new Set<string>();
    for (const peer of peers) {
      if (!peer.cursor) continue;
      live.add(peer.clientId);
      const target = peer.cursor;
      const prev = this.at.get(peer.clientId);
      let next = target;
      if (prev) {
        const dx = target.x - prev.x;
        const dy = target.y - prev.y;
        if (Math.hypot(dx, dy) * z > 0.5) {
          next = { x: prev.x + dx * 0.35, y: prev.y + dy * 0.35 };
          moving = true;
        }
      }
      this.at.set(peer.clientId, next);
    }
    for (const id of this.at.keys()) if (!live.has(id)) this.at.delete(id);
    this.moving = moving;
    return this.at;
  }
}

/** Someone else's pointer: an arrow and their name, the same size at any zoom. */
export function drawPeerCursor(ctx: CanvasRenderingContext2D, at: Point, name: string, color: string, px: number) {
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

/** A to-do card following the pointer, tilted a little, with a shadow. */
export function drawDraggedCard(
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
