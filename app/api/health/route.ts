import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/client-ip";
import { runHealthChecks } from "@/lib/ops/health-checks";

export const runtime = "nodejs";
// Health must reflect live state (worker heartbeat, queue depth), never a
// cached response, or it reports stale worker start times.
export const dynamic = "force-dynamic";

/**
 * Details (process id, host name, queue counts, error text) only for the
 * server itself or a caller holding HEALTH_TOKEN. Requests through
 * Cloudflare carry cf-connecting-ip and the public host, so the public URL
 * only says ok or degraded. (Next.js adds x-forwarded-* to every direct
 * connection, so those headers can't tell local from remote.)
 */
function mayShowDetails(request: Request): boolean {
  const token = process.env.HEALTH_TOKEN;
  const given = request.headers.get("x-health-token");
  if (token && given && token.length === given.length) {
    if (timingSafeEqual(Buffer.from(token), Buffer.from(given))) return true;
  }
  return isLocalRequest(request);
}

export async function GET(request: Request) {
  const { healthy, checks } = await runHealthChecks();

  if (!mayShowDetails(request)) {
    return NextResponse.json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503 });
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 }
  );
}
