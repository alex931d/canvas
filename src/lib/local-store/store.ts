import type { CanvasElement } from "@/lib/canvas/schema";
import { newBatchId, type PendingBatch } from "@/lib/collab/doc";
import type { DocOp } from "@/lib/collab/ops";
import { base64ToBytes, bytesToBase64, pack, unpack } from "./compress";
import {
  getLocalDb,
  isQuotaError,
  opRange,
  type LocalAsset,
  type LocalDB,
  type OutboxRecord,
} from "./idb";
import { applyOp } from "./ops";

/**
 * Local-first safety net for one open drawing.
 *
 * Postgres is the source of truth and every change goes there within
 * moments. What this browser keeps is what hasn't arrived yet: each batch
 * of changes is written to an outbox in IndexedDB the moment it's made and
 * removed once the server has it. If the tab closes, the laptop dies or the
 * connection drops, the outbox is replayed on top of the server's copy the
 * next time the drawing opens, without overwriting anyone else's work.
 * Images are kept here too until they're uploaded.
 *
 * When the browser refuses a write (quota exceeded), it steps down:
 *   1. evict: delete local copies of images the server already has, and
 *             data left over from older versions of the app
 *   2. slot:  keep this drawing's outbox in localStorage, which has its own
 *             separate ~5 MB allowance
 *   3. off:   nothing local; the editor sends every change at once and
 *             offers a backup download
 * In modes 2 and 3 it retries IndexedDB every 30 s and steps back up.
 *
 * IndexedDB, OPFS and the Cache API share ONE per-site quota, so hopping
 * between them would not free anything; that is why the fallbacks are
 * eviction, a separate allowance, and the server.
 */

export type LocalMode = "indexeddb" | "backup-slot" | "off";

export type LocalStatus = {
  mode: LocalMode;
  /** Writes queued but not yet confirmed by the browser. */
  pendingWrites: number;
  lastWriteAt: number | null;
  /** From navigator.storage.estimate(); whole site, all storage types. */
  usage: number | null;
  quota: number | null;
  /** The latest notable event (a fallback step, a recovery), for the UI. */
  notice: string | null;
};

export type OpenResult = {
  /** Changes from earlier visits that never reached the server, oldest first. */
  batches: PendingBatch[];
  restoredChanges: number;
};

type SlotRecord = { v: 2; encoding: "gzip" | "json"; data: string; savedAt: number };

const RETRY_IDB_MS = 30_000;
const ESTIMATE_THROTTLE_MS = 3_000;
const PRESSURE_RATIO = 0.8;
/** localStorage backup slots: "canvas-backup:<userId>:<drawingId>". */
export const slotPrefix = (userId: string) => `canvas-backup:${userId}:`;
/** Each tab holds this Web Lock while it lives, so others know its outbox isn't orphaned. */
const tabLock = (clientId: string) => `canvas-tab:${clientId}`;

const SLOT_NOTICE =
  "Browser storage is full. Unsynced changes are kept in a separate backup slot, and every change is sent to the server right away.";
const OFF_NOTICE =
  "Browser storage is full. Every change now goes straight to the server. Download a backup if you might go offline.";

export class LocalDrawingStore {
  readonly drawingId: string;
  readonly userId: string;
  readonly clientId: string;

  private db: LocalDB | null = null;
  private mode: LocalMode = "indexeddb";
  /** This tab's unsynced batches, in order (mirrors the outbox). */
  private outbox = new Map<string, { seq: number; ops: DocOp[] }>();
  private seq = Date.now() * 1000;

  private queue: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private lastWriteAt: number | null = null;
  private usage: number | null = null;
  private quota: number | null = null;
  private notice: string | null = null;
  private lastEstimateAt = 0;
  private pressureHandled = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(s: LocalStatus) => void>();
  private disposed = false;
  private releaseLock: (() => void) | null = null;

  constructor(drawingId: string, userId: string, clientId: string) {
    this.drawingId = drawingId;
    this.userId = userId;
    this.clientId = clientId;
  }

  // ---------------------------------------------------------------- public

