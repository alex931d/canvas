import type { Point, Rect } from "@/lib/canvas/geometry";
import { clamp } from "./util";

export const MIN_Z = 0.1;
export const MAX_Z = 8;

export type Size = { w: number; h: number };

/**
 * Where the board's view is: the world point at the screen's top-left
 * corner and the zoom, so screen = (world - {x, y}) * z. Immutable: every
 * move makes a new Camera, which is what React state wants.
 */
export class Camera {
  readonly z: number;

  constructor(
    readonly x: number,
    readonly y: number,
    z: number,
  ) {
    this.z = clamp(z, MIN_Z, MAX_Z);
  }

  /** Where a new board starts before it knows its size. */
  static readonly initial = new Camera(-80, -60, 1);

  toWorld(sx: number, sy: number): Point {
    return { x: this.x + sx / this.z, y: this.y + sy / this.z };
  }

  toScreen(p: Point): Point {
    return { x: (p.x - this.x) * this.z, y: (p.y - this.y) * this.z };
  }

  /** What a screen of this size shows, in world coordinates. */
  view(size: Size): Rect {
    return { x: this.x, y: this.y, w: size.w / this.z, h: size.h / this.z };
  }

  /** The world point at the middle of the screen. */
  center(size: Size): Point {
    return this.toWorld(size.w / 2, size.h / 2);
  }

  /** Moved by screen pixels (dragging the board the other way). */
  panned(dsx: number, dsy: number): Camera {
    return new Camera(this.x + dsx / this.z, this.y + dsy / this.z, this.z);
  }

  /** Zoomed to `z`, keeping the world point under the screen point (sx, sy) where it is. */
  zoomedAt(sx: number, sy: number, z: number): Camera {
    const nz = clamp(z, MIN_Z, MAX_Z);
    const w = this.toWorld(sx, sy);
    return new Camera(w.x - sx / nz, w.y - sy / nz, nz);
  }

  /** Two fingers: scaled by how far they spread, keeping the point under their first midpoint under them. */
  pinched(mid0: Point, dist0: number, mid: Point, dist: number): Camera {
    const z = clamp((this.z * dist) / Math.max(dist0, 1), MIN_Z, MAX_Z);
    const w = this.toWorld(mid0.x, mid0.y);
    return new Camera(w.x - mid.x / z, w.y - mid.y / z, z);
  }

  /**
   * A rectangle filling 85% of the screen (zoomed in no further than `maxZ`),
   * in the part not covered by a panel on the right.
   */
  static fitting(r: Rect, size: Size, maxZ = 1, coveredRight = 0): Camera {
    const w = Math.max(160, size.w - coveredRight);
    const z = clamp(Math.min((w * 0.85) / Math.max(r.w, 1), (size.h * 0.85) / Math.max(r.h, 1)), MIN_Z, maxZ);
    return new Camera(r.x + r.w / 2 - w / 2 / z, r.y + r.h / 2 - size.h / 2 / z, z);
  }

  /** A saved or sent camera, if it is one. */
  static parse(v: unknown): Camera | null {
    const c = v as Partial<Record<"x" | "y" | "z", unknown>> | null;
    if (!c || ![c.x, c.y, c.z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return new Camera(c.x as number, c.y as number, c.z as number);
  }

  toJSON() {
    return { x: this.x, y: this.y, z: this.z };
  }
}

/** Each drawing's view, remembered on this device (localStorage), so it opens where you left it. */
export class CameraMemory {
  constructor(private readonly drawingId: string) {}

  get key() {
    return `canvas-camera:${this.drawingId}`;
  }

  load(): Camera | null {
    try {
      return Camera.parse(JSON.parse(localStorage.getItem(this.key) ?? "null"));
    } catch {
      return null;
    }
  }

  save(cam: Camera) {
    try {
      localStorage.setItem(this.key, JSON.stringify(cam));
    } catch {
      /* storage full or disabled: not important */
    }
  }
}
