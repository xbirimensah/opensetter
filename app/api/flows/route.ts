import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  COMMENT_AUTOMATION_SELECT,
  commentTriggerFromRow,
  commentTriggerName,
  commentTriggerData,
  parseEditorTriggersShape,
  type CommentAutomationRow,
} from "@/lib/flows/comment-triggers";
import { flowFromTemplateSlug } from "@/lib/flows/template-flow";
import type { CommentTrigger, FlowGraph, FlowTrigger } from "@/lib/flows/types";
import { flowFirstText, parseFlowGraphShape, parseFlowTriggersShape } from "@/lib/flows/validate";
import { getCampaignTemplateSlugs } from "@/lib/templates/campaign-templates";
import {
  automationRefs,
  buildValidation,
  defaultFlowGraph,
  jsonError,
  mergedTriggers,
  OPEN_RUN_STATUSES,
  readJsonBody,
  requireWorkspace,
} from "./_shared";

// Read-your-writes list (a new flow must show up at once): never cache.
export const dynamic = "force-dynamic";

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  /** Defaults to the most recently connected account. */
  instagramAccountId: z.string().min(1).max(64).optional(),
  graph: z.unknown().optional(),
  /** Editor triggers; comment triggers become DRAFT (inactive) Automation rows. */
  triggers: z.unknown().optional(),
  /** Build the flow from a campaign template (public template pages). */
  template: z.enum(getCampaignTemplateSlugs() as [string, ...string[]]).optional(),
});

/** Sends per automation (DmLog SENT), for list stats. */
async function sentCounts(workspaceId: string): Promise<Map<string, number>> {
  const rows = await prisma.dmLog.groupBy({
    by: ["automationId"],
    where: { workspaceId, status: "SENT" },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.automationId, row._count._all] as const));
}

/**
 * GET /api/flows?instagramAccountId= : the workspace's flows (comment
 * triggers merged into each trigger list), its classic campaigns (comment
 * automations without a flow) and its accounts.
 */
