import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocOp } from "@/lib/collab/ops";
import type { Packed } from "./compress";
import type { Op } from "./ops";

/**
 * A batch of changes made in this browser that the server hasn't confirmed
 * yet (see src/lib/collab). Removed as soon as the server has it.
 */
export type OutboxRecord = {
  /** The batch id, also used by the server to apply it only once. */
  id: string;
  drawingId: string;
  /** The tab that made it; another tab only takes it over once that tab is gone. */
  clientId: string;
  /** Order within the drawing. */
  seq: number;
  ops: DocOp[];
  savedAt: number;
};

// Version 1 and 2 kept a full copy of each drawing (snapshots + ops + meta).
// They are only read now, to send any unsynced work from before the upgrade.

/** Compacted state of one drawing: every op up to and including `seq`. */
export type LocalSnapshot = {
  drawingId: string;
  seq: number;
  packed: Packed;
  savedAt: number;
};

/** One change, appended after the snapshot. */
export type LocalOp = {
  drawingId: string;
  seq: number;
  op: Op;
  at: number;
};

export type LocalMeta = {
  drawingId: string;
  /** Highest seq written to this browser. */
  localSeq: number;
  /** Highest seq the server has confirmed. localSeq > syncedSeq = unsynced work. */
  syncedSeq: number;
  /** Server's updatedAt at the last sync, to detect edits made elsewhere. */
  serverUpdatedAt: string | null;
  /** Used to pick which synced copies to evict first. */
  openedAt: number;
};

/** An image placed on a canvas. `uploaded` = the server has it too. */
export type LocalAsset = {
  id: string;
  drawingId: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  uploaded: boolean;
  savedAt: number;
};

interface CanvasLocalDB extends DBSchema {
  snapshots: { key: string; value: LocalSnapshot };
  ops: { key: [string, number]; value: LocalOp };
  meta: { key: string; value: LocalMeta; indexes: { byOpenedAt: number } };
  assets: { key: string; value: LocalAsset; indexes: { byDrawing: string } };
  outbox: { key: string; value: OutboxRecord; indexes: { byDrawing: string } };
}

export type LocalDB = IDBPDatabase<CanvasLocalDB>;

/**
 * One database per signed-in user, so people sharing a browser never see
 * each other's local copies: "canvas-local:<userId>".
 */
export const localDbName = (userId: string) => `canvas-local:${userId}`;

const dbPromises = new Map<string, Promise<LocalDB>>();

export function getLocalDb(userId: string): Promise<LocalDB> {
  const name = localDbName(userId);
  let promise = dbPromises.get(name);
  if (!promise) {
    promise = openDB<CanvasLocalDB>(name, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("snapshots", { keyPath: "drawingId" });
          db.createObjectStore("ops", { keyPath: ["drawingId", "seq"] });
          const meta = db.createObjectStore("meta", { keyPath: "drawingId" });
          meta.createIndex("byOpenedAt", "openedAt");
        }
        if (oldVersion < 2) {
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("byDrawing", "drawingId");
        }
        if (oldVersion < 3) {
          const outbox = db.createObjectStore("outbox", { keyPath: "id" });
          outbox.createIndex("byDrawing", "drawingId");
        }
      },
      blocking() {
        // Another tab wants a newer version, or sign-out wants to delete it.
        void dbPromises.get(name)?.then((db) => db.close());
        dbPromises.delete(name);
      },
    }).catch((err) => {
      dbPromises.delete(name); // allow a later retry
      throw err;
    });
    dbPromises.set(name, promise);
  }
  return promise;
}

/** Close our connection so the database can be deleted. */
export async function closeLocalDb(userId: string) {
  const name = localDbName(userId);
  const promise = dbPromises.get(name);
  dbPromises.delete(name);
  if (promise) (await promise.catch(() => null))?.close();
}

/** All op keys for one drawing with seq in [from, to]. */
export function opRange(drawingId: string, from = 0, to = Number.MAX_SAFE_INTEGER) {
  return IDBKeyRange.bound([drawingId, from], [drawingId, to]);
}

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" || // older Firefox
    err.code === 22
  );
}
