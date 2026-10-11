/**
 * Outbound HTTP for the flow "External Request" action.
 *
 * Flow authors choose the URL, so requests are restricted to public https
 * hosts: no loopback, private, link-local or metadata addresses (the
 * OpenSetter host runs Postgres, Redis and other services locally).
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT, also Tailscale
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower);
  }
  return true;
}

export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https URLs are allowed");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private hosts are not allowed");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Private network addresses are not allowed");
  }
  return url;
}

export async function safeRequest(params: {
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const url = await assertPublicHttpsUrl(params.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: params.method,
      // Redirects could point back into the private network.
      redirect: "error",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenSetter/1.0; +https://github.com/obirimensah05/opensetter)",
        ...(params.body ? { "Content-Type": "application/json" } : {}),
        ...(params.headers ?? {}),
      },
      body: params.method === "POST" ? params.body : undefined,
    });
    const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}
