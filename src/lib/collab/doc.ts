import type { CanvasElement } from "@/lib/canvas/schema";
import { applyOps, type Batch, type DocOp } from "./ops";

/**
 * The drawing as one browser tab sees it, shared with collaborators.
 *
 *   server   the drawing as of the last change the server sent us (version)
 *   pending  our own batches the server hasn't sent back yet, oldest first
 *   shown    server + pending, which is what the canvas draws
 *
 * Local edits become batches of ops (src/lib/collab/ops.ts) that are shown
 * at once and sent in the background. Every change from the server arrives
 * in version order, our own included: our own batch simply moves from
 * pending into server; anyone else's is applied to server and our pending
 * batches are re-applied on top. Because ops address elements by id, edits
 * to different elements never clash, and everyone converges on the
 * server's order of events.
 *
 * Undo is per person: it reverses only your own changes, and skips any
 * element someone else has changed since (their edit stands).
 */

export type HistoryAction =
  | { type: "add"; elements: CanvasElement[] }
  | { type: "update"; elements: CanvasElement[] }
  | { type: "remove"; ids: string[] }
  | { type: "replace"; elements: CanvasElement[] }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" };

/** One element before and after a change; null = didn't exist / was deleted. */
type Change = { id: string; before: CanvasElement | null; after: CanvasElement | null; below?: string | null };
type Entry = Change[];

export type PendingBatch = Batch & {
  /** Set once the server accepted it, with the version it became. */
  acked?: number;
};

export type DocSnapshot = {
  elements: CanvasElement[];
  canUndo: boolean;
  canRedo: boolean;
  /** Our batches the server hasn't confirmed and sent back yet. */
  unsynced: number;
  version: number;
};

export type RemoteChange = { v: number; b: string; ops: DocOp[] };

export type DocHandlers = {
  /** Every new local batch (persist it, send it). */
  onLocalBatch: (batch: PendingBatch) => void;
  /** Batches that left `pending` (the server has them, or refused them). */
  onSettled: (ids: string[]) => void;
};

const HISTORY_LIMIT = 200;

/** A UUID, also where crypto.randomUUID is missing (plain http on a LAN address). */
export function newBatchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (Math.floor(Math.random() * 16) >> (+c / 4))).toString(16),
  );
}

const same = (a: CanvasElement | null | undefined, b: CanvasElement | null | undefined) =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

export class CollabDoc {
  private server: CanvasElement[];
  private version: number;
  private pending: PendingBatch[] = [];
  private shown: CanvasElement[];
  private past: Entry[] = [];
  private future: Entry[] = [];
  private readOnly = false;
  private listeners = new Set<() => void>();
  private snapshot: DocSnapshot;

  private handlers: DocHandlers | null = null;

  constructor(server: { elements: CanvasElement[]; version: number }) {
    this.server = server.elements;
    this.version = server.version;
    this.shown = server.elements;
    this.snapshot = this.makeSnapshot();
  }

  // ----------------------------------------------------------- reading

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  get serverVersion() {
    return this.version;
  }

  get elements() {
    return this.shown;
  }

  /** Pending batches not yet accepted by the server, oldest first. */
  unsent(): PendingBatch[] {
    return this.pending.filter((b) => b.acked === undefined);
  }

  /** The drawing as the server has it (for the backup when nothing is local). */
  get serverElements() {
    return this.server;
  }

  /** Where new batches go and where settled ones are reported. Returns a disconnect function. */
  connect(handlers: DocHandlers): () => void {
    this.handlers = handlers;
    return () => {
      if (this.handlers === handlers) this.handlers = null;
    };
  }

