/**
 * The checks behind /api/health, shared with the health watcher
 * (lib/ops/health-watch.ts) so both judge "healthy" the same way.
 */

import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { getWorkerHealth, type WorkerHealth } from "@/lib/ops/worker-health";

export type CheckStatus = "ok" | "error";

export interface HealthCheck {
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

export interface HealthReport {
  healthy: boolean;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    queue: HealthCheck & { counts?: unknown };
    worker: WorkerHealth & { error?: string };
  };
}

export async function runHealthChecks(): Promise<HealthReport> {
  const [database, redis, queue, worker] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueue(),
    getWorkerHealth().catch((error): WorkerHealth & { error?: string } => ({
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

  return { healthy, checks: { database, redis, queue, worker } };
}

/** One line per failing check, for alerts. */
export function describeFailures(report: HealthReport): string[] {
  const { database, redis, queue, worker } = report.checks;
  const lines: string[] = [];
  if (database.status !== "ok") lines.push(`Database: ${database.detail ?? "error"}`);
  if (redis.status !== "ok") lines.push(`Redis: ${redis.detail ?? "error"}`);
  if (queue.status !== "ok") lines.push(`Queue: ${queue.detail ?? "error"}`);
  if (!worker.healthy) {
    lines.push(
      worker.error
        ? `Worker: ${worker.error}`
        : worker.ageMs === null
          ? "Worker: no heartbeat (the DM worker is not running)"
          : `Worker: last heartbeat ${Math.round(worker.ageMs / 1000)} s ago`
    );
  }
  return lines;
}
