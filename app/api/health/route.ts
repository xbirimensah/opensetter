import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/client-ip";
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export const runtime = "nodejs";
// Health must reflect live state (worker heartbeat, queue depth), never a
// cached response, or it reports stale worker start times.
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthCheck {
  status: CheckStatus;
  detail?: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database check failed",
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    const pong = await getRedisConnection().ping();
    return { status: pong === "PONG" ? "ok" : "error", detail: pong };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Redis check failed",
    };
  }
}

async function checkQueue(): Promise<HealthCheck & { counts?: unknown }> {
  try {
    const counts = await getDMQueue().getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed"
    );
    return { status: "ok", counts };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Queue check failed",
    };
  }
}

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
  const [database, redis, queue, worker] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueue(),
    getWorkerHealth().catch((error) => ({
      healthy: false,
      heartbeat: null,
      ageMs: null,
      error: error instanceof Error ? error.message : "Worker check failed",
    })),
  ]);

  const healthy =
    database.status === "ok" &&
    redis.status === "ok" &&
    queue.status === "ok" &&
    worker.healthy;

  if (!mayShowDetails(request)) {
    return NextResponse.json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503 });
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database,
        redis,
        queue,
        worker,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
