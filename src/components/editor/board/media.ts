import { toast } from "@/components/kit";
import type { Point, Rect } from "@/lib/canvas/geometry";
import { AssetError, fileType, inspectGif, type AssetCache } from "@/lib/canvas/images";
import { isVideoType, type AssetElement, type CanvasElement } from "@/lib/canvas/schema";
import type { TracedPicture } from "./types";
import { clamp, MAX_STROKE_COORDS, newId, round1 } from "./util";

/** Pictures, GIFs and videos the board takes. */
export const isMediaFile = (f: File) => {
  const type = fileType(f);
  return type.startsWith("image/") || isVideoType(type);
};

/**
 * Puts files on the board: stores each in the drawing's asset cache
 * (uploading it) and lays them out in the view. One per board, for its
 * asset cache. Problems are told with toasts; what worked comes back.
 */
export class MediaImporter {
  constructor(private readonly cache: AssetCache) {}

  /**
   * The elements for `files`, centred on `center` and stepped down-right,
   * each at its on-screen size but no bigger than 60% of `view`.
   */
  async import(files: readonly File[], center: Point, view: Rect, z: number): Promise<AssetElement[]> {
    const usable = files.filter(isMediaFile);
    if (usable.length === 0) {
      if (files.length) toast.error("Only images, GIFs and videos (MP4, WebM, MOV) can go on the board.");
      return [];
    }
    const dpr = window.devicePixelRatio || 1;
    const added: AssetElement[] = [];
    let offset = 0;
    for (const file of usable) {
      const type = fileType(file);
      try {
        let kind: AssetElement["type"] = "image";
        let a: { id: string; width: number; height: number };
        let pixelScale = dpr;
        if (isVideoType(type)) {
          if (usable.length === 1) toast.loading("Adding the video…", { id: "media" });
          a = await this.cache.addVideo(file, type);
          kind = "video";
          pixelScale = 1;
        } else {
          const gif = type === "image/gif" ? await inspectGif(file) : null;
          if (gif && gif.frames > 1) {
            a = await this.cache.addGif(file, gif);
            kind = "gif";
            pixelScale = 1;
          } else {
            a = await this.cache.add(file);
          }
        }
        // Screenshots are usually 2× pixels: show them at their on-screen size,
        // but no bigger than 60 % of the view.
        let w = a.width / pixelScale;
        let h = a.height / pixelScale;
        const fit = Math.min(1, (view.w * 0.6) / w, (view.h * 0.6) / h);
        w *= fit;
        h *= fit;
        added.push({
          id: newId(),
          type: kind,
          assetId: a.id,
          x: round1(center.x - w / 2 + offset),
          y: round1(center.y - h / 2 + offset),
          w: round1(w),
          h: round1(h),
        });
        offset += 24 / z;
      } catch (err) {
        if (err instanceof AssetError) toast.error(err.message, { id: "media" });
        else {
          console.warn("[board] couldn't add file", err);
          toast.error(`Couldn't add ${file.name || "that file"}.`, { id: "media" });
        }
      }
    }
    if (added.length) toast.dismiss("media");
    return added;
  }
}

/**
 * Traced strokes placed where a picture would go: in the middle of `view`,
 * at the picture's on-screen size (a phone photo is shrunk to 60% of the
 * view; a screenshot keeps its size), in `color` with the marker brush.
 */
export function tracedStrokes(picture: TracedPicture, view: Rect, color: string): CanvasElement[] {
  const dpr = window.devicePixelRatio || 1;
  const w0 = picture.naturalWidth / dpr;
  const h0 = picture.naturalHeight / dpr;
  const fit = Math.min(1, (view.w * 0.6) / w0, (view.h * 0.6) / h0);
  const k = (w0 * fit) / picture.width; // world units per traced pixel
  const x0 = view.x + view.w / 2 - (picture.width * k) / 2;
  const y0 = view.y + view.h / 2 - (picture.height * k) / 2;
  const ink = color === "#ffffff" ? "#201f24" : color;
  return picture.strokes.map((st) => ({
    id: newId(),
    type: "stroke",
    color: ink,
    brush: "marker",
    size: clamp(round1(st.size * k), 0.5, 400),
    points: st.points.slice(0, MAX_STROKE_COORDS).map((v, i) => round1(i % 2 === 0 ? x0 + v * k : y0 + v * k)),
  }));
}
