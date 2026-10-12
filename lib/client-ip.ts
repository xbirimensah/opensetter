/**
 * The real client IP. Behind Cloudflare (the tunnel is the only way in, the
 * server listens on localhost) cf-connecting-ip is set by Cloudflare and
 * can't be forged; x-real-ip / x-forwarded-for cover other reverse proxies.
 */
export function clientIp(headers: Headers): string | null {
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Requests made on the server itself (health checks, the cron job). */
export function isLocalRequest(request: Request): boolean {
  if (request.headers.has("cf-connecting-ip")) return false;
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOCAL_HOSTS.has(host);
}
