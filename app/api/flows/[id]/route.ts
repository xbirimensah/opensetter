import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  automationActiveFor,
  COMMENT_AUTOMATION_SELECT,
  commentTriggerFromRow,
  commentTriggerName,
  parseEditorTriggersShape,
  planCommentTriggerSync,
  rowVersion,
  type CommentAutomationRow,
} from "@/lib/flows/comment-triggers";
import type { CommentTrigger } from "@/lib/flows/types";
import { parseFlowGraphShape, referencedFlowIds } from "@/lib/flows/validate";
import {
  automationRefs,
  buildValidation,
  jsonError,
  mergedTriggers,
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
  /** Editor triggers: Flow.triggers entries plus comment triggers. */
  triggers: z.unknown().optional(),
  /** automationId -> version the editor last saw (comment trigger concurrency). */
  triggerVersions: z.record(z.string().max(64), z.string().max(64)).optional(),
});

const FLOW_INCLUDE = {
  instagramAccount: { select: { id: true, username: true, name: true } },
  automations: {
    select: COMMENT_AUTOMATION_SELECT,
    orderBy: { createdAt: "asc" },
  },
} as const;

type FlowWithRows = Prisma.FlowGetPayload<{ include: typeof FLOW_INCLUDE }>;

async function countOpenRuns(flowId: string): Promise<number> {
  return prisma.flowRun.count({
    where: { flowId, status: { in: [...OPEN_RUN_STATUSES] } },
  });
}

/** The flow as the editor reads it: comment triggers merged into `triggers`. */
function serializeFlow(flow: FlowWithRows, activeRuns: number) {
  const rows = flow.automations as CommentAutomationRow[];
  return {
    id: flow.id,
    name: flow.name,
    status: flow.status,
    instagramAccountId: flow.instagramAccountId,
    instagramAccount: flow.instagramAccount,
    graph: flow.graph,
    triggers: mergedTriggers(flow.triggers, rows),
    automations: automationRefs(rows),
    triggerVersions: Object.fromEntries(
      rows.map((row) => [row.id, rowVersion(row)]),
    ),
    activeRuns,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

/** GET /api/flows/:id : the flow (comment triggers merged in) and its validation. */
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
      commentTriggers: (flow.automations as CommentAutomationRow[]).map(
        commentTriggerFromRow,
      ),
    }),
  ]);

  return NextResponse.json(
    { success: true, data: serializeFlow(flow, activeRuns), validation },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * PUT /api/flows/:id { name?, status?, graph?, triggers?, triggerVersions? }
 *
 * Drafts save with rule errors (the editor shows them); a flow that is or
 * becomes ACTIVE must have none. Comment triggers in `triggers` are synced
 * to their Automation rows in the same transaction as the flow, and every
 * linked row's isActive follows the flow status.
 */
class FlowSaveConflict extends Error {}

export async function PUT(request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace({
    manage: true,
    action: "change flows",
  });
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
    include: FLOW_INCLUDE,
  });
  if (!existing) return jsonError(404, "Flow not found");
  const existingRows = existing.automations as CommentAutomationRow[];

  const data: Prisma.FlowUpdateInput = {};
  const nextName = parsed.data.name ?? existing.name;
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  let graphInput: unknown = existing.graph;
  if (parsed.data.graph !== undefined) {
    const graph = parseFlowGraphShape(parsed.data.graph);
    if (!graph.ok)
      return jsonError(400, "The flow steps are malformed", {
        errors: graph.errors,
      });
    graphInput = graph.value;
    data.graph = graph.value as unknown as Prisma.InputJsonValue;
  }

  let triggersInput: unknown = existing.triggers;
  // undefined: the request leaves the comment triggers alone.
  let submittedComments: CommentTrigger[] | undefined;
  if (parsed.data.triggers !== undefined) {
    const split = parseEditorTriggersShape(parsed.data.triggers);
    if (!split.ok)
      return jsonError(400, "The flow triggers are malformed", {
        errors: split.errors,
      });
    triggersInput = split.value.flowTriggers;
    submittedComments = split.value.commentTriggers;
    data.triggers = split.value
      .flowTriggers as unknown as Prisma.InputJsonValue;
  }
  const commentTriggers =
    submittedComments ?? existingRows.map(commentTriggerFromRow);

  const plan = submittedComments
    ? planCommentTriggerSync({
        existing: existingRows,
        submitted: submittedComments,
        flowName: nextName,
        renamed: nextName !== existing.name,
        versions: parsed.data.triggerVersions,
      })
    : null;
  if (plan && plan.conflicts.length > 0) {
    const rowById = new Map(existingRows.map((row) => [row.id, row] as const));
    return jsonError(
      409,
      "A comment trigger changed outside the editor. It was refreshed; check it and save again.",
      {
        conflicts: plan.conflicts.map((conflict) => ({
          clientId: conflict.clientId,
          trigger: commentTriggerFromRow(
            rowById.get(conflict.id) as CommentAutomationRow,
          ),
        })),
      },
    );
  }

  const validation = await buildValidation({
    workspaceId: context.workspaceId,
    flowId: existing.id,
    instagramAccountId: existing.instagramAccountId,
    graph: graphInput,
    triggers: triggersInput,
    commentTriggers,
  });

  const nextStatus = parsed.data.status ?? existing.status;
  if (nextStatus === "ACTIVE" && validation.errors.length > 0) {
    const count = validation.errors.length;
    return jsonError(
      400,
      `Fix ${count} ${count === 1 ? "problem" : "problems"} before this flow can go live.`,
      { errors: validation.errors.map((issue) => issue.message), validation },
    );
  }

  const isActive = automationActiveFor(nextStatus);
  const idMap: Record<string, string> = {};
  try {
    await prisma.$transaction(async (tx) => {
      // One save per flow at a time: lock the flow row, then make sure its
      // comment rows are still the ones this save was planned against, so two
      // concurrent saves can't both create the same trigger.
      await tx.$queryRaw`SELECT 1 FROM "Flow" WHERE "id" = ${existing.id} FOR UPDATE`;
      const current = await tx.automation.findMany({
        where: { flowId: existing.id },
        select: { id: true },
      });
      const planned = new Set(existingRows.map((row) => row.id));
      if (
        current.length !== planned.size ||
        current.some((row) => !planned.has(row.id))
      ) {
        throw new FlowSaveConflict();
      }
      await tx.flow.update({ where: { id: existing.id }, data });

      if (plan) {
        for (const match of plan.matches) idMap[match.clientId] = match.id;
        if (plan.deletes.length > 0) {
          await tx.automation.deleteMany({
            where: { id: { in: plan.deletes }, flowId: existing.id },
          });
        }
        for (const update of plan.updates) {
          await tx.automation.update({
            where: { id: update.id },
            data: update.data,
          });
        }
        for (const create of plan.creates) {
          const row = await tx.automation.create({
            data: {
              ...create.data,
              name: create.name,
              // Flow-backed rows never send the simple DM; the flow brings its own.
              dmMessage: "",
              flowId: existing.id,
              isActive,
              workspaceId: context.workspaceId,
              instagramAccountId: existing.instagramAccountId,
            },
            select: { id: true },
          });
          idMap[create.clientId] = row.id;
        }
      } else if (nextName !== existing.name) {
        // Renamed without touching the triggers: rename the rows anyway.
        for (const [index, row] of existingRows.entries()) {
          const name = commentTriggerName(nextName, index, existingRows.length);
          if (row.name !== name)
            await tx.automation.update({
              where: { id: row.id },
              data: { name },
            });
        }
      }

      // Only rows that disagree, so untouched rows keep their updatedAt.
      await tx.automation.updateMany({
        where: { flowId: existing.id, isActive: !isActive },
        data: { isActive },
      });
    });
  } catch (error) {
    if (error instanceof FlowSaveConflict) {
      return jsonError(
        409,
        "This flow was just saved somewhere else. Reload to get the latest version.",
      );
    }
    throw error;
  }

  const flow = (await prisma.flow.findFirst({
    where: { id: existing.id },
    include: FLOW_INCLUDE,
  })) as FlowWithRows;

  return NextResponse.json({
    success: true,
    data: { ...serializeFlow(flow, await countOpenRuns(flow.id)), idMap },
    validation,
  });
}

