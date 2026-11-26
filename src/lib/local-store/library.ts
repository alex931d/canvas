import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DEFAULT_PRESENTATION,
  emptyDrawing,
  type CanvasElement,
  type DrawingData,
  type Presentation,
} from "@/lib/canvas/schema";
import { newBatchId } from "@/lib/collab/doc";

/**
 * Drawings kept only in this browser: the free plan, which needs no account.
 *
 * Unlike the member's local store (src/lib/local-store/store.ts), which only
 * holds what hasn't reached the server yet, this is the drawing itself. It
 * belongs to the browser rather than to an account, so it's there whether
 * or not anyone is signed in, and it's what gets moved into an account when
 * someone here becomes a member (src/lib/local-store/mover.ts).
 *
 *   drawings  what the gallery shows: title, picture, when it changed
 *   contents  the elements and the slide style, read only when it's opened
 *   assets    its images, GIFs and videos
 *
 * Every change is announced on a BroadcastChannel, so a gallery open in
 * another tab keeps up.
 */

export type BrowserDrawingSummary = {
  id: string;
  title: string;
  /** A small picture for the gallery (a data URL), made after edits settle. */
  thumbnail: string | null;
  /** How many things are on it. */
  items: number;
  createdAt: number;
  updatedAt: number;
};

export type BrowserDrawing = BrowserDrawingSummary & {
  data: DrawingData;
  presentation: Presentation;
};

export type BrowserAsset = {
  id: string;
  drawingId: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  savedAt: number;
};

type Contents = { id: string; data: DrawingData; presentation: Presentation };

interface LibraryDB extends DBSchema {
  drawings: { key: string; value: BrowserDrawingSummary; indexes: { byUpdatedAt: number } };
  contents: { key: string; value: Contents };
  assets: { key: string; value: BrowserAsset; indexes: { byDrawing: string } };
}

const DB_NAME = "canvas-browser";
const CHANNEL = "canvas-browser";

export class BrowserLibraryError extends Error {}

export class BrowserLibrary {
  /** One per page: every part of the app talks to the same database. */
  static readonly shared = new BrowserLibrary();

  private dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();

  // ------------------------------------------------------------ reading

  /** Every drawing in this browser, most recently changed first. */
  async list(): Promise<BrowserDrawingSummary[]> {
    const db = await this.open();
    return (await db.getAllFromIndex("drawings", "byUpdatedAt")).reverse();
  }

  async count(): Promise<number> {
    return (await this.open()).count("drawings");
  }

  async get(id: string): Promise<BrowserDrawing | null> {
    const db = await this.open();
    const tx = db.transaction(["drawings", "contents"]);
    const [summary, contents] = await Promise.all([tx.objectStore("drawings").get(id), tx.objectStore("contents").get(id)]);
    if (!summary || !contents) return null;
    return { ...summary, data: contents.data, presentation: contents.presentation };
  }

  // ------------------------------------------------------------ writing

  /**
   * A new, empty drawing, or one made from `from` (a drawing brought in
   * from an account keeps its id, picture and dates).
   */
  async create(from?: {
    id?: string;
    title?: string;
    data?: DrawingData;
    presentation?: Presentation;
    thumbnail?: string | null;
    updatedAt?: number;
  }): Promise<BrowserDrawing> {
    const now = Date.now();
    const data = from?.data ?? emptyDrawing();
    const drawing: BrowserDrawing = {
      id: from?.id ?? newBatchId(),
      title: from?.title?.trim() || "Untitled",
      thumbnail: from?.thumbnail ?? null,
      items: data.elements.length,
      createdAt: now,
      updatedAt: from?.updatedAt ?? now,
      data,
      presentation: from?.presentation ?? DEFAULT_PRESENTATION,
    };
    const db = await this.open();
    const tx = db.transaction(["drawings", "contents"], "readwrite");
    const { data: contents, presentation, ...summary } = drawing;
    await Promise.all([
      tx.objectStore("drawings").put(summary),
      tx.objectStore("contents").put({ id: drawing.id, data: contents, presentation }),
      tx.done,
    ]);
    this.announce();
    // Ask the browser not to clear this site's storage when space runs low.
    void navigator.storage?.persist?.().catch(() => false);
    return drawing;
  }

