import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  parseFlowGraphShape,
  parseFlowTriggersShape,
  referencedFlowIds,
} from "@/lib/flows/validate";
import {
  buildValidation,
  FLOW_AUTOMATION_SELECT,
  jsonError,
  OPEN_RUN_STATUSES,
  readJsonBody,
  requireWorkspace,
} from "../_shared";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const updateFlowSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional(),
  graph: z.unknown().optional(),
  triggers: z.unknown().optional(),
});

const FLOW_INCLUDE = {
  instagramAccount: { select: { id: true, username: true, name: true } },
  automations: { select: FLOW_AUTOMATION_SELECT, orderBy: { createdAt: "asc" } },
} as const;

async function countOpenRuns(flowId: string): Promise<number> {
  return prisma.flowRun.count({ where: { flowId, status: { in: [...OPEN_RUN_STATUSES] } } });
}

/** GET /api/flows/:id : the flow, its campaigns and its validation. */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace();
  if (context instanceof NextResponse) return context;
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: FLOW_INCLUDE,
  });
  if (!flow) return jsonError(404, "Flow not found");

  const [activeRuns, validation] = await Promise.all([
    countOpenRuns(flow.id),
    buildValidation({
      workspaceId: context.workspaceId,
      flowId: flow.id,
      instagramAccountId: flow.instagramAccountId,
      graph: flow.graph,
      triggers: flow.triggers,
      commentTriggered: flow.automations.length > 0,
    }),
  ]);

  return NextResponse.json(
    { success: true, data: { ...flow, activeRuns }, validation },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * PUT /api/flows/:id { name?, status?, graph?, triggers? }
 *
 * Drafts save with rule errors (the editor shows them); a flow that is or
 * becomes ACTIVE must have none.
 */
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace({ manage: true, action: "change flows" });
  if (context instanceof NextResponse) return context;
  const { id } = await params;

  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const parsed = updateFlowSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonError(400, "Invalid input", { details: parsed.error.flatten() });
  }

  const existing = await prisma.flow.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: { automations: { select: { id: true } } },
  });
  if (!existing) return jsonError(404, "Flow not found");

  const data: Prisma.FlowUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  let graphInput: unknown = existing.graph;
  if (parsed.data.graph !== undefined) {
    const graph = parseFlowGraphShape(parsed.data.graph);
    if (!graph.ok) return jsonError(400, "The flow steps are malformed", { errors: graph.errors });
    graphInput = graph.value;
    data.graph = graph.value as unknown as Prisma.InputJsonValue;
  }

  let triggersInput: unknown = existing.triggers;
  if (parsed.data.triggers !== undefined) {
    const triggers = parseFlowTriggersShape(parsed.data.triggers);
    if (!triggers.ok) return jsonError(400, "The flow triggers are malformed", { errors: triggers.errors });
    triggersInput = triggers.value;
    data.triggers = triggers.value as unknown as Prisma.InputJsonValue;
  }

  const validation = await buildValidation({
    workspaceId: context.workspaceId,
    flowId: existing.id,
    instagramAccountId: existing.instagramAccountId,
    graph: graphInput,
    triggers: triggersInput,
    commentTriggered: existing.automations.length > 0,
  });

  const nextStatus = parsed.data.status ?? existing.status;
  if (nextStatus === "ACTIVE" && validation.errors.length > 0) {
    const count = validation.errors.length;
    return jsonError(
      400,
      `Fix ${count} ${count === 1 ? "problem" : "problems"} before this flow can be active.`,
      { errors: validation.errors.map((issue) => issue.message), validation }
    );
  }

  const flow = await prisma.flow.update({
    where: { id: existing.id },
    data,
    include: FLOW_INCLUDE,
  });

  return NextResponse.json({
    success: true,
    data: { ...flow, activeRuns: await countOpenRuns(flow.id) },
    validation,
  });
}

/** DELETE /api/flows/:id : refused (409) while campaigns or other flows use it. */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace({ manage: true, action: "delete flows" });
  if (context instanceof NextResponse) return context;
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: context.workspaceId },
    include: { automations: { select: { id: true, name: true } } },
  });
  if (!flow) return jsonError(404, "Flow not found");

  if (flow.automations.length > 0) {
    const names = flow.automations.map((a) => `"${a.name}"`).join(", ");
    return jsonError(
      409,
      `This flow runs in ${flow.automations.length === 1 ? "the campaign" : "the campaigns"} ${names}. Switch ${flow.automations.length === 1 ? "it" : "them"} to another flow or the simple DM first.`,
      { campaigns: flow.automations }
    );
  }

  // Other flows that start this one would break silently, so refuse too.
  const siblings = await prisma.flow.findMany({
    where: { workspaceId: context.workspaceId, id: { not: flow.id } },
    select: { id: true, name: true, graph: true },
  });
  const starters = siblings
    .filter((sibling) => {
      const graph = parseFlowGraphShape(sibling.graph);
      return graph.ok && referencedFlowIds(graph.value).some((ref) => ref.flowId === flow.id);
    })
    .map((sibling) => ({ id: sibling.id, name: sibling.name }));
  if (starters.length > 0) {
    const names = starters.map((s) => `"${s.name}"`).join(", ");
    return jsonError(
      409,
      `The ${starters.length === 1 ? "flow" : "flows"} ${names} ${starters.length === 1 ? "starts" : "start"} this flow. Remove those steps or buttons first.`,
      { flows: starters }
    );
  }

  await prisma.flow.delete({ where: { id: flow.id } });
  return NextResponse.json({ success: true, data: { deleted: true } });
}