/**
 * DELETE /api/flows/:id : deletes the flow and its comment triggers (their
 * Automation rows and send history) together, so no campaign is ever left
 * without its flow. Refused (409) while other flows start this one.
 */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const context = await requireWorkspace({
    manage: true,
    action: "delete flows",
  });
  if (context instanceof NextResponse) return context;
  const { id } = await params;

  const flow = await prisma.flow.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true, name: true },
  });
  if (!flow) return jsonError(404, "Flow not found");

  // Other flows that start this one would break silently, so refuse.
  const siblings = await prisma.flow.findMany({
    where: { workspaceId: context.workspaceId, id: { not: flow.id } },
    select: { id: true, name: true, graph: true },
  });
  const starters = siblings
    .filter((sibling) => {
      const graph = parseFlowGraphShape(sibling.graph);
      return (
        graph.ok &&
        referencedFlowIds(graph.value).some((ref) => ref.flowId === flow.id)
      );
    })
    .map((sibling) => ({ id: sibling.id, name: sibling.name }));
  if (starters.length > 0) {
    const names = starters.map((s) => `"${s.name}"`).join(", ");
    return jsonError(
      409,
      `The ${starters.length === 1 ? "flow" : "flows"} ${names} ${starters.length === 1 ? "starts" : "start"} this flow. Remove those steps or buttons first.`,
      { flows: starters },
    );
  }

  // Automation.flowId is onDelete: SetNull; a comment row left without its
  // flow would fall back to the classic DM pipeline. Delete them together.
  const [deletedTriggers] = await prisma.$transaction([
    prisma.automation.deleteMany({
      where: { flowId: flow.id, workspaceId: context.workspaceId },
    }),
    prisma.flow.delete({ where: { id: flow.id } }),
  ]);
  return NextResponse.json({
    success: true,
    data: { deleted: true, commentTriggers: deletedTriggers.count },
  });
}
