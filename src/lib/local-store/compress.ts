/**
 * JSON <-> gzip bytes using the browser's built-in CompressionStream.
 * Drawing JSON (long lists of coordinates) typically shrinks 4–8×.
 */

export type Packed = {
  encoding: "gzip" | "json";
  bytes: Uint8Array<ArrayBuffer>;
};

export async function pack(value: unknown): Promise<Packed> {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === "function") {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    return { encoding: "gzip", bytes: new Uint8Array(buffer) };
  }
  return { encoding: "json", bytes: new TextEncoder().encode(json) };
}

export async function unpack<T>(packed: Packed): Promise<T> {
  if (packed.encoding === "gzip") {
    const stream = new Blob([packed.bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as T;
  }
  return JSON.parse(new TextDecoder().decode(packed.bytes)) as T;
}

/** Base64 for storing packed bytes in localStorage (which only holds strings). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
