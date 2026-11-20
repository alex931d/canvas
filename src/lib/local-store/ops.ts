import type { CanvasElement } from "@/lib/canvas/schema";

/**
 * One change to a drawing, as stored in the browser's operation log.
 *
 * The editor keeps element objects by reference across history states, so
 * consecutive states can be compared cheaply and each change stored small:
 *  - new elements appended at the end            -> "append" ("add" in old logs)
 *  - undo of an append                           -> "truncate"
 *  - some elements edited in place (move, resize, restyle, edit text) -> "patch"
 *  - some elements deleted                       -> "remove"
 *  - anything else (clear, reorder, big edits)   -> "replace"
 */
export type Op =
  | { kind: "add"; element: CanvasElement }
  | { kind: "append"; elements: CanvasElement[] }
  | { kind: "truncate"; length: number }
  | { kind: "patch"; changes: [index: number, element: CanvasElement][] }
  | { kind: "remove"; ids: string[] }
  | { kind: "replace"; elements: CanvasElement[] };

function isPrefix(short: readonly CanvasElement[], long: readonly CanvasElement[]) {
  for (let i = 0; i < short.length; i++) if (short[i] !== long[i]) return false;
  return true;
}

export function diffElements(
  prev: readonly CanvasElement[],
  next: readonly CanvasElement[],
): Op | null {
  if (prev === next) return null;

  if (next.length > prev.length && isPrefix(prev, next)) {
    const added = next.slice(prev.length);
    return added.length === 1 ? { kind: "add", element: added[0] } : { kind: "append", elements: added };
  }
  if (next.length < prev.length && isPrefix(next, prev)) {
    return { kind: "truncate", length: next.length };
  }

  if (next.length === prev.length) {
    const changes: [number, CanvasElement][] = [];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === prev[i]) continue;
      if (next[i].id !== prev[i].id) return { kind: "replace", elements: [...next] };
      changes.push([i, next[i]]);
    }
    if (changes.length === 0) return null;
    if (changes.length <= Math.max(8, next.length / 2)) return { kind: "patch", changes };
    return { kind: "replace", elements: [...next] };
  }

  if (next.length < prev.length) {
    // An order-preserving subsequence with unchanged objects = deletions.
    const ids: string[] = [];
    let j = 0;
    for (let i = 0; i < prev.length; i++) {
      if (j < next.length && prev[i] === next[j]) j++;
      else ids.push(prev[i].id);
    }
    if (j === next.length) return { kind: "remove", ids };
  }

  return { kind: "replace", elements: [...next] };
}

export function applyOp(elements: CanvasElement[], op: Op): CanvasElement[] {
  switch (op.kind) {
    case "add":
      return [...elements, op.element];
    case "append":
      return [...elements, ...op.elements];
    case "truncate":
      return elements.slice(0, op.length);
    case "patch": {
      const next = [...elements];
      for (const [i, el] of op.changes) if (i < next.length) next[i] = el;
      return next;
    }
    case "remove": {
      const gone = new Set(op.ids);
      return elements.filter((e) => !gone.has(e.id));
    }
    case "replace":
      return op.elements;
  }
}