  /**
   * Find unsynced work for this drawing from earlier visits (or from tabs
   * that closed) and take it over. `server` is the drawing as the server has
   * it now, needed only to turn very old (pre-collaboration) local copies
   * into changes.
   */
  async open(server: { elements: CanvasElement[] }): Promise<OpenResult> {
    await this.holdTabLock();
    let adopted: { id: string; ops: DocOp[] }[] = [];

    try {
      this.db = await getLocalDb(this.userId);
      adopted = await this.adoptOrphans();
      const legacy = await this.migrateLegacy(server.elements);
      if (legacy) adopted.push(legacy);
    } catch (err) {
      console.warn("[local-store] IndexedDB unavailable", err);
      this.db = null;
      this.mode = "backup-slot";
      this.notice = "IndexedDB isn't available in this browser, so a smaller backup slot is used.";
      this.startIdbRetry();
    }

    // A backup slot left from a visit when storage was full.
    const slot = await this.readSlot();
    if (slot.length) {
      const known = new Set(adopted.map((b) => b.id));
      adopted.push(...slot.filter((b) => !known.has(b.id)));
    }

    for (const b of adopted) this.outbox.set(b.id, { seq: ++this.seq, ops: b.ops });
    if (adopted.length) {
      // Rewrite them as this tab's own.
      this.enqueue(async () => {
        if (this.mode === "indexeddb" && (await this.writeAllToIdb())) {
          this.clearSlot();
          this.wrote();
        } else {
          await this.persistToSlotOrGoOff();
        }
      });
    } else if (slot.length === 0 && this.mode === "indexeddb") {
      this.clearSlot();
    }

    void this.refreshEstimate();
    this.emit();
    return { batches: adopted.map((b) => ({ id: b.id, ops: b.ops })), restoredChanges: adopted.length };
  }

  /** Keep a new batch until the server confirms it. */
  saveBatch(batch: { id: string; ops: DocOp[] }) {
    const entry = { seq: ++this.seq, ops: batch.ops };
    this.outbox.set(batch.id, entry);
    this.enqueue(() => this.persist(batch.id, entry));
  }

  /** The server has these (or refused them for good): forget them. */
  removeBatches(ids: string[]) {
    const mine = ids.filter((id) => this.outbox.delete(id));
    if (mine.length === 0) return;
    this.enqueue(async () => {
      if (this.mode === "indexeddb" && this.db) {
        try {
          const tx = this.db.transaction("outbox", "readwrite");
          await Promise.all([...mine.map((id) => tx.store.delete(id)), tx.done]);
        } catch {
          /* a leftover record is only sent again, and the server ignores repeats */
        }
      } else if (this.mode === "backup-slot") {
        await this.writeSlot();
      }
      this.emit();
    });
  }

  /** How many batches this tab still holds for the server. */
  get unsynced() {
    return this.outbox.size;
  }

  /** Free space by dropping image copies the server already has. */
  freeUpSpace(): Promise<number> {
    return new Promise((resolve) => {
      this.enqueue(async () => {
        const images = await this.evictUploadedImages(false);
        const legacy = await this.evictLegacy();
        if (this.mode !== "indexeddb") await this.retryIdb();
        const freed = images + legacy;
        this.notice =
          freed > 0
            ? `Removed ${[
                images > 0 ? `${images} image${images === 1 ? "" : "s"} or video${images === 1 ? "" : "s"} from other drawings` : null,
                legacy > 0 ? `${legacy} old local ${legacy === 1 ? "copy" : "copies"}` : null,
              ]
                .filter(Boolean)
                .join(" and ")}, all already saved on the server.`
            : "Nothing to remove: everything stored here is still waiting for the server.";
        this.lastEstimateAt = 0;
        await this.refreshEstimate();
        resolve(freed);
      });
    });
  }

  getStatus(): LocalStatus {
    return {
      mode: this.mode,
      pendingWrites: this.pendingWrites,
      lastWriteAt: this.lastWriteAt,
      usage: this.usage,
      quota: this.quota,
      notice: this.notice,
    };
  }

