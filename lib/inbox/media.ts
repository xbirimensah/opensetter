/**
 * Pure helpers for the inbox media route (/api/inbox/media/<id>/<index>).
 *
 * Kept free of server imports so they can be unit tested and reused by
 * the browser (the inbox decides which card images go through the proxy).
 */

/** Meta CDN hosts the proxy may fetch from. Everything else is refused (SSRF). */
const EXACT_HOSTS = new Set(["lookaside.fbsbx.com"]);
const HOST_SUFFIXES = [".fbcdn.net", ".cdninstagram.com"];

/**
 * True when `raw` is an https URL on a Meta CDN host: lookaside.fbsbx.com,
 * *.fbcdn.net (incl. scontent*.xx.fbcdn.net) or *.cdninstagram.com. No
 * credentials, no custom ports.
 */
export function isAllowedMediaUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (EXACT_HOSTS.has(host)) return true;
  return HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * Parse a single `Range: bytes=...` header against a file of `size` bytes.
 *
 * - null: no usable range (absent, malformed, other unit, multi-range);
 *   serve the whole file with 200.
 * - "unsatisfiable": answer 416 with `Content-Range: bytes * /size`.
 * - ByteRange: answer 206 with exactly these bytes.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const value = header.trim();
  if (!value.toLowerCase().startsWith("bytes=")) return null;
  const spec = value.slice("bytes=".length).trim();
  // Multiple ranges would need multipart/byteranges; a full 200 is valid.
  if (!spec || spec.includes(",")) return null;

  const match = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix)) return null;
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return "unsatisfiable";

  if (!rawEnd) return { start, end: size - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end)) return null;
  // last-byte-pos before first-byte-pos makes the header invalid: ignore it.
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Types the browser may render inline from our origin. Everything else downloads. */
const INLINE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "video/3gpp",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/3gpp",
  "audio/amr",
  "application/pdf",
]);

/**
 * The Content-Type to send and whether it may render inline. HTML, SVG,
 * XML and anything unknown are served as an octet-stream download so a
 * file someone sent cannot run script on the dashboard's origin.
 */
export function servableContentType(mime: string | null | undefined): {
  contentType: string;
  inline: boolean;
} {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (INLINE_TYPES.has(base)) return { contentType: base, inline: true };
  return { contentType: "application/octet-stream", inline: false };
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
};

/** Best guess at a stored file's type from its key's extension. */
export function mimeFromKey(key: string): string | null {
  const ext = key.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_TYPES[ext]) || null;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 name. */
export function contentDisposition(inline: boolean, filename?: string | null): string {
  const type = inline ? "inline" : "attachment";
  const name = filename?.trim();
  if (!name) return type;
  const ascii = name.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_").slice(0, 120);
  return `${type}; filename="${ascii || "file"}"; filename*=UTF-8''${encodeURIComponent(name.slice(0, 120))}`;
}

/** Same-origin URL the inbox uses for attachment `index` of a message. */
export function inboxMediaPath(messageId: string, index: number): string {
  return `/api/inbox/media/${encodeURIComponent(messageId)}/${index}`;
}
