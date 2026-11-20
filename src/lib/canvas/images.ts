import { decompressFrame, parseGIF, type ParsedGif } from "gifuct-js";
import type { LocalDrawingStore } from "@/lib/local-store/store";
import type { MediaView } from "./render";
import { MAX_ASSET_BYTES, MAX_VIDEO_BYTES, VIDEO_MIME_TYPES, type MediaElement } from "./schema";

/**
 * Images, GIFs and videos on the canvas, client side.
 *
 *  add / addGif / addVideo   show immediately, keep in IndexedDB (or memory
 *                            when the browser is full), upload later
 *  get(id)                   decoded image for rendering; loads from IndexedDB
 *                            first, then from the server, and calls onChange
 *  media(el)                 the current frame of a GIF or video
 *  tick(now, visible)        advance playing GIFs; true when a frame changed
 *  uploadPending()           send files the server doesn't have yet (before each sync)
 */

export const MAX_IMAGE_SIDE = 2400;
export const MAX_GIF_SIDE = 4096;

type Entry = { status: "loading" } | { status: "ready"; img: HTMLImageElement } | { status: "error" };

type PendingAsset = { blob: Blob; width: number; height: number };

export type AddedAsset = { id: string; width: number; height: number };

/**
 * "signed-out": the server answered 401, so retrying won't help until sign-in.
 * "membership": it answered 402: the membership has ended.
 * rejected: the server refused these files for good (too big, wrong type,
 * out of space); changes that use them can't be saved.
 */
export type UploadResult = "ok" | "failed" | "signed-out" | "membership" | { rejected: string[]; message: string };

/** A file the board can't take, with a sentence saying why. */
export class AssetError extends Error {}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : // RFC 4122 v4 fallback for insecure contexts (http on a LAN IP)
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (Math.floor(Math.random() * 16) >> (+c / 4))).toString(16),
      );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** File types from the name, for files the browser gave no type. */
export function fileType(file: File | Blob): string {
  if (file.type) return file.type;
  const ext = "name" in file ? file.name.toLowerCase().split(".").pop() : undefined;
  return (
    { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", gif: "image/gif" } as Record<string, string>
  )[ext ?? ""] ?? "";
}

/** Downscale very large images and re-encode to a compact format. */
export async function prepareImage(file: Blob): Promise<PendingAsset> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(w0, h0));
    const keepOriginal =
      scale === 1 && ["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size < 2_000_000;
    if (keepOriginal) return { blob: file, width: w0, height: h0 };

    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    // Browsers that can't encode WebP hand back PNG, which is fine too.
    return { blob: blob ?? file, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Frame count and size of a GIF, or null when it isn't one (or isn't readable). */
export async function inspectGif(file: Blob): Promise<{ frames: number; width: number; height: number } | null> {
  try {
    const gif = parseGIF(await file.arrayBuffer());
    return { frames: gif.frames.filter((f) => "image" in f).length, width: gif.lsd.width, height: gif.lsd.height };
  } catch {
    return null;
  }
}

/** Size and length of a video this browser can play; throws AssetError otherwise. */
export function inspectVideo(blob: Blob): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const cantPlay = () =>
      done(() => reject(new AssetError("This browser can't play that video. Try an MP4 (H.264) or WebM file.")));
    const timer = setTimeout(cantPlay, 15_000);
    v.onloadedmetadata = () => {
      // Read these before done() unloads the video, which resets them to 0.
      const meta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
      if (meta.width > 0 && meta.height > 0) done(() => resolve(meta));
      else cantPlay();
    };
    v.onerror = cantPlay;
    v.src = url;
  });
}

// ------------------------------------------------------------------ GIFs

type GifFrame = Extract<ParsedGif["frames"][number], { image: unknown }>;
type Dims = { top: number; left: number; width: number; height: number };

/** Plays an animated GIF onto a canvas, decoding one frame at a time. */
export class GifPlayer {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  playing: boolean;
  private ctx: CanvasRenderingContext2D;
  private patch = document.createElement("canvas");
  private frames: GifFrame[];
  private gct: ParsedGif["gct"];
  private index = -1;
  private nextAt = 0;
  private prev: { disposal: number; dims: Dims; saved: ImageData | null } | null = null;

