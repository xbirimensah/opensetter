import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { isOperatorWorkspace } from "@/lib/ai-setter/operator";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import { getWorkerAlerts, getWorkerHealth } from "@/lib/ops/worker-health";

export const runtime = "nodejs";

const REDIS_CHECK_TIMEOUT_MS = 3_000;

/** The check's result, or the fallback when it fails or Redis doesn't answer in time. */
function withTimeout<T>(check: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    check.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), REDIS_CHECK_TIMEOUT_MS)),
  ]);
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  // Queue, worker and error details are for the people who run the workspace.
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can see diagnostics" },
      { status: 403 }
    );
  }
  const { workspaceId } = context;
  // Instance-wide events (no workspace: system errors, sign-in audit) are the
  // operator's alone; other workspaces see only their own.
  const seesInstanceEvents = await isOperatorWorkspace(workspaceId);

  const [
    queueCounts,
    workerHealth,
    workerAlerts,
    webhookFailures,
    dmFailures,
    tokenRefreshFailures,
    operationalEvents,
  ] = await Promise.all([
    // Redis-backed checks give up after a few seconds, so the database
    // sections (failures, events) still load while Redis is down.
    withTimeout(
      getDMQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      {} as Record<string, number>
    ),
    withTimeout(getWorkerHealth(), { healthy: false, heartbeat: null, ageMs: null }),
    withTimeout(getWorkerAlerts(10), []),
    prisma.webhookEvent.findMany({
      where: { workspaceId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        object: true,
        errorMessage: true,
        createdAt: true,
        processedAt: true,
      },
    }),
    prisma.dmLog.findMany({
      where: {
        workspaceId,
        status: {
          in: [
            "FAILED",
            "SKIPPED_RATE_LIMIT",
            "SKIPPED_PLAN_LIMIT",
            "SKIPPED_NO_MATCH",
          ],
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        commentId: true,
        commentText: true,
        errorMessage: true,
        updatedAt: true,
        automation: { select: { name: true } },
      },
    }),
    prisma.operationalEvent.findMany({
      where: { workspaceId, source: "TOKEN_REFRESH", level: "ERROR" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        message: true,
        createdAt: true,
        payload: true,
      },
    }),
    prisma.operationalEvent.findMany({
      where: seesInstanceEvents ? { OR: [{ workspaceId }, { workspaceId: null }] } : { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        source: true,
        level: true,
        message: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      queueCounts,
      workerHealth,
      workerAlerts,
      webhookFailures,
      dmFailures,
      tokenRefreshFailures,
      operationalEvents,
    },
  });
}
