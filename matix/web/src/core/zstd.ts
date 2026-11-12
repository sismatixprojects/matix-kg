import { decompress as fzstd } from "fzstd";

/** Decompresses a zstd frame (cursor images, clipboard, file blocks). Returns undefined on error. */
export async function decompress(data: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    return fzstd(data);
  } catch (e) {
    console.warn("zstd decompress failed", e);
    return undefined;
  }
}
