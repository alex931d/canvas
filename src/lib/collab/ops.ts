import { z } from "zod";
import { elementSchema, type CanvasElement } from "@/lib/canvas/schema";

/**
 * Changes to a drawing, as sent between browsers and the server.
 *
 * A drawing is an ordered list of elements (later ones are drawn on top).
 * Every edit is expressed per element, so two people editing different
 * things never overwrite each other; when two edit the same element, the
 * change the server receives last wins.
 *
 *   add  insert an element: on top, or right above `after` (null = at the
 *        bottom). Re-adding an id that exists replaces it in place.
 *   set  replace an element that exists. If someone deleted it meanwhile,
 *        nothing happens: a deletion beats a concurrent edit.
 *   del  remove an element (no-op if it's already gone).
 *
 * The server and every browser apply the same ops with `applyOps`, so they
 * all end up with the same list.
 *
 * Imported by client and server: no server-only imports.
 */

export type DocOp =
  | { t: "add"; el: CanvasElement; after?: string | null }
  | { t: "set"; el: CanvasElement }
  | { t: "del"; id: string };

const elementId = z.string().min(1).max(64);

export const docOpSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("add"), el: elementSchema, after: elementId.nullable().optional() }),
  z.object({ t: z.literal("set"), el: elementSchema }),
  z.object({ t: z.literal("del"), id: elementId }),
]);

export const batchSchema = z.object({
  id: z.uuid(),
  ops: z.array(docOpSchema).min(1).max(25_000),
});

export type Batch = { id: string; ops: DocOp[] };

/** Apply ops in order. Returns a new list; untouched elements keep their identity. */
export function applyOps(elements: readonly CanvasElement[], ops: readonly DocOp[]): CanvasElement[] {
  let list = elements.slice();
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    // Runs of the same kind are applied together, so clearing or restoring
    // thousands of elements stays linear.
    if (op.t === "del") {
      const gone = new Set<string>();
      while (i < ops.length && ops[i].t === "del") gone.add((ops[i++] as { id: string }).id);
      list = list.filter((e) => !gone.has(e.id));
    } else if (op.t === "set" || (op.t === "add" && op.after === undefined)) {
      const index = new Map(list.map((e, k) => [e.id, k]));
      while (i < ops.length && (ops[i].t === "set" || (ops[i].t === "add" && (ops[i] as { after?: unknown }).after === undefined))) {
        const o = ops[i++] as Extract<DocOp, { t: "set" | "add" }>;
        const k = index.get(o.el.id);
        if (k !== undefined) list[k] = o.el;
        else if (o.t === "add") {
          index.set(o.el.id, list.length);
          list.push(o.el);
        }
      }
    } else {
      const run: Extract<DocOp, { t: "add" }>[] = [];
      while (i < ops.length && ops[i].t === "add" && (ops[i] as { after?: unknown }).after !== undefined) {
        run.push(ops[i++] as Extract<DocOp, { t: "add" }>);
      }
      list = insertAnchored(list, run);
    }
  }
  return list;
}

/** Insert elements each right above its anchor (which may be another inserted one). */
function insertAnchored(list: CanvasElement[], adds: Extract<DocOp, { t: "add" }>[]): CanvasElement[] {
  const present = new Map(list.map((e) => [e.id, e]));
  const replaced = new Map<string, CanvasElement>();
  const incoming = new Set<string>();
  for (const a of adds) if (!present.has(a.el.id)) incoming.add(a.el.id);

  const BOTTOM = "\u0000bottom";
  const TOP = "\u0000top";
  const after = new Map<string, CanvasElement[]>();
  const queue = (key: string, el: CanvasElement) => {
    const q = after.get(key);
    if (q) q.push(el);
    else after.set(key, [el]);
  };
  for (const a of adds) {
    if (present.has(a.el.id)) {
      replaced.set(a.el.id, a.el);
      continue;
    }
    const anchor = a.after;
    if (anchor === null) queue(BOTTOM, a.el);
    else if (anchor !== undefined && (present.has(anchor) || incoming.has(anchor))) queue(anchor, a.el);
    else queue(TOP, a.el);
  }

  const out: CanvasElement[] = [];
  // Depth-first without recursion: a chain of thousands must not overflow the stack.
  const emitWithFollowers = (first: CanvasElement) => {
    const stack: CanvasElement[] = [first];
    while (stack.length) {
      const el = stack.pop()!;
      out.push(el);
      const next = after.get(el.id);
      if (next) {
        after.delete(el.id);
        for (let k = next.length - 1; k >= 0; k--) stack.push(next[k]);
      }
    }
  };
  for (const el of after.get(BOTTOM) ?? []) emitWithFollowers(el);
  for (const e of list) emitWithFollowers(replaced.get(e.id) ?? e);
  for (const el of after.get(TOP) ?? []) emitWithFollowers(el);
  return out;
}

/** Ids of images, GIFs and videos referenced by ops (they must be uploaded before the ops are sent). */
export function assetIdsIn(ops: readonly DocOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.t !== "del" && (op.el.type === "image" || op.el.type === "gif" || op.el.type === "video")) ids.add(op.el.assetId);
  }
  return ids;
}