  /** The drawing's elements as they are now. */
  async saveElements(id: string, elements: CanvasElement[]): Promise<void> {
    await this.change(id, (summary, contents) => {
      contents.data = { ...contents.data, elements };
      summary.items = elements.length;
    });
  }

  async rename(id: string, title: string): Promise<void> {
    await this.change(id, (summary) => {
      summary.title = title;
    });
  }

  async savePresentation(id: string, presentation: Presentation): Promise<void> {
    await this.change(id, (_summary, contents) => {
      contents.presentation = presentation;
    });
  }

  /** A new gallery picture; doesn't count as an edit. */
  async saveThumbnail(id: string, thumbnail: string): Promise<void> {
    await this.change(id, (summary) => {
      summary.thumbnail = thumbnail;
    }, false);
  }

  /** The drawing, its contents and its files. */
  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["drawings", "contents", "assets"], "readwrite");
    const assets = tx.objectStore("assets");
    const ids = await assets.index("byDrawing").getAllKeys(id);
    await Promise.all([
      tx.objectStore("drawings").delete(id),
      tx.objectStore("contents").delete(id),
      ...ids.map((assetId) => assets.delete(assetId)),
      tx.done,
    ]);
    this.announce();
  }

  // ------------------------------------------------------------- files

  /** False when the browser refused it (storage full). */
  async putAsset(asset: Omit<BrowserAsset, "savedAt">): Promise<boolean> {
    try {
      await (await this.open()).put("assets", { ...asset, savedAt: Date.now() });
      return true;
    } catch (err) {
      console.warn("[library] couldn't keep a file", err);
      return false;
    }
  }

  async getAsset(id: string): Promise<BrowserAsset | null> {
    return (await (await this.open()).get("assets", id)) ?? null;
  }

  async assetsOf(drawingId: string): Promise<BrowserAsset[]> {
    return (await this.open()).getAllFromIndex("assets", "byDrawing", drawingId);
  }

  // ------------------------------------------------------------ changes

  /** Called after any change here or in another tab. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.listen();
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ----------------------------------------------------------- plumbing

  private async change(
    id: string,
    edit: (summary: BrowserDrawingSummary, contents: Contents) => void,
    touch = true,
  ): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["drawings", "contents"], "readwrite");
    const drawingsStore = tx.objectStore("drawings");
    const contentsStore = tx.objectStore("contents");
    const [summary, contents] = await Promise.all([drawingsStore.get(id), contentsStore.get(id)]);
    if (!summary || !contents) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new BrowserLibraryError("This drawing isn't in this browser any more.");
    }
    edit(summary, contents);
    if (touch) summary.updatedAt = Date.now();
    await Promise.all([drawingsStore.put(summary), contentsStore.put(contents), tx.done]);
    this.announce();
  }

  private open(): Promise<IDBPDatabase<LibraryDB>> {
    if (!this.dbPromise) {
      if (typeof indexedDB === "undefined") return Promise.reject(new BrowserLibraryError("This browser can't save drawings."));
      this.dbPromise = openDB<LibraryDB>(DB_NAME, 1, {
        upgrade(db) {
          const drawings = db.createObjectStore("drawings", { keyPath: "id" });
          drawings.createIndex("byUpdatedAt", "updatedAt");
          db.createObjectStore("contents", { keyPath: "id" });
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("byDrawing", "drawingId");
        },
        blocking: () => {
          void this.dbPromise?.then((db) => db.close());
          this.dbPromise = null;
        },
      }).catch((err) => {
        this.dbPromise = null; // allow a later retry
        throw err;
      });
    }
    return this.dbPromise;
  }

  private listen() {
    if (this.channel || typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = () => this.notify();
  }

  private announce() {
    this.listen();
    this.channel?.postMessage("changed");
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
