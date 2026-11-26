/**
 * Profile pictures for drawing next to other people's cursors. One cache for
 * the tab (a singleton): each picture loads once, however many boards or
 * peers show it, and whoever asked first is told when it's ready to draw.
 */
export class AvatarImages {
  static readonly shared = new AvatarImages();

  private readonly images = new Map<string, HTMLImageElement>();
  private readonly waiting = new Map<string, Set<() => void>>();

  private constructor() {}

  /** The picture if it has loaded; otherwise starts loading it and calls `onReady` when it has. */
  get(url: string, onReady: () => void): HTMLImageElement | null {
    const img = this.images.get(url);
    if (img?.complete && img.naturalWidth > 0) return img;
    if (!img) {
      const next = new Image();
      next.decoding = "async";
      next.onload = () => {
        for (const cb of this.waiting.get(url) ?? []) cb();
        this.waiting.delete(url);
      };
      next.onerror = () => this.waiting.delete(url);
      next.src = url;
      this.images.set(url, next);
    }
    let set = this.waiting.get(url);
    if (!set) this.waiting.set(url, (set = new Set()));
    set.add(onReady);
    return null;
  }
}

/** Up to two initials for someone without a picture. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
