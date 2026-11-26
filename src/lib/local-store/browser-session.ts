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
 * the other's work. The second tab keeps waiting for the lock and takes
 * over by itself once the first one closes. A lock that's let go of a
 * moment after opening (React mounting the editor twice in development, a
 * quick reload) is simply waited for.
 */

export type BrowserSaveState = {
  state: "saved" | "saving" | "error";
  /** When the last write landed. */
  savedAt: number | null;
  /** Why the last write failed (storage full, or the drawing was deleted elsewhere). */
  error: string | null;
};

const SAVE_DELAY_MS = 250;
/** How long to wait for the lock before opening to look at instead of edit. */
const LOCK_GRACE_MS = 1500;
const RETRY_MS = 10_000;
const lockName = (id: string) => `canvas-browser-drawing:${id}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  /** Stops waiting for the lock (closed before another tab let go). */
  private stopWaiting: AbortController | null = null;
  /** This session is the one saving (it has the lock). */
  private saving = false;
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
   * this drawing open for editing; `onEditable` is called if that tab lets
   * go later and this one takes over.
   */
  async open(onEditable?: () => void): Promise<{ editable: boolean }> {
    const granted = this.takeLock();
    const first = await Promise.race([granted, sleep(LOCK_GRACE_MS).then(() => null)]);
    if (this.closed) return { editable: false };
    if (first) {
      this.startSaving();
      return { editable: true };
    }
    // Another tab is editing it: look for now, and edit once it's ours.
    void granted.then((ours) => {
      if (!ours || this.closed) return;
      this.startSaving();
      onEditable?.();
    });
    return { editable: false };
  }

  private startSaving() {
    this.saving = true;
    this.disconnect = this.doc.connect({ onLocalBatch: () => this.schedule(), onSettled: () => {} });
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
    this.stopWaiting?.abort();
    try {
      // Only the tab that's saving writes what's waiting.
      if (this.saving) await this.flush();
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

  /**
   * Ask for this drawing's lock and hold it until closed. Resolves true once
   * it's ours (which may be much later, when another tab lets go), false if
   * this session closed first.
   */
  private takeLock(): Promise<boolean> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return Promise.resolve(true); // very old browsers, or plain http: no guard
    const stop = new AbortController();
    this.stopWaiting = stop;
    return new Promise((resolve) => {
      locks
        .request(lockName(this.drawingId), { signal: stop.signal }, () => {
          if (this.closed) {
            resolve(false);
            return undefined; // let go at once
          }
          resolve(true);
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        })
        .catch(() => resolve(false)); // closed while waiting
    });
  }
}