  subscribe(listener: (s: LocalStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.listeners.clear();
    this.releaseLock?.();
  }

  // ---------------------------------------------------------- tabs, locks

  private async holdTabLock() {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return;
    await new Promise<void>((settled) => {
      void locks
        // Never wait for it: it only tells other tabs that this one is alive.
        .request(tabLock(this.clientId), { ifAvailable: true }, (lock) => {
          settled();
          if (!lock || this.disposed) return;
          return new Promise<void>((release) => {
            this.releaseLock = release;
          });
        })
        .catch(() => settled());
    });
  }

  /** Outbox records of this drawing whose tab is gone. */
  private async adoptOrphans(): Promise<{ id: string; ops: DocOp[] }[]> {
    const db = this.db!;
    const records = await db.getAllFromIndex("outbox", "byDrawing", this.drawingId);
    if (records.length === 0) return [];
    let live = new Set<string>();
    try {
      const state = await navigator.locks?.query?.();
      live = new Set((state?.held ?? []).map((l) => l.name ?? ""));
    } catch {
      /* no Web Locks: take everything; the server ignores batches it already has */
    }
    return records
      .filter((r) => r.clientId !== this.clientId && !live.has(tabLock(r.clientId)))
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({ id: r.id, ops: r.ops }));
  }

  /**
   * Before collaboration, this browser kept a full copy of each drawing.
   * Unsynced work in one is turned into a batch (local wins, as it did then);
   * synced copies are just deleted.
   */
  private async migrateLegacy(serverElements: CanvasElement[]): Promise<{ id: string; ops: DocOp[] } | null> {
    const db = this.db!;
    const meta = await db.get("meta", this.drawingId);
    if (!meta) return null;
    let batch: { id: string; ops: DocOp[] } | null = null;
    if (meta.localSeq > meta.syncedSeq) {
      const snapshot = await db.get("snapshots", this.drawingId);
      let elements = snapshot ? await unpack<CanvasElement[]>(snapshot.packed) : [];
      const ops = await db.getAll("ops", opRange(this.drawingId, snapshot ? snapshot.seq + 1 : 0));
      for (const { op } of ops) elements = applyOp(elements, op);
      const server = new Map(serverElements.map((e) => [e.id, e]));
      const local = new Set(elements.map((e) => e.id));
      const docOps: DocOp[] = [
        ...serverElements.filter((e) => !local.has(e.id)).map((e) => ({ t: "del" as const, id: e.id })),
        ...elements
          .filter((e) => JSON.stringify(server.get(e.id)) !== JSON.stringify(e))
          .map((e) => (server.has(e.id) ? { t: "set" as const, el: e } : { t: "add" as const, el: e })),
      ];
      if (docOps.length) batch = { id: newBatchId(), ops: docOps };
    }
    await this.deleteLegacy(this.drawingId);
    return batch;
  }

  private async deleteLegacy(drawingId: string) {
    const db = this.db;
    if (!db) return;
    const tx = db.transaction(["snapshots", "ops", "meta"], "readwrite");
    await Promise.all([
      tx.objectStore("snapshots").delete(drawingId),
      tx.objectStore("ops").delete(opRange(drawingId)),
      tx.objectStore("meta").delete(drawingId),
      tx.done,
    ]);
  }

  /** Old full copies that the server already had. */
  private async evictLegacy(): Promise<number> {
    const db = this.db;
    if (!db) return 0;
    let removed = 0;
    try {
      for (const m of await db.getAll("meta")) {
        if (m.drawingId === this.drawingId || m.localSeq > m.syncedSeq) continue;
        await this.deleteLegacy(m.drawingId);
        removed++;
      }
    } catch {
      /* best effort */
    }
    return removed;
  }

  // --------------------------------------------------------------- writing

  private record(id: string, entry: { seq: number; ops: DocOp[] }): OutboxRecord {
    return { id, drawingId: this.drawingId, clientId: this.clientId, seq: entry.seq, ops: entry.ops, savedAt: Date.now() };
  }

  private async persist(id: string, entry: { seq: number; ops: DocOp[] }) {
    if (!this.outbox.has(id)) return; // already confirmed by the server
    if (this.mode === "indexeddb" && this.db) {
      try {
        await this.db.put("outbox", this.record(id, entry));
        this.wrote();
        return;
      } catch (err) {
        if (!isQuotaError(err)) console.warn("[local-store] write failed", err);
      }
      await this.handleWriteFailure();
      return;
    }
    await this.persistToSlotOrGoOff();
  }

  /** Steps 1–3 of the fallback chain. Everything is still in memory. */
  private async handleWriteFailure() {
    const images = await this.evictUploadedImages(true);
    const legacy = await this.evictLegacy();
    if (images + legacy > 0 && (await this.writeAllToIdb())) {
      this.notice = `Browser storage was full, so ${
        images > 0
          ? `${images} ${images === 1 ? "image or video" : "images and videos"} already on the server will load from there instead`
          : "old local copies were removed"
      }.`;
      this.wrote();
      return;
    }
    this.mode = "backup-slot";
    this.notice = SLOT_NOTICE;
    this.startIdbRetry();
    await this.persistToSlotOrGoOff();
  }

