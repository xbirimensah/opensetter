import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  flowFirstText,
  parseFlowGraphShape,
  parseFlowTriggersShape,
} from "@/lib/flows/validate";
import {
  buildValidation,
  defaultFlowGraph,
  FLOW_AUTOMATION_SELECT,
  jsonError,
  OPEN_RUN_STATUSES,
  readJsonBody,
  requireWorkspace,
} from "./_shared";

// Read-your-writes list (a new flow must show up at once): never cache.
export const dynamic = "force-dynamic";

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instagramAccountId: z.string().min(1).max(64),
  graph: z.unknown().optional(),
  triggers: z.unknown().optional(),
});

/** GET /api/flows?instagramAccountId= : the workspace's flows plus its accounts. */
export async function GET(request: NextRequest) {
  const context = await requireWorkspace();
  if (context instanceof NextResponse) return context;
  const { workspaceId } = context;

  const accountId = request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter = accountId && accountId !== "all" ? { instagramAccountId: accountId } : {};

  const [flows, accounts] = await Promise.all([
    prisma.flow.findMany({
      where: { workspaceId, ...accountFilter },
      include: {
        instagramAccount: { select: { id: true, username: true } },
        automations: { select: { id: true, name: true, isActive: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      select: { id: true, username: true, instagramId: true, name: true },
      orderBy: { connectedAt: "desc" },
    }),
  ]);

  const runCounts = flows.length
    ? await prisma.flowRun.groupBy({
        by: ["flowId"],
        where: { flowId: { in: flows.map((f) => f.id) }, status: { in: [...OPEN_RUN_STATUSES] } },
        _count: { _all: true },
      })
    : [];
  const activeRuns = new Map(runCounts.map((row) => [row.flowId, row._count._all] as const));

  const data = flows.map((flow) => {
    const graph = parseFlowGraphShape(flow.graph);
    const triggers = parseFlowTriggersShape(flow.triggers);
    return {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      instagramAccountId: flow.instagramAccountId,
      instagramAccount: flow.instagramAccount,
      triggers: triggers.ok ? triggers.value : [],
      nodeCount: graph.ok ? graph.value.nodes.length : 0,
      firstText: graph.ok ? flowFirstText(graph.value) : null,
      automations: flow.automations,
      activeRuns: activeRuns.get(flow.id) ?? 0,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    };
  });

  return NextResponse.json(
    { success: true, data, accounts },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST /api/flows { name, instagramAccountId, graph?, triggers? } : creates a DRAFT flow. */
export async function POST(request: NextRequest) {
  const context = await requireWorkspace({ manage: true, action: "create flows" });
  if (context instanceof NextResponse) return context;
  const { workspaceId } = context;

  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = createFlowSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonError(400, "Invalid input", { details: parsed.error.flatten() });
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: parsed.data.instagramAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) return jsonError(400, "Choose a connected Instagram account");

  const graph = parsed.data.graph === undefined ? { ok: true as const, value: defaultFlowGraph() } : parseFlowGraphShape(parsed.data.graph);
  if (!graph.ok) return jsonError(400, "The flow steps are malformed", { errors: graph.errors });
  const triggers = parsed.data.triggers === undefined ? { ok: true as const, value: [] } : parseFlowTriggersShape(parsed.data.triggers);
  if (!triggers.ok) return jsonError(400, "The flow triggers are malformed", { errors: triggers.errors });

  const flow = await prisma.flow.create({
    data: {
      workspaceId,
      instagramAccountId: account.id,
      name: parsed.data.name,
      status: "DRAFT",
      graph: graph.value as unknown as Prisma.InputJsonValue,
      triggers: triggers.value as unknown as Prisma.InputJsonValue,
    },
    include: {
      instagramAccount: { select: { id: true, username: true, name: true } },
      automations: { select: FLOW_AUTOMATION_SELECT },
    },
  });

  const validation = await buildValidation({
    workspaceId,
    flowId: flow.id,
    instagramAccountId: flow.instagramAccountId,
    graph: flow.graph,
    triggers: flow.triggers,
    commentTriggered: false,
  });

  return NextResponse.json(
    { success: true, data: { ...flow, activeRuns: 0 }, validation },
    { status: 201 }
  );
}
