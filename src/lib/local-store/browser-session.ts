import type { AssetStore } from "@/lib/canvas/images";
import type { Presentation } from "@/lib/canvas/schema";
import type { CollabDoc } from "@/lib/collab/doc";
import { isQuotaError } from "./idb";
import { BrowserLibrary } from "./library";

/**
 * Keeps one drawing on the free plan saved in this browser while it's open.
 *
 * Every change the editor makes is shown at once and written moments later
 * (a quick run of changes becomes one write). Once the browser has it, the
 * document counts it as saved (CollabDoc.confirmLocal), just as a member's
 * changes count once the server has them.
 *
 * Only one tab edits a drawing at a time: each holds a Web Lock on it, and
 * a second tab opens it to look at, not to change, so neither overwrites
 * the other's work.
 */

export type BrowserSaveState = {
  state: "saved" | "saving" | "error";
  /** When the last write landed. */
  savedAt: number | null;
  /** Why the last write failed (storage full, or the drawing was deleted elsewhere). */
  error: string | null;
};

const SAVE_DELAY_MS = 250;
const RETRY_MS = 10_000;
const lockName = (id: string) => `canvas-browser-drawing:${id}`;

export const STORAGE_FULL =
  "This browser's storage is full, so your latest changes aren't saved. Download a backup to keep them, or free up space.";

export class BrowserDrawingSession {
  private status: BrowserSaveState = { state: "saved", savedAt: null, error: null };
  private listeners = new Set<(s: BrowserSaveState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private again = false;
  private disconnect: (() => void) | null = null;
  private releaseLock: (() => void) | null = null;
  private closed = false;

  constructor(
    readonly drawingId: string,
    private readonly doc: CollabDoc,
    private readonly library: BrowserLibrary = BrowserLibrary.shared,
  ) {}

  /** Where the drawing's files go. */
  readonly assets: AssetStore = {
    getAssetBlob: async (id) => (await this.library.getAsset(id))?.blob ?? null,
    putAsset: (asset) =>
      this.library.putAsset({
        id: asset.id,
        drawingId: this.drawingId,
        blob: asset.blob,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      }),
  };

  /**
   * Start saving. Resolves `editable: false` when another tab already has
   * this drawing open for editing.
   */
  async open(): Promise<{ editable: boolean }> {
    const editable = await this.takeLock();
    if (this.closed) return { editable: false };
    if (editable) {
      this.disconnect = this.doc.connect({ onLocalBatch: () => this.schedule(), onSettled: () => {} });
    }
    return { editable };
  }

  rename(title: string): Promise<void> {
    return this.library.rename(this.drawingId, title);
  }

  savePresentation(presentation: Presentation): Promise<void> {
    return this.library.savePresentation(this.drawingId, presentation);
  }

  saveThumbnail(thumbnail: string): Promise<void> {
    return this.library.saveThumbnail(this.drawingId, thumbnail);
  }

  /** Write anything waiting, now (before leaving the page), and wait until it's written. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A write already under way may be followed by one more for changes made meanwhile.
    for (let i = 0; i < 5; i++) {
      if (this.writing) await this.writing;
      if (this.doc.unsent().length === 0) return;
      await this.write();
      if (this.status.state === "error") return;
    }
  }

  getStatus = () => this.status;

  subscribe(listener: (s: BrowserSaveState) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stop saving: write what's waiting, then let another tab take over. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.flush();
    } finally {
      this.disconnect?.();
      this.releaseLock?.();
      this.releaseLock = null;
      if (this.timer) clearTimeout(this.timer);
    }
  }

  // ----------------------------------------------------------- plumbing

  private schedule(delay = SAVE_DELAY_MS) {
    if (this.timer || this.closed) return;
    this.setStatus({ ...this.status, state: this.status.state === "error" ? "error" : "saving" });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, delay);
  }

  private write(): Promise<void> {
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    const pending = this.doc.unsent();
    if (pending.length === 0) return Promise.resolve();
    const ids = pending.map((b) => b.id);
    const elements = this.doc.elements;
    this.writing = this.library
      .saveElements(this.drawingId, elements)
      .then(
        () => {
          this.doc.confirmLocal(ids);
          this.setStatus({ state: this.doc.unsent().length ? "saving" : "saved", savedAt: Date.now(), error: null });
        },
        (err: unknown) => {
          console.warn("[browser drawing] couldn't save", err);
          const error = isQuotaError(err)
            ? STORAGE_FULL
            : err instanceof Error && err.message
              ? err.message
              : "Your latest changes couldn't be saved in this browser.";
          this.setStatus({ ...this.status, state: "error", error });
          // Try again in a while; a new change tries sooner.
          if (!this.closed) this.schedule(RETRY_MS);
        },
      )
      .finally(() => {
        this.writing = null;
        if (this.again) {
          this.again = false;
          if (this.doc.unsent().length) void this.write();
        }
      });
    return this.writing;
  }

  private setStatus(next: BrowserSaveState) {
    this.status = next;
    for (const l of this.listeners) l(next);
  }

  /** Hold this drawing's lock while open; false if another tab holds it. */
  private takeLock(): Promise<boolean> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return Promise.resolve(true); // very old browsers: no guard
    return new Promise((resolve) => {
      void locks
        .request(lockName(this.drawingId), { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((release) => {
            this.releaseLock = release;
            if (this.closed) release();
          });
        })
        .catch(() => resolve(true));
    });
  }
}
