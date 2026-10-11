import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { jsonError, requireWorkspace } from "../../_shared";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Event types counted per step. */
const NODE_EVENT_TYPES = [
  "SENT",
  "CLICKED",
  "INPUT_VALID",
  "INPUT_INVALID",
  "REPLIED",
  "CONDITION_TRUE",
  "CONDITION_FALSE",
  "SEND_FAILED",
] as const;

type NodeEventType = (typeof NODE_EVENT_TYPES)[number];

const RUN_STATUSES = ["RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] as const;

const MAX_DAYS = 365;

function emptyNodeCounts(): Record<NodeEventType, number> {
  return Object.fromEntries(NODE_EVENT_TYPES.map((type) => [type, 0])) as Record<NodeEventType, number>;
}

/**
 * GET /api/flows/:id/stats?days=30
 *
 * Per-step event counts and run totals. Without `days` the counts cover
 * the flow's whole life.
 */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace();
  if (context instanceof NextResponse) return context;
  const { id } = await params;

  const rawDays = request.nextUrl.searchParams.get("days");
  let days: number | null = null;
  if (rawDays !== null && rawDays !== "" && rawDays !== "all") {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
      return jsonError(400, `days must be a whole number from 1 to ${MAX_DAYS}`);
    }
    days = parsed;
  }
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!flow) return jsonError(404, "Flow not found");

  const [eventRows, runRows] = await Promise.all([
    prisma.flowEvent.groupBy({
      by: ["nodeId", "type"],
      where: {
        flowId: flow.id,
        type: { in: [...NODE_EVENT_TYPES] },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    }),
    prisma.flowRun.groupBy({
      by: ["status"],
      where: { flowId: flow.id, ...(since ? { startedAt: { gte: since } } : {}) },
      _count: { _all: true },
    }),
  ]);

  const nodes: Record<string, Record<NodeEventType, number>> = {};
  const totals = emptyNodeCounts();
  for (const row of eventRows) {
    const type = row.type as NodeEventType;
    nodes[row.nodeId] ??= emptyNodeCounts();
    nodes[row.nodeId][type] += row._count._all;
    totals[type] += row._count._all;
  }

  const runs = Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as Record<
    (typeof RUN_STATUSES)[number],
    number
  > & { total?: number };
  let totalRuns = 0;
  for (const row of runRows) {
    runs[row.status as (typeof RUN_STATUSES)[number]] = row._count._all;
    totalRuns += row._count._all;
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        days,
        since: since?.toISOString() ?? null,
        nodes,
        totals,
        runs: { ...runs, total: totalRuns },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