  /** Viewers can't change anything; their dispatches are ignored. */
  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
    if (readOnly) {
      this.past = [];
      this.future = [];
      this.emit();
    }
  }

  // ------------------------------------------------------- local edits

  /** Batches saved in this browser from an earlier visit; they go on top. */
  restore(batches: PendingBatch[]) {
    if (batches.length === 0) return;
    this.pending.push(...batches.map((b) => ({ id: b.id, ops: b.ops })));
    this.shown = this.rebase();
    this.emit();
  }

  dispatch = (action: HistoryAction) => {
    if (this.readOnly) return;
    if (action.type === "undo" || action.type === "redo") {
      const from = action.type === "undo" ? this.past : this.future;
      const to = action.type === "undo" ? this.future : this.past;
      // Skip entries that have nothing left to reverse (others changed it all).
      while (from.length) {
        const entry = from.pop()!;
        const ops = action.type === "undo" ? this.inverse(entry) : this.forward(entry);
        if (ops.length) {
          to.push(entry);
          this.commit(ops);
          return;
        }
      }
      this.emit();
      return;
    }
    const { ops, entry } = this.describe(action);
    if (ops.length === 0) return;
    this.past.push(entry);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.commit(ops);
  };

  private commit(ops: DocOp[]) {
    const batch: PendingBatch = { id: newBatchId(), ops };
    this.pending.push(batch);
    this.shown = applyOps(this.shown, ops);
    this.emit();
    this.handlers?.onLocalBatch(batch);
  }

  /** Turn an editor action into ops plus what undo needs to reverse it. */
  private describe(action: Exclude<HistoryAction, { type: "undo" | "redo" }>): { ops: DocOp[]; entry: Entry } {
    const shown = this.shown;
    const ops: DocOp[] = [];
    const entry: Entry = [];
    const remove = (ids: ReadonlySet<string>) => {
      for (let i = 0; i < shown.length; i++) {
        const el = shown[i];
        if (!ids.has(el.id)) continue;
        ops.push({ t: "del", id: el.id });
        entry.push({ id: el.id, before: el, after: null, below: i > 0 ? shown[i - 1].id : null });
      }
    };
    switch (action.type) {
      case "add":
        for (const el of action.elements) {
          ops.push({ t: "add", el });
          entry.push({ id: el.id, before: null, after: el });
        }
        break;
      case "update": {
        const byId = new Map(shown.map((e) => [e.id, e]));
        for (const el of action.elements) {
          const before = byId.get(el.id);
          if (!before || before === el) continue;
          ops.push({ t: "set", el });
          entry.push({ id: el.id, before, after: el });
        }
        break;
      }
      case "remove":
        remove(new Set(action.ids));
        break;
      case "clear":
        remove(new Set(shown.map((e) => e.id)));
        break;
      case "replace": {
        const next = new Map(action.elements.map((e) => [e.id, e]));
        remove(new Set(shown.filter((e) => !next.has(e.id)).map((e) => e.id)));
        const byId = new Map(shown.map((e) => [e.id, e]));
        for (const el of action.elements) {
          const before = byId.get(el.id);
          if (before === el) continue;
          if (before) {
            ops.push({ t: "set", el });
            entry.push({ id: el.id, before, after: el });
          } else {
            ops.push({ t: "add", el });
            entry.push({ id: el.id, before: null, after: el });
          }
        }
        break;
      }
    }
    return { ops, entry };
  }

  private inverse(entry: Entry): DocOp[] {
    const current = new Map(this.shown.map((e) => [e.id, e]));
    const ops: DocOp[] = [];
    for (const c of entry) {
      const cur = current.get(c.id);
      if (c.before === null) {
        if (cur && same(cur, c.after)) ops.push({ t: "del", id: c.id });
      } else if (c.after === null) {
        // Put it back where it was: right above the element that was below it.
        if (!cur) ops.push({ t: "add", el: c.before, after: c.below ?? null });
      } else if (cur && same(cur, c.after)) {
        ops.push({ t: "set", el: c.before });
      }
    }
    return ops;
  }

  private forward(entry: Entry): DocOp[] {
    const current = new Map(this.shown.map((e) => [e.id, e]));
    const ops: DocOp[] = [];
    for (const c of entry) {
      const cur = current.get(c.id);
      if (c.before === null) {
        if (!cur && c.after) ops.push({ t: "add", el: c.after });
      } else if (c.after === null) {
        if (cur && same(cur, c.before)) ops.push({ t: "del", id: c.id });
      } else if (cur && same(cur, c.before)) {
        ops.push({ t: "set", el: c.after });
      }
    }
    return ops;
  }

  // ---------------------------------------------------- server changes

  /** The server accepted these batches (POST response). */
  acknowledge(results: { id: string; version: number }[]) {
    const done: string[] = [];
    for (const r of results) {
      const batch = this.pending.find((b) => b.id === r.id);
      if (!batch) continue;
      batch.acked = r.version;
      // Already part of `server` (we caught up past it some other way).
      if (r.version <= this.version) done.push(r.id);
    }
    if (done.length) this.drop(done);
    else this.emit();
  }

  /**
   * These batches are kept for good somewhere that isn't a server (on the
   * free plan, this browser's storage), with nobody else to hear from: they
   * become part of `server` in the order they were made. What's shown
   * doesn't change, and once nothing is pending, `server` is the very same
   * array as what's shown (render caches stay warm).
   */
  confirmLocal(ids: string[]) {
    const set = new Set(ids);
    const done = this.pending.filter((b) => set.has(b.id));
    if (done.length === 0) return;
    this.pending = this.pending.filter((b) => !set.has(b.id));
    this.server = this.pending.length ? done.reduce((els, b) => applyOps(els, b.ops), this.server) : this.shown;
    this.version += done.length;
    this.emit();
    this.handlers?.onSettled(done.map((b) => b.id));
  }

  /** A change from the live stream. "gap" = we missed some: reload the drawing. */
  applyRemote(change: RemoteChange): "applied" | "stale" | "gap" {
    if (change.v <= this.version) return "stale";
    if (change.v !== this.version + 1) return "gap";
    const index = this.pending.findIndex((b) => b.id === change.b);
    if (index === 0) {
      // Our oldest batch came back. Apply our own op objects so every element
      // keeps its identity (render caches stay warm); what's shown is unchanged.
      const [mine] = this.pending.splice(0, 1);
      this.server = applyOps(this.server, mine.ops);
      this.version = change.v;
      this.emit();
      this.handlers?.onSettled([mine.id]);
      return "applied";
    }
    const ops = index > 0 ? this.pending.splice(index, 1)[0].ops : change.ops;
    this.server = applyOps(this.server, ops);
    this.version = change.v;
    this.shown = this.rebase();
    this.emit();
    if (index > 0) this.handlers?.onSettled([change.b]);
    return "applied";
  }

  /** Start over from a fresh copy of the drawing (after falling too far behind). */
  reset(server: { elements: CanvasElement[]; version: number }) {
    this.server = server.elements;
    this.version = server.version;
    const included = this.pending.filter((b) => b.acked !== undefined && b.acked <= server.version).map((b) => b.id);
    this.pending = this.pending.filter((b) => !included.includes(b.id));
    this.shown = this.rebase();
    this.emit();
    if (included.length) this.handlers?.onSettled(included);
  }

  /** The server will never take these batches (invalid, too big, no permission). */
  reject(ids: string[]) {
    this.drop(ids);
  }

  private drop(ids: string[]) {
    const set = new Set(ids);
    this.pending = this.pending.filter((b) => !set.has(b.id));
    this.shown = this.rebase();
    this.emit();
    this.handlers?.onSettled(ids);
  }

  private rebase(): CanvasElement[] {
    let els = this.server;
    for (const b of this.pending) els = applyOps(els, b.ops);
    return els;
  }

  // ----------------------------------------------------------- plumbing

  private makeSnapshot(): DocSnapshot {
    return {
      elements: this.shown,
      canUndo: !this.readOnly && this.past.length > 0,
      canRedo: !this.readOnly && this.future.length > 0,
      unsynced: this.pending.length,
      version: this.version,
    };
  }

  private emit() {
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }
}