  private async writeAllToIdb(): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    try {
      const tx = db.transaction("outbox", "readwrite");
      const existing = await tx.store.index("byDrawing").getAll(this.drawingId);
      await Promise.all([
        // This tab's records the server has confirmed meanwhile (other tabs' stay).
        ...existing
          .filter((r) => r.clientId === this.clientId && !this.outbox.has(r.id))
          .map((r) => tx.store.delete(r.id)),
        ...[...this.outbox].map(([id, entry]) => tx.store.put(this.record(id, entry))),
        tx.done,
      ]);
      return true;
    } catch (err) {
      if (!isQuotaError(err)) console.warn("[local-store] write failed", err);
      return false;
    }
  }

  private async persistToSlotOrGoOff() {
    if (this.mode === "indexeddb") return;
    if (await this.writeSlot()) {
      if (this.mode === "off") this.notice = SLOT_NOTICE; // the slot has room again
      this.mode = "backup-slot";
      this.wrote();
    } else {
      if (this.mode !== "off") this.notice = OFF_NOTICE;
      this.mode = "off";
      this.startIdbRetry();
      this.emit();
    }
  }

  /**
   * Drop local copies of images the server already has, oldest first.
   * The editor falls back to loading them from the server.
   */
  private async evictUploadedImages(includeCurrent: boolean): Promise<number> {
    const db = this.db;
    if (!db) return 0;
    try {
      const all = await db.getAll("assets");
      const victims = all
        .filter((a) => a.uploaded && (includeCurrent || a.drawingId !== this.drawingId))
        .sort((a, b) => a.savedAt - b.savedAt);
      if (victims.length === 0) return 0;
      const tx = db.transaction("assets", "readwrite");
      await Promise.all([...victims.map((a) => tx.store.delete(a.id)), tx.done]);
      return victims.length;
    } catch (err) {
      console.warn("[local-store] image eviction failed", err);
      return 0;
    }
  }

  // ---------------------------------------------------------------- images

  /**
   * Keep an image in this browser. Returns false if there's no room even
   * after clearing out copies the server already has; the editor then keeps
   * it in memory until it's uploaded.
   */
  putAsset(asset: Omit<LocalAsset, "drawingId" | "savedAt">): Promise<boolean> {
    const record: LocalAsset = { ...asset, drawingId: this.drawingId, savedAt: Date.now() };
    return new Promise((resolve) => {
      this.enqueue(async () => {
        const db = this.db ?? (await getLocalDb(this.userId).catch(() => null));
        if (!db) return resolve(false);
        const put = () => db.put("assets", record);
        try {
          await put();
          this.wrote();
          return resolve(true);
        } catch (err) {
          if (!isQuotaError(err)) {
            console.warn("[local-store] image write failed", err);
            return resolve(false);
          }
        }
        const freed = (await this.evictUploadedImages(true)) + (await this.evictLegacy());
        if (freed > 0) {
          try {
            await put();
            this.notice = `Browser storage was full, so local copies of ${freed} item${
              freed === 1 ? "" : "s"
            } already on the server were removed to make room for this file.`;
            this.wrote();
            return resolve(true);
          } catch {
            /* fall through */
          }
        }
        this.notice = "Browser storage is full, so this file is kept in memory until it reaches the server.";
        this.emit();
        resolve(false);
      });
    });
  }

  async getAssetBlob(id: string): Promise<Blob | null> {
    const db = this.db ?? (await getLocalDb(this.userId).catch(() => null));
    if (!db) return null;
    try {
      return (await db.get("assets", id))?.blob ?? null;
    } catch {
      return null;
    }
  }

  /** Images of this drawing that haven't reached the server yet. */
  async pendingAssets(): Promise<LocalAsset[]> {
    const db = this.db;
    if (!db) return [];
    try {
      const rows = await db.getAllFromIndex("assets", "byDrawing", this.drawingId);
      return rows.filter((a) => !a.uploaded);
    } catch {
      return [];
    }
  }

  markAssetUploaded(id: string) {
    this.enqueue(async () => {
      const db = this.db;
      if (!db) return;
      try {
        const row = await db.get("assets", id);
        if (row && !row.uploaded) await db.put("assets", { ...row, uploaded: true });
      } catch {
        /* the server has it; a stale flag only means a redundant re-upload */
      }
    });
  }

  /** Forget a file the server refused for good, so it isn't sent again. */
  deleteAsset(id: string) {
    this.enqueue(async () => {
      try {
        await this.db?.delete("assets", id);
      } catch {
        /* nothing to clean up */
      }
    });
  }

  private startIdbRetry() {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setInterval(() => this.enqueue(() => this.retryIdb()), RETRY_IDB_MS);
  }

  private async retryIdb() {
    if (this.mode === "indexeddb") return;
    try {
      this.db ??= await getLocalDb(this.userId);
    } catch {
      return;
    }
    if (!(await this.writeAllToIdb())) return; // still full; try again later
    this.mode = "indexeddb";
    this.clearSlot();
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    this.notice = "Browser storage has room again; changes are saved here as you draw.";
    this.wrote();
  }

  // ---------------------------------------------- localStorage backup slot

  private slotKey() {
    return slotPrefix(this.userId) + this.drawingId;
  }

  private async readSlot(): Promise<{ id: string; ops: DocOp[] }[]> {
    try {
      const raw = localStorage.getItem(this.slotKey());
      if (!raw) return [];
      const rec = JSON.parse(raw) as SlotRecord;
      if (rec.v !== 2) {
        localStorage.removeItem(this.slotKey()); // from before collaboration: a full copy, no longer used
        return [];
      }
      return await unpack<{ id: string; ops: DocOp[] }[]>({ encoding: rec.encoding, bytes: base64ToBytes(rec.data) });
    } catch {
      return [];
    }
  }

  private async writeSlot(): Promise<boolean> {
    if (this.outbox.size === 0) {
      this.clearSlot();
      return true;
    }
    const batches = [...this.outbox].sort((a, b) => a[1].seq - b[1].seq).map(([id, e]) => ({ id, ops: e.ops }));
    const packed = await pack(batches);
    const rec: SlotRecord = { v: 2, encoding: packed.encoding, data: bytesToBase64(packed.bytes), savedAt: Date.now() };
    try {
      localStorage.setItem(this.slotKey(), JSON.stringify(rec));
      return true;
    } catch {
      return false;
    }
  }

  private clearSlot() {
    try {
      localStorage.removeItem(this.slotKey());
    } catch {
      /* storage disabled */
    }
  }

  // ------------------------------------------------------------ plumbing

  private enqueue(task: () => Promise<void>) {
    this.pendingWrites++;
    this.emit();
    this.queue = this.queue
      .then(task)
      .catch((err) => console.error("[local-store]", err))
      .finally(() => {
        this.pendingWrites--;
        this.emit();
      });
  }

  private wrote() {
    this.lastWriteAt = Date.now();
    void this.refreshEstimate();
    this.emit();
  }

  private async refreshEstimate() {
    const now = Date.now();
    if (now - this.lastEstimateAt < ESTIMATE_THROTTLE_MS) return;
    this.lastEstimateAt = now;
    try {
      const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
      this.usage = usage ?? null;
      this.quota = quota ?? null;
    } catch {
      return;
    }
    // Getting close: clear out what the server already has before a write fails.
    const ratio = this.usage && this.quota ? this.usage / this.quota : 0;
    if (ratio < PRESSURE_RATIO) {
      this.pressureHandled = false;
    } else if (!this.pressureHandled) {
      this.pressureHandled = true;
      // Ask the browser not to clear this site's data under disk pressure.
      void navigator.storage?.persist?.().catch(() => {});
      this.enqueue(async () => {
        const freed = (await this.evictUploadedImages(false)) + (await this.evictLegacy());
        if (freed > 0) {
          this.notice = `Browser storage is nearly full, so Canvas removed ${freed} local ${
            freed === 1 ? "copy" : "copies"
          } of images and videos already on the server.`;
          this.lastEstimateAt = 0;
          await this.refreshEstimate();
        }
      });
    }
    this.emit();
  }

  private emit() {
    if (this.disposed) return;
    const status = this.getStatus();
    for (const l of this.listeners) l(status);
  }
}
