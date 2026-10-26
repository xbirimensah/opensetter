import { NextResponse, type NextRequest } from "next/server";
import { isLocalRequest } from "@/lib/client-ip";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Called by servers, not browsers, and authenticated their own way: Meta
 * webhooks (HMAC signature), schedulers (CRON_SECRET), Auth.js (its own
 * CSRF token), the integration API (API keys only, never the session
 * cookie). They skip the same-origin check, not the size cap.
 */
const SERVER_TO_SERVER_PREFIXES = ["/api/webhook", "/api/cron/", "/api/auth/", "/api/v1/"];
const MEDIA_UPLOAD_PATH = "/api/media";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
// Uploads are capped at 25 MB (lib/media/storage.ts); multipart adds framing.
const MAX_UPLOAD_BODY_BYTES = 26 * 1024 * 1024;

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

function reject(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * The visitor reached us over plain http. Cloudflare says so in cf-visitor.
 * Next.js itself stamps x-forwarded-proto "http" on every direct
 * connection, so that header only counts for requests addressed to the
 * public host, never for local ones (health checks, the cron job).
 */
function cameInOverHttp(request: NextRequest): boolean {
  const visitor = request.headers.get("cf-visitor");
  if (visitor) return /"scheme"\s*:\s*"http"/.test(visitor);
  if (isLocalRequest(request)) return false;
  return request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "http";
}

/** Hosts this app answers on, for the same-origin check. */
function ownHosts(request: NextRequest): Set<string> {
  const hosts = new Set<string>();
  for (const value of [request.headers.get("host"), request.headers.get("x-forwarded-host")]) {
    if (value) hosts.add(value.split(",")[0].trim().toLowerCase());
  }
  try {
    if (process.env.NEXTAUTH_URL) hosts.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase());
  } catch {
    // An invalid NEXTAUTH_URL is reported by the env check at startup.
  }
  return hosts;
}

/**
 * Guards every state-changing API call: body size caps, the declared
 * content type, and same-origin (CSRF): a page on another site can't make
 * a signed-in browser change anything here.
 */
function guardApiWrite(request: NextRequest, pathname: string): NextResponse | null {
  const isUpload = pathname === MEDIA_UPLOAD_PATH;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > (isUpload ? MAX_UPLOAD_BODY_BYTES : MAX_JSON_BODY_BYTES)) {
    return reject(413, "Request body too large");
  }
  if (SERVER_TO_SERVER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return reject(403, "Cross-site requests are not allowed");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return reject(403, "Cross-site requests are not allowed");
    }
    if (!ownHosts(request).has(originHost)) return reject(403, "Cross-site requests are not allowed");
  }

  // A body without a length can't be capped up front: browsers always send one.
  if (!request.headers.has("content-length") && request.headers.has("transfer-encoding")) {
    return reject(411, "Send a Content-Length");
  }
  const hasBody = length > 0;
  if (hasBody) {
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    const expected = isUpload ? "multipart/form-data" : "application/json";
    if (!type.startsWith(expected)) return reject(415, `Send ${expected}`);
  }
  return null;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (process.env.NODE_ENV === "production" && cameInOverHttp(request)) {
    // The public host, not the internal one the tunnel connects to.
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
    if (host) {
      return NextResponse.redirect(`https://${host}${pathname}${request.nextUrl.search}`, 308);
    }
  }

  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const blocked = guardApiWrite(request, pathname);
    if (blocked) return blocked;
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isProtected && !hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // No "/login while logged in -> dashboard" shortcut here: a cookie can be
  // present but no longer valid (expired, or from before the switch to JWT
  // sessions), and the dashboard would bounce it straight back. The login
  // page checks the session properly instead.
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
