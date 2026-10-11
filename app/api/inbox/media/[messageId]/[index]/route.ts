import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { mediaSize, mediaStream } from "@/lib/media/storage";
import { mediaSourceFor, parseStoredAttachments, type MediaSource } from "@/lib/inbox/attachments";
import {
  contentDisposition,
  isAllowedMediaUrl,
  mimeFromKey,
  parseRangeHeader,
  servableContentType,
} from "@/lib/inbox/media";

/** Redirect hops followed on the CDN; every hop is re-checked against the allowlist. */
const MAX_REDIRECTS = 3;
/** Time to first byte from Meta. The body itself may stream for longer. */
const UPSTREAM_TIMEOUT_MS = 15_000;
/** Stored copies never change; CDN proxies only briefly (URLs expire). */
const LOCAL_CACHE = "private, max-age=86400";
const PROXY_CACHE = "private, max-age=300";

type RouteProps = { params: Promise<{ messageId: string; index: string }> };

function json(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

function gone() {
  return json(410, "This media is no longer available from Instagram. Open Instagram to view it.");
}

function securityHeaders(contentType: string, inline: boolean, name?: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(inline, name),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    // A sandboxed, script-free document if someone opens the URL directly.
    // PDFs are exempt: Chrome refuses to render a sandboxed PDF.
    ...(contentType === "application/pdf"
      ? {}
      : { "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
  };
}

/**
 * Bytes for attachment `index` of a mirrored DM, for the signed-in
 * workspace only. Serves the stored copy (with Range support so voice
 * notes and videos can seek); otherwise proxies the Meta CDN URL, which
 * answers 410 once Meta has expired it. Never fetches non-Meta hosts.
 */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return json(401, "Unauthorized");

  const { messageId, index: rawIndex } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageId) || !/^\d{1,2}$/.test(rawIndex)) {
    return json(400, "Invalid media reference");
  }

  const message = await prisma.dmMessage.findFirst({
    where: {
      id: messageId,
      conversation: { instagramAccount: { workspaceId: context.workspaceId } },
    },
    select: { attachments: true },
  });
  if (!message) return json(404, "Not found");

  const attachment = parseStoredAttachments(message.attachments)[Number(rawIndex)];
  const source = attachment ? mediaSourceFor(attachment) : null;
  if (!source) return json(404, "Not found");

  if (source.localKey) {
    const local = await serveLocal(source, source.localKey, request.headers.get("range"));
    if (local) return local;
  }
  if (source.url && isAllowedMediaUrl(source.url)) {
    return proxyCdn(source, source.url, request);
  }
  return gone();
}

async function serveLocal(
  source: MediaSource,
  key: string,
  rangeHeader: string | null
): Promise<Response | null> {
  // mediaSize also refuses keys that escape MEDIA_DIR (returns null).
  const size = await mediaSize(key);
  if (size === null) return null;

  const { contentType, inline } = servableContentType(source.mimeType ?? mimeFromKey(key));
  const headers = {
    ...securityHeaders(contentType, inline, source.name),
    "Accept-Ranges": "bytes",
    "Cache-Control": LOCAL_CACHE,
  };

  const range = parseRangeHeader(rangeHeader, size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${size}` },
    });
  }
  if (range) {
    return new Response(mediaStream(key, range), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(mediaStream(key), {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}

/** Fetch from the CDN, following only redirects that stay on Meta hosts. */
async function fetchAllowed(
  startUrl: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
): Promise<Response | null> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { ...init, redirect: "manual", cache: "no-store" });
    if (response.status < 300 || response.status >= 400) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) return null;
    const next = new URL(location, url).toString();
    if (!isAllowedMediaUrl(next)) return null;
    url = next;
  }
  return null;
}

async function proxyCdn(source: MediaSource, url: string, request: NextRequest): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), UPSTREAM_TIMEOUT_MS);
  // Abort the upstream read too when the browser goes away (seeks, closes).
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  const range = request.headers.get("range");

  try {
    const upstream = await fetchAllowed(url, {
      headers: range ? { Range: range } : {},
      signal,
    });
    clearTimeout(timer);

    if (upstream?.status === 416) {
      await upstream.body?.cancel();
      const contentRange = upstream.headers.get("content-range");
      return new Response(null, {
        status: 416,
        headers: contentRange ? { "Content-Range": contentRange } : {},
      });
    }
    if (!upstream || !upstream.ok || !upstream.body) {
      await upstream?.body?.cancel();
      return gone();
    }

    const upstreamType = upstream.headers.get("content-type");
    const declared =
      upstreamType && !/octet-stream/i.test(upstreamType) ? upstreamType : source.mimeType ?? upstreamType;
    const { contentType, inline } = servableContentType(declared);

    const headers: Record<string, string> = {
      ...securityHeaders(contentType, inline, source.name),
      "Cache-Control": PROXY_CACHE,
    };
    // fetch() decodes compressed bodies, so a compressed length would lie.
    const passThrough = upstream.headers.get("content-encoding")
      ? ["content-range", "accept-ranges"]
      : ["content-length", "content-range", "accept-ranges"];
    for (const name of passThrough) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }

    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  } catch (err) {
    clearTimeout(timer);
    if (!request.signal.aborted) console.warn("[Inbox media] CDN fetch failed:", err);
    return gone();
  }
}
