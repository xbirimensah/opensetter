/**
 * Local media storage (MEDIA_DIR, default ./data/media).
 *
 * Two kinds of files live here:
 * - assets/<workspaceId>/<assetId>-<filename>: uploads used by flow steps,
 *   served publicly at /api/media/<assetId>/<filename> so Meta can fetch
 *   them when a flow sends an image, video, voice note or PDF;
 * - inbound/<conversationId>/<messageId>-<index>.<ext>: copies of media
 *   people sent us. Meta's lookaside CDN URLs expire, so the mirror keeps
 *   its own copy and the inbox serves it behind auth.
 */

import { createReadStream } from "fs";
import { mkdir, stat, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { getBaseUrl } from "@/lib/env";

/** Hard cap on any stored file; Meta's own send limit is 25MB. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function getMediaDir(): string {
  return path.resolve(process.env.MEDIA_DIR ?? path.join(process.cwd(), "data", "media"));
}

/** Resolve a storage key inside MEDIA_DIR, refusing path traversal. */
export function resolveMediaKey(key: string): string {
  const root = getMediaDir();
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("Invalid media key");
  }
  return full;
}

export function safeFilename(name: string): string {
  const base = path.basename(name).normalize("NFKD");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(0, 120);
}

export async function saveMedia(key: string, data: Uint8Array): Promise<void> {
  if (data.byteLength > MAX_MEDIA_BYTES) throw new Error("File too large");
  const full = resolveMediaKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function mediaSize(key: string): Promise<number | null> {
  try {
    return (await stat(resolveMediaKey(key))).size;
  } catch {
    return null;
  }
}

/** A web stream for a stored file, optionally a byte range (audio/video seeking). */
export function mediaStream(
  key: string,
  range?: { start: number; end: number }
): ReadableStream {
  const node = createReadStream(resolveMediaKey(key), range);
  return Readable.toWeb(node) as ReadableStream;
}

/** Public URL Meta fetches when a flow sends an uploaded asset. */
export function publicAssetUrl(asset: { id: string; filename: string }): string {
  return `${getBaseUrl().replace(/\/$/, "")}/api/media/${asset.id}/${encodeURIComponent(asset.filename)}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string | null | undefined): string {
  return (mimeType && EXTENSIONS[mimeType.split(";")[0].trim()]) || "bin";
}

/**
 * Copy one inbound CDN file into MEDIA_DIR. Returns the storage key and
 * content type, or null when the download fails or is too large.
 */
export async function downloadInboundMedia(params: {
  url: string;
  conversationId: string;
  messageId: string;
  index: number;
}): Promise<{ key: string; mimeType: string } | null> {
  try {
    const response = await fetch(params.url, { redirect: "follow" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_MEDIA_BYTES) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_MEDIA_BYTES) return null;
    const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim();
    const key = path.join(
      "inbound",
      safeFilename(params.conversationId),
      `${safeFilename(params.messageId)}-${params.index}.${extensionFor(mimeType)}`
    );
    await saveMedia(key, buffer);
    return { key, mimeType };
  } catch {
    return null;
  }
}
