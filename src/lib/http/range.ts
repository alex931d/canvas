/** HTTP Range requests (RFC 9110 §14), single ranges only. */

/** Largest piece sent for an open-ended range ("bytes=0-"); players ask for the rest. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

export type ByteRange = { start: number; end: number };

/**
 * The byte range a Range header asks for, within a file of `size` bytes.
 * "invalid" when it can't be satisfied (answer 416), null when there is no
 * usable header (several ranges or another unit: send the whole file).
 * Open-ended ranges are capped at `chunk` bytes.
 */
export function parseRange(header: string | null, size: number, chunk = CHUNK_BYTES): ByteRange | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    // The last N bytes.
    const n = Number(b);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? Math.min(size - 1, start + chunk - 1) : Math.min(Number(b), size - 1);
  }
  if (start >= size || end < start) return "invalid";
  return { start, end };
}
