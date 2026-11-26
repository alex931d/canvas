import { deleteDrawing } from "@/app/actions";
import { assetIdsOf } from "@/lib/canvas/schema";
import { BrowserLibrary, type BrowserDrawing } from "./library";

/**
 * Moves drawings from this browser (the free plan) into the signed-in
 * member's account: the drawing first (/api/drawings/import, under the id it
 * already has), then each image, GIF and video it shows, and only once the
 * server has all of it is the browser's copy removed. Anything that goes
 * wrong leaves the drawing in the browser, where it was.
 *
 * Retrying is safe: the server keeps a drawing it already has, and files it
 * already has are skipped. One move runs at a time per page.
 */

export type MoveProgress = { done: number; total: number; title: string | null };
export type MoveFailure = { id: string; title: string; reason: string };
export type MoveResult = { moved: string[]; failed: MoveFailure[] };

export class MoveError extends Error {
  constructor(
    message: string,
    /** Nothing else will move either (signed out, no membership): stop. */
    readonly stopAll = false,
  ) {
    super(message);
  }
}

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrowserDrawingMover {
  static readonly shared = new BrowserDrawingMover();

  private running: Promise<MoveResult> | null = null;

  constructor(private readonly library: BrowserLibrary = BrowserLibrary.shared) {}

  /** Move every drawing in this browser. A second call while one runs joins it. */
  moveAll(onProgress?: (p: MoveProgress) => void): Promise<MoveResult> {
    this.running ??= this.run(null, onProgress).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Move one drawing; resolves its id in the account (the same id). */
  async moveOne(id: string): Promise<string> {
    if (this.running) await this.running.catch(() => undefined);
    const result = await this.run([id]);
    if (result.failed.length) throw new MoveError(result.failed[0].reason);
    return id;
  }

  // ------------------------------------------------- into the browser

  /**
   * The other way, after a membership ends: an account drawing comes into
   * this browser (same id, its files first), then the server's copy is
   * deleted, freeing the space. Anything that goes wrong leaves it where it
   * was. Resolves the ids that moved, and why the others didn't.
   */
  async intoBrowser(ids: string[], onProgress?: (p: MoveProgress) => void): Promise<MoveResult> {
    const result: MoveResult = { moved: [], failed: [] };
    for (const [i, id] of ids.entries()) {
      onProgress?.({ done: i, total: ids.length, title: null });
      try {
        const title = await this.takeIntoBrowser(id);
        onProgress?.({ done: i, total: ids.length, title });
        result.moved.push(id);
      } catch (err) {
        result.failed.push({ id, title: "", reason: err instanceof Error ? err.message : "It couldn't be moved." });
        if (err instanceof MoveError && err.stopAll) break;
      }
    }
    onProgress?.({ done: ids.length, total: ids.length, title: null });
    return result;
  }

  private async takeIntoBrowser(id: string): Promise<string> {
    const res = await this.send(() => fetch(`/api/drawings/${id}/export`, { cache: "no-store" }));
    const drawing = (await res.json()) as {
      title: string;
      data: BrowserDrawing["data"];
      presentation: BrowserDrawing["presentation"];
      thumbnail: string | null;
      updatedAt: string;
      files: { id: string; mimeType: string; width: number; height: number }[];
    };
    const shown = assetIdsOf(drawing.data.elements);
    try {
      for (const file of drawing.files.filter((f) => shown.has(f.id))) {
        const blob = await (await this.send(() => fetch(`/api/assets/${file.id}`))).blob();
        const kept = await this.library.putAsset({
          id: file.id,
          drawingId: id,
          blob: blob.type ? blob : new Blob([blob], { type: file.mimeType }),
          mimeType: file.mimeType,
          width: file.width,
          height: file.height,
        });
        if (!kept) throw new MoveError("This browser's storage is full, so it stayed in your account.", true);
      }
      await this.library.create({
        id,
        title: drawing.title,
        data: drawing.data,
        presentation: drawing.presentation,
        thumbnail: drawing.thumbnail,
        updatedAt: Date.parse(drawing.updatedAt) || Date.now(),
      });
    } catch (err) {
      await this.library.delete(id).catch(() => undefined); // nothing half-copied left behind
      throw err;
    }
    // The browser has it all: free the server's copy.
    await deleteDrawing(id).catch(() => undefined);
    return drawing.title;
  }

  // ----------------------------------------------------------- plumbing

  private async run(only: string[] | null, onProgress?: (p: MoveProgress) => void): Promise<MoveResult> {
    const ids = only ?? (await this.library.list()).map((d) => d.id);
    const result: MoveResult = { moved: [], failed: [] };
    for (const [i, id] of ids.entries()) {
      const drawing = await this.library.get(id);
      if (!drawing) continue;
      onProgress?.({ done: i, total: ids.length, title: drawing.title });
      try {
        await this.move(drawing);
        result.moved.push(id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "It couldn't be moved.";
        result.failed.push({ id, title: drawing.title, reason });
        if (err instanceof MoveError && err.stopAll) {
          // The rest would fail the same way.
          for (const rest of ids.slice(i + 1)) {
            const d = await this.library.get(rest);
            if (d) result.failed.push({ id: rest, title: d.title, reason });
          }
          break;
        }
      }
    }
    onProgress?.({ done: ids.length, total: ids.length, title: null });
    return result;
  }

  private async move(drawing: BrowserDrawing) {
    const res = await this.send(() =>
      fetch("/api/drawings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: drawing.id,
          title: drawing.title,
          data: drawing.data,
          presentation: drawing.presentation,
          thumbnail: drawing.thumbnail,
        }),
      }),
    );
    const { existed } = (await res.json()) as { existed: boolean };

    // Its files, the ones it still shows.
    const shown = assetIdsOf(drawing.data.elements);
    const files = (await this.library.assetsOf(drawing.id)).filter((a) => shown.has(a.id));
    try {
      for (const file of files) {
        await this.send(() => {
          const form = new FormData();
          form.set("id", file.id);
          form.set("width", String(file.width));
          form.set("height", String(file.height));
          form.set("file", file.blob);
          return fetch(`/api/drawings/${drawing.id}/assets`, { method: "POST", body: form });
        });
      }
    } catch (err) {
      // Don't leave a copy without its pictures in the account; the browser still has it all.
      if (!existed && !(err instanceof MoveError && err.stopAll)) await deleteDrawing(drawing.id).catch(() => undefined);
      throw err;
    }

    await this.library.delete(drawing.id);
  }

  /** One request, retried when the server is busy or unreachable; throws a MoveError saying why it failed. */
  private async send(request: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await request();
      } catch {
        res = null;
      }
      if (res?.ok) return res;
      const status = res?.status ?? 0;
      if (status === 401) throw new MoveError("You've been signed out. Log in again to move your drawings.", true);
      if (status === 402) throw new MoveError("Moving drawings into an account is part of the membership.", true);
      if (status === 404) throw new MoveError("It isn't in your account any more.");
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= RETRIES) {
        const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        throw new MoveError(
          body.error ?? (status === 0 ? "The server couldn't be reached. Check your connection and try again." : "It couldn't be moved."),
        );
      }
      const after = Number(res?.headers.get("Retry-After") ?? 0);
      await sleep(after > 0 ? Math.min(after, 10) * 1000 : 500 * 2 ** attempt);
    }
  }
}
