/**
 * Public file URL for uploaded flow media: /api/media/<id>/<filename>.
 *
 * No auth on purpose: Meta's servers fetch it when a flow sends an image,
 * video, voice note or PDF. The random asset id is the capability, the
 * filename must match too, and nothing else is listed or revealed.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { mediaSize, mediaStream } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string; filename: string }> };

const ASSET_ID = /^[a-z0-9]{8,64}$/i;
/** Asset bytes never change for an id, so caches can keep them for a year. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

type ByteRange = { start: number; end: number };

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Parse a single `bytes=` range. Multi-range or malformed headers are
 * ignored (full response), as RFC 9110 allows.
 */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function serve(request: NextRequest, { params }: RouteProps, withBody: boolean): Promise<Response> {
  const { id, filename } = await params;
  if (!ASSET_ID.test(id)) return notFound();

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, filename: true, mimeType: true, storageKey: true, createdAt: true },
  });
  if (!asset || (asset.filename !== filename && asset.filename !== safeDecode(filename))) {
    return notFound();
  }

  const size = await mediaSize(asset.storageKey);
  if (size === null) return notFound();

  const etag = `"${asset.id}-${size}"`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    "Last-Modified": asset.createdAt.toUTCString(),
    "X-Content-Type-Options": "nosniff",
    // Opened directly, a file can never run script or load anything; Meta
    // and the app still fetch it cross-origin.
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Disposition": `inline; filename="${asset.filename.replace(/["\\\r\n]/g, "_")}"`,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const length = range.end - range.start + 1;
    return new Response(withBody ? mediaStream(asset.storageKey, range) : null, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  return new Response(withBody && size > 0 ? mediaStream(asset.storageKey) : null, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}

export async function GET(request: NextRequest, props: RouteProps) {
  return serve(request, props, true);
}

export async function HEAD(request: NextRequest, props: RouteProps) {
  return serve(request, props, false);
}