export async function GET(request: NextRequest) {
  const context = await requireWorkspace();
  if (context instanceof NextResponse) return context;
  const { workspaceId } = context;

  const accountId = request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter = accountId && accountId !== "all" ? { instagramAccountId: accountId } : {};

  const [flows, classic, accounts, sends] = await Promise.all([
    prisma.flow.findMany({
      where: { workspaceId, ...accountFilter },
      include: {
        instagramAccount: { select: { id: true, username: true } },
        automations: { select: COMMENT_AUTOMATION_SELECT, orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.automation.findMany({
      where: { workspaceId, flowId: null, ...accountFilter },
      select: {
        ...COMMENT_AUTOMATION_SELECT,
        instagramAccountId: true,
        instagramAccount: { select: { id: true, username: true } },
        dmMessage: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      select: { id: true, username: true, instagramId: true, name: true },
      orderBy: { connectedAt: "desc" },
    }),
    sentCounts(workspaceId),
  ]);

  const flowIds = flows.map((f) => f.id);
  const runRows = flowIds.length
    ? await prisma.flowRun.groupBy({
        by: ["flowId", "status"],
        where: { flowId: { in: flowIds } },
        _count: { _all: true },
      })
    : [];
  const runs = new Map<string, { total: number; open: number }>();
  for (const row of runRows) {
    const entry = runs.get(row.flowId) ?? { total: 0, open: 0 };
    entry.total += row._count._all;
    if ((OPEN_RUN_STATUSES as readonly string[]).includes(row.status)) entry.open += row._count._all;
    runs.set(row.flowId, entry);
  }

  const data = flows.map((flow) => {
    const graph = parseFlowGraphShape(flow.graph);
    const stored = parseFlowTriggersShape(flow.triggers);
    const rows = flow.automations as CommentAutomationRow[];
    const run = runs.get(flow.id) ?? { total: 0, open: 0 };
    return {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      instagramAccountId: flow.instagramAccountId,
      instagramAccount: flow.instagramAccount,
      triggers: [...rows.map(commentTriggerFromRow), ...(stored.ok ? stored.value : [])],
      nodeCount: graph.ok ? graph.value.nodes.length : 0,
      firstText: graph.ok ? flowFirstText(graph.value) : null,
      automations: automationRefs(rows),
      activeRuns: run.open,
      totalRuns: run.total,
      sends: rows.reduce((sum, row) => sum + (sends.get(row.id) ?? 0), 0),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    };
  });

  const classicCampaigns = classic.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    instagramAccountId: row.instagramAccountId,
    instagramAccount: row.instagramAccount,
    trigger: commentTriggerFromRow(row),
    dmMessage: row.dmMessage,
    sends: sends.get(row.id) ?? 0,
    updatedAt: row.updatedAt,
  }));

  return NextResponse.json(
    { success: true, data, classicCampaigns, accounts },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * POST /api/flows { name?, instagramAccountId?, graph?, triggers?, template? }
 * creates a DRAFT flow. Comment triggers in `triggers` (or the template's)
 * are created as inactive Automation rows linked to it.
 */
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
    where: parsed.data.instagramAccountId ? { id: parsed.data.instagramAccountId, workspaceId } : { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!account) return jsonError(400, "Connect an Instagram account first");

  const fromTemplate = parsed.data.template ? flowFromTemplateSlug(parsed.data.template) : null;
  const name = parsed.data.name ?? fromTemplate?.name ?? "Untitled flow";

  let graph: FlowGraph;
  if (fromTemplate) graph = fromTemplate.graph;
  else if (parsed.data.graph === undefined) graph = defaultFlowGraph();
  else {
    const shape = parseFlowGraphShape(parsed.data.graph);
    if (!shape.ok) return jsonError(400, "The flow steps are malformed", { errors: shape.errors });
    graph = shape.value;
  }

  let flowTriggers: FlowTrigger[] = [];
  let commentTriggers: CommentTrigger[] = fromTemplate?.triggers ?? [];
  if (!fromTemplate && parsed.data.triggers !== undefined) {
    const split = parseEditorTriggersShape(parsed.data.triggers);
    if (!split.ok) return jsonError(400, "The flow triggers are malformed", { errors: split.errors });
    flowTriggers = split.value.flowTriggers;
    commentTriggers = split.value.commentTriggers;
  }

  const flow = await prisma.$transaction(async (tx) => {
    const created = await tx.flow.create({
      data: {
        workspaceId,
        instagramAccountId: account.id,
        name,
        status: "DRAFT",
        graph: graph as unknown as Prisma.InputJsonValue,
        triggers: flowTriggers as unknown as Prisma.InputJsonValue,
      },
    });
    for (const [index, trigger] of commentTriggers.entries()) {
      await tx.automation.create({
        data: {
          ...commentTriggerData(trigger),
          name: commentTriggerName(name, index, commentTriggers.length),
          dmMessage: "",
          flowId: created.id,
          isActive: false,
          workspaceId,
          instagramAccountId: account.id,
        },
      });
    }
    return tx.flow.findFirstOrThrow({
      where: { id: created.id },
      include: {
        instagramAccount: { select: { id: true, username: true, name: true } },
        automations: { select: COMMENT_AUTOMATION_SELECT, orderBy: { createdAt: "asc" } },
      },
    });
  });

  const rows = flow.automations as CommentAutomationRow[];
  const validation = await buildValidation({
    workspaceId,
    flowId: flow.id,
    instagramAccountId: flow.instagramAccountId,
    graph: flow.graph,
    triggers: flow.triggers,
    commentTriggers: rows.map(commentTriggerFromRow),
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        ...flow,
        triggers: mergedTriggers(flow.triggers, rows),
        automations: automationRefs(rows),
        activeRuns: 0,
      },
      validation,
    },
    { status: 201 }
  );
}
