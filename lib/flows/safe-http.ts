/**
 * Outbound HTTP for the flow "External Request" action.
 *
 * Flow authors choose the URL, so requests are restricted to public https
 * hosts: no loopback, private, link-local or metadata addresses (the
 * OpenSetter host runs Postgres, Redis and other services locally).
 */

import { isIP } from "net";
import { isPrivateAddress as isPrivateProviderAddress } from "@/lib/ai-setter/providers/base-url";
import { requestGuarded } from "@/lib/ai-setter/providers/guarded-request";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Loopback, private, CGNAT (also Tailscale), link-local, benchmark,
 * multicast and the IPv6 forms that embed one of those. Non-IP input is
 * treated as unsafe.
 */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "");
  if (!isIP(host)) return true;
  if (isPrivateProviderAddress(host)) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    // CGNAT is checked here too, so the guard never depends on one list.
    return a === 100 && b >= 64 && b <= 127;
  }
  return false;
}

export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if (url.port && url.port !== "443") throw new Error("Only the standard https port is allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private hosts are not allowed");
  }
  if (isIP(host) && isPrivateAddress(host)) throw new Error("Private network addresses are not allowed");
  return url;
}

/** Headers a flow author may not set: they'd change how the request travels, not what it says. */
const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "te", "trailer", "upgrade",
  "keep-alive", "proxy-authorization", "proxy-connection", "expect",
]);

function authorHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => !FORBIDDEN_HEADERS.has(name.toLowerCase()))
  );
}

export async function safeRequest(params: {
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const url = assertPublicHttpsUrl(params.url);
  // Resolution is checked at connect time (no DNS rebinding), redirects are
  // refused (they could point back into the private network) and the body
  // read stops at MAX_RESPONSE_BYTES.
  const response = await requestGuarded(url.toString(), {
    method: params.method,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; OpenSetter/1.0; +https://github.com/xbirimensah/opensetter)",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
      ...authorHeaders(params.headers),
    },
    body: params.method === "POST" ? params.body : undefined,
    timeoutMs: TIMEOUT_MS,
    allowPrivate: false,
    maxBytes: MAX_RESPONSE_BYTES,
  });
  let json: unknown = null;
  try {
    json = response.body ? JSON.parse(response.body) : null;
  } catch {
    json = null;
  }
  return { ok: response.status >= 200 && response.status < 300, status: response.status, json };
}
