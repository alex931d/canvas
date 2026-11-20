/**
 * Profile pictures, shared by the browser and the server. The browser crops
 * the chosen photo to a centred square and encodes it at AVATAR_SIZE before
 * uploading, so the server only checks and stores small images.
 */

export const AVATAR_SIZE = 256;
/** A 256 px WebP or JPEG is usually 10–40 KB; this leaves plenty of room. */
export const MAX_AVATAR_BYTES = 300 * 1024;
export const AVATAR_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Where a person's picture is served from, with its version so caches stay right; null for none. */
export function avatarUrl(userId: string, updatedAt: Date | string | null | undefined): string | null {
  if (!updatedAt) return null;
  const v = new Date(updatedAt).getTime();
  return Number.isFinite(v) ? `/api/avatars/${userId}?v=${v.toString(36)}` : null;
}

/** The image type the bytes really are (from their first bytes), whatever the upload claimed. */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  const at = (i: number, ...want: number[]) => want.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}
