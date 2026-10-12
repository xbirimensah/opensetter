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