  constructor(bytes: ArrayBuffer, autoplay: boolean) {
    const gif = parseGIF(bytes);
    this.frames = gif.frames.filter((f): f is GifFrame => "image" in f);
    if (this.frames.length === 0) throw new Error("no frames");
    this.gct = gif.gct;
    this.width = Math.max(1, gif.lsd.width);
    this.height = Math.max(1, gif.lsd.height);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.playing = autoplay && this.frames.length > 1;
    this.step(performance.now());
  }

  get animated() {
    return this.frames.length > 1;
  }

  /** Show the next frame if it's due. True when the picture changed. */
  tick(now: number): boolean {
    if (!this.playing || now < this.nextAt) return false;
    this.step(now);
    return true;
  }

  play() {
    if (!this.animated) return;
    this.playing = true;
    this.nextAt = 0;
  }

  pause() {
    this.playing = false;
  }

  private step(now: number) {
    const i = (this.index + 1) % this.frames.length;
    const f = decompressFrame(this.frames[i], this.gct, true);
    const ctx = this.ctx;
    if (i === 0) {
      ctx.clearRect(0, 0, this.width, this.height);
      this.prev = null;
    } else if (this.prev?.disposal === 2) {
      const d = this.prev.dims;
      ctx.clearRect(d.left, d.top, d.width, d.height);
    } else if (this.prev?.disposal === 3 && this.prev.saved) {
      ctx.putImageData(this.prev.saved, this.prev.dims.left, this.prev.dims.top);
    }
    const { dims } = f;
    let saved: ImageData | null = null;
    if (f.disposalType === 3 && dims.width > 0 && dims.height > 0) {
      saved = ctx.getImageData(dims.left, dims.top, dims.width, dims.height);
    }
    if (dims.width > 0 && dims.height > 0 && f.patch.length === dims.width * dims.height * 4) {
      this.patch.width = dims.width;
      this.patch.height = dims.height;
      this.patch.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(f.patch), dims.width, dims.height), 0, 0);
      // drawImage (unlike putImageData) keeps the pixels a transparent frame doesn't cover.
      ctx.drawImage(this.patch, dims.left, dims.top);
    }
    this.prev = { disposal: f.disposalType ?? 0, dims, saved };
    this.index = i;
    // Browsers show very short delays as 100 ms; so do we.
    const delay = !f.delay || f.delay < 20 ? 100 : f.delay;
    // After a long pause (tab hidden, scrolled away) don't race to catch up.
    this.nextAt = now - this.nextAt > 1000 ? now + delay : this.nextAt + delay;
  }
}

// ------------------------------------------------------------------ video

export type VideoState = {
  playing: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  ready: boolean;
  error: boolean;
};

/** One <video> per asset. Its current frame is drawn onto the canvas. */
export class VideoPlayer {
  readonly video: HTMLVideoElement;
  private listeners = new Set<() => void>();
  private state: VideoState = { playing: false, currentTime: 0, duration: 0, muted: false, ready: false, error: false };
  private frameDirty = false;

  constructor(
    src: string,
    private readonly onChange: () => void,
  ) {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    this.video = v;
    const update = () => this.update();
    v.addEventListener("loadedmetadata", () => {
      // Ask for a frame near the start so there's a picture before playing.
      if (v.currentTime === 0 && Number.isFinite(v.duration)) v.currentTime = Math.min(0.05, v.duration / 2);
      update();
    });
    for (const ev of ["loadeddata", "seeked", "pause", "ended", "timeupdate", "volumechange", "durationchange"]) {
      v.addEventListener(ev, update);
    }
    v.addEventListener("play", () => {
      this.watchFrames();
      update();
    });
    v.addEventListener("error", () => {
      this.state = { ...this.state, error: true };
      this.emit();
    });
    v.src = src;
  }

  /** Note each new frame while playing, where the browser can tell us. */
  private watchFrames() {
    const v = this.video;
    if (!("requestVideoFrameCallback" in v)) return;
    const onFrame = () => {
      this.frameDirty = true;
      if (!v.paused && !v.ended) v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  private update() {
    const v = this.video;
    const next: VideoState = {
      playing: !v.paused && !v.ended,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      muted: v.muted,
      ready: v.readyState >= 2,
      error: this.state.error,
    };
    const s = this.state;
    if (
      s.playing === next.playing &&
      s.currentTime === next.currentTime &&
      s.duration === next.duration &&
      s.muted === next.muted &&
      s.ready === next.ready
    ) {
      return;
    }
    this.state = next;
    this.frameDirty = true; // the board repaints on its next tick
    for (const l of this.listeners) l();
    // The rest of the editor only cares when playback starts, stops or the first frame arrives.
    if (s.playing !== next.playing || s.ready !== next.ready || s.muted !== next.muted) this.onChange();
  }

  private emit() {
    for (const l of this.listeners) l();
    this.onChange();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  /** True once per new frame (for repainting). */
  takeFrame(): boolean {
    const dirty = this.frameDirty;
    this.frameDirty = false;
    // Without requestVideoFrameCallback, assume a new frame on every tick while playing.
    return dirty || (this.state.playing && !("requestVideoFrameCallback" in this.video));
  }

  toggle() {
    if (this.state.error) return;
    if (this.video.paused || this.video.ended) {
      if (this.video.ended) this.video.currentTime = 0;
      void this.video.play().catch(() => {
        // Blocked (no user gesture yet): try again without sound.
        this.video.muted = true;
        void this.video.play().catch(() => {});
      });
    } else this.video.pause();
  }

  pause() {
    if (!this.video.paused) this.video.pause();
  }

  seek(seconds: number) {
    if (Number.isFinite(seconds)) this.video.currentTime = Math.max(0, Math.min(seconds, this.state.duration || seconds));
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.listeners.clear();
  }
}

// ------------------------------------------------------------------ cache

type GifEntry = { status: "loading" } | { status: "ready"; player: GifPlayer } | { status: "error" };

export class AssetCache {
  private entries = new Map<string, Entry>();
  private gifs = new Map<string, GifEntry>();
  private videos = new Map<string, { status: "loading" } | { status: "ready"; player: VideoPlayer }>();
  private urls = new Map<string, string>();
  private memoryOnly = new Map<string, PendingAsset>();
  private rejected = new Set<string>();
  private uploading: Promise<UploadResult> | null = null;
  /** GIFs start paused for people who asked their system for less motion. */
  readonly reducedMotion =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private readonly drawingId: string,
    private readonly store: () => LocalDrawingStore | null,
    private readonly onChange: () => void,
  ) {}

  // -------------------------------------------------------------- reading

  get = (id: string): HTMLImageElement | null => {
    const entry = this.entries.get(id);
    if (entry?.status === "ready") return entry.img;
    if (!entry) void this.load(id);
    return null;
  };

  private async localBlob(id: string): Promise<Blob | null> {
    return this.memoryOnly.get(id)?.blob ?? (await this.store()?.getAssetBlob(id)) ?? null;
  }

  private objectUrl(id: string, blob: Blob) {
    const existing = this.urls.get(id);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }

  private async load(id: string) {
    this.entries.set(id, { status: "loading" });
    try {
      const blob = await this.localBlob(id);
      const img = await loadImage(blob ? this.objectUrl(id, blob) : `/api/assets/${id}`);
      this.entries.set(id, { status: "ready", img });
      this.onChange();
    } catch {
      this.entries.set(id, { status: "error" });
      // Try again later (e.g. it was still uploading from another device).
      setTimeout(() => {
        if (this.entries.get(id)?.status === "error") this.entries.delete(id);
      }, 10_000);
    }
  }

  gif(id: string): GifPlayer | null {
    const entry = this.gifs.get(id);
    if (entry?.status === "ready") return entry.player;
    if (!entry) void this.loadGif(id);
    return null;
  }

  private async loadGif(id: string, bytes?: ArrayBuffer) {
    this.gifs.set(id, { status: "loading" });
    try {
      let data = bytes;
      if (!data) {
        const blob = await this.localBlob(id);
        if (blob) data = await blob.arrayBuffer();
        else {
          const res = await fetch(`/api/assets/${id}`);
          if (!res.ok) throw new Error(String(res.status));
          data = await res.arrayBuffer();
        }
      }
      this.gifs.set(id, { status: "ready", player: new GifPlayer(data, !this.reducedMotion) });
      this.onChange();
    } catch {
      this.gifs.set(id, { status: "error" });
      this.onChange();
      setTimeout(() => {
        if (this.gifs.get(id)?.status === "error") this.gifs.delete(id);
      }, 10_000);
    }
  }

  video(id: string): VideoPlayer | null {
    const entry = this.videos.get(id);
    if (entry?.status === "ready") return entry.player;
    if (!entry) void this.loadVideo(id);
    return null;
  }

  private async loadVideo(id: string) {
    this.videos.set(id, { status: "loading" });
    // The copy in this browser if there is one; otherwise stream it from the
    // server, which answers range requests so playback starts straight away.
    const blob = await this.localBlob(id).catch(() => null);
    const player = new VideoPlayer(blob ? this.objectUrl(id, blob) : `/api/assets/${id}`, this.onChange);
    this.videos.set(id, { status: "ready", player });
    const unsubscribe = player.subscribe(() => {
      if (!player.getState().error) return;
      unsubscribe();
      // Maybe it hadn't been uploaded yet from another device: try again later.
      setTimeout(() => {
        const e = this.videos.get(id);
        if (e?.status === "ready" && e.player === player) {
          player.dispose();
          this.videos.delete(id);
          this.onChange();
        }
      }, 10_000);
    });
    this.onChange();
  }

  /** What a GIF or video element shows right now. */
  media = (el: MediaElement): MediaView => {
    if (el.type === "gif") {
      const entry = this.gifs.get(el.assetId);
      const player = this.gif(el.assetId);
      return { source: player?.canvas ?? null, playing: player?.playing ?? false, progress: null, error: entry?.status === "error" };
    }
    const p = this.video(el.assetId);
    if (!p) return { source: null, playing: false, progress: null, error: false };
    const s = p.getState();
    return {
      source: s.ready ? p.video : null,
      playing: s.playing,
      progress: s.duration > 0 ? s.currentTime / s.duration : null,
      error: s.error,
    };
  };

  /** Play or pause a GIF or video. */
  toggle(el: MediaElement) {
    if (el.type === "video") this.video(el.assetId)?.toggle();
    else {
      const g = this.gif(el.assetId);
      if (g?.playing) g.pause();
      else g?.play();
    }
    this.onChange();
  }

  /**
   * Advance GIFs that are on screen and note new video frames.
   * Videos no longer on the board are paused. True when anything changed.
   */
  tick(now: number, visible: ReadonlySet<string>, onBoard: ReadonlySet<string>): boolean {
    let changed = false;
    for (const id of visible) {
      const g = this.gifs.get(id);
      if (g?.status === "ready" && g.player.tick(now)) changed = true;
    }
    for (const [id, entry] of this.videos) {
      if (entry.status !== "ready") continue;
      if (!onBoard.has(id)) {
        entry.player.pause();
        continue;
      }
      if (entry.player.takeFrame() && visible.has(id)) changed = true;
    }
    return changed;
  }

  // -------------------------------------------------------------- adding

  private async keep(id: string, prepared: PendingAsset, mimeType: string) {
    const stored = await this.store()?.putAsset({
      id,
      blob: prepared.blob,
      mimeType,
      width: prepared.width,
      height: prepared.height,
      uploaded: false,
    });
    if (!stored) this.memoryOnly.set(id, prepared);
  }

  /** Add a still image; it is drawable as soon as this resolves. */
  async add(file: Blob): Promise<AddedAsset> {
    const prepared = await prepareImage(file);
    const id = newId();
    this.entries.set(id, { status: "ready", img: await loadImage(this.objectUrl(id, prepared.blob)) });
    await this.keep(id, prepared, prepared.blob.type || "image/png");
    return { id, width: prepared.width, height: prepared.height };
  }

  /** Add an animated GIF, unchanged so it keeps animating. */
  async addGif(file: Blob, size: { width: number; height: number }): Promise<AddedAsset> {
    if (file.size > MAX_ASSET_BYTES) throw new AssetError(`That GIF is larger than ${mb(MAX_ASSET_BYTES)}.`);
    if (Math.max(size.width, size.height) > MAX_GIF_SIDE) {
      throw new AssetError(`GIFs can be up to ${MAX_GIF_SIDE} pixels on a side.`);
    }
    const id = newId();
    const blob = file.type === "image/gif" ? file : new Blob([file], { type: "image/gif" });
    await this.loadGif(id, await blob.arrayBuffer());
    if (this.gifs.get(id)?.status !== "ready") throw new AssetError("That GIF couldn't be read.");
    await this.keep(id, { blob, width: size.width, height: size.height }, "image/gif");
    return { id, ...size };
  }

  /** Add a video file this browser can play (`type`: its MIME type). */
  async addVideo(file: Blob, type: string): Promise<AddedAsset & { duration: number }> {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new AssetError(`That video is ${mb(file.size)}; videos can be up to ${mb(MAX_VIDEO_BYTES)}. Try a shorter clip.`);
    }
    if (!(VIDEO_MIME_TYPES as readonly string[]).includes(type)) {
      throw new AssetError("Videos can be MP4, WebM or QuickTime (.mov) files.");
    }
    const blob = file.type === type ? file : new Blob([file], { type });
    const meta = await inspectVideo(blob);
    const id = newId();
    this.videos.set(id, { status: "ready", player: new VideoPlayer(this.objectUrl(id, blob), this.onChange) });
    await this.keep(id, { blob, width: meta.width, height: meta.height }, type);
    return { id, width: meta.width, height: meta.height, duration: meta.duration };
  }

  // ------------------------------------------------------------ uploading

  /** True when there's something only in this browser's memory. */
  hasUnuploaded(referenced: ReadonlySet<string>) {
    for (const id of this.memoryOnly.keys()) if (referenced.has(id)) return true;
    return false;
  }

  /**
   * Upload every file referenced by the drawing that the server lacks.
   * Resolves "ok" when all are on the server.
   */
  uploadPending(referenced: ReadonlySet<string>): Promise<UploadResult> {
    // Serialize: concurrent syncs would upload the same files twice.
    const run = async (): Promise<UploadResult> => {
      const store = this.store();
      const rejectedNow = [...referenced].filter((id) => this.rejected.has(id));
      if (rejectedNow.length) return { rejected: rejectedNow, message: "That file couldn't be saved." };
      const pending: (PendingAsset & { id: string })[] = [
        ...(await (store?.pendingAssets() ?? Promise.resolve([]))).map((a) => ({
          id: a.id,
          blob: a.blob,
          width: a.width,
          height: a.height,
        })),
        ...[...this.memoryOnly].map(([id, p]) => ({ id, ...p })),
      ].filter((p) => referenced.has(p.id));

      let result: UploadResult = "ok";
      for (const p of pending) {
        const form = new FormData();
        form.set("id", p.id);
        form.set("width", String(p.width));
        form.set("height", String(p.height));
        form.set("file", p.blob);
        try {
          const res = await fetch(`/api/drawings/${this.drawingId}/assets`, { method: "POST", body: form });
          if (res.status === 401) return "signed-out";
          if (res.status === 402) return "membership";
          if (res.status === 413 || res.status === 415) {
            // Never going to be accepted: stop trying, and say why.
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            this.rejected.add(p.id);
            this.memoryOnly.delete(p.id);
            store?.deleteAsset(p.id);
            return { rejected: [p.id], message: body.error ?? "That file couldn't be saved." };
          }
          if (!res.ok) throw new Error(String(res.status));
          this.memoryOnly.delete(p.id);
          store?.markAssetUploaded(p.id);
        } catch {
          result = "failed";
        }
      }
      return result;
    };
    const next = (this.uploading ?? Promise.resolve<UploadResult>("ok")).then(run, run);
    this.uploading = next;
    return next;
  }

  /** The file's bytes, wherever they are (for backups). */
  async getBlob(id: string): Promise<Blob | null> {
    const local = await this.localBlob(id);
    if (local) return local;
    try {
      const res = await fetch(`/api/assets/${id}`);
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }

  dispose() {
    for (const e of this.videos.values()) if (e.status === "ready") e.player.dispose();
    this.videos.clear();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.entries.clear();
    this.gifs.clear();
  }
}
