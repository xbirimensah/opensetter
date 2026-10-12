/**
 * Helpers shared by the /api/flows routes (not a route itself).
 */

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  COMMENT_AUTOMATION_SELECT,
  commentOverlapWarnings,
  commentTriggerFromRow,
  validateCommentTriggers,
  type CommentAutomationRow,
} from "@/lib/flows/comment-triggers";
import type { CommentTrigger, EditorTrigger, FlowGraph, FlowTrigger } from "@/lib/flows/types";
import {
  lintFlow,
  nodeDisplayName,
  parseFlowGraphShape,
  parseFlowTriggersShape,
  referencedFlowIds,
  referencedMedia,
  TRIGGER_TYPE_LABELS,
  triggerDisplayName,
  validateFlowGraph,
  validateFlowTriggers,
  type FlowIssue,
  type MediaAssetKind,
} from "@/lib/flows/validate";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspace-access";

/** Flow graphs are small; anything bigger than this is not an editor save. */
export const MAX_FLOW_BODY_BYTES = 1024 * 1024;

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/** Workspace context, optionally requiring owner/admin. */
export async function requireWorkspace(
  options: { manage?: boolean; action?: string } = {}
): Promise<WorkspaceContext | NextResponse> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return jsonError(401, "Unauthorized");
  if (options.manage && !canManageWorkspace(context.role)) {
    return jsonError(403, `Only owners and admins can ${options.action ?? "change flows"}`);
  }
  return context;
}

/** Parse a JSON body with a size cap; the failure carries a ready 400/413 response. */
export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const raw = await request.text();
  if (raw.length > MAX_FLOW_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "This flow is too large to save") };
  }
  try {
    return { ok: true, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON body") };
  }
}

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** New flows start with one message holding one text block. */
export function defaultFlowGraph(): FlowGraph {
  const nodeId = randomId("n");
  return {
    startNodeId: nodeId,
    nodes: [
      {
        id: nodeId,
        type: "message",
        name: "First message",
        contents: [{ id: randomId("c"), type: "text", text: "Hey {{first_name}}, thanks for reaching out!" }],
      },
    ],
  };
}

const KIND_ARTICLE: Record<MediaAssetKind, string> = {
  IMAGE: "an image",
  VIDEO: "a video",
  AUDIO: "an audio",
  FILE: "a PDF",
};

/**
 * Checks that need the database: started flows exist on the same account,
 * uploaded media exists and fits the block, and no other ACTIVE flow on
 * the account already owns this flow's ref links or one-per-account
 * triggers (welcome, default reply, story mention, new follower).
 */
export async function crossCheckFlow(params: {
  workspaceId: string;
  flowId: string | null;
  instagramAccountId: string;
  graph: FlowGraph;
  triggers: FlowTrigger[];
}): Promise<{ errors: FlowIssue[]; warnings: FlowIssue[] }> {
  const { workspaceId, flowId, instagramAccountId, graph, triggers } = params;
  const issues: FlowIssue[] = [];
  const warnings: FlowIssue[] = [];
  const indexOf = new Map(graph.nodes.map((node, i) => [node.id, i] as const));
  const stepLabel = (nodeId: string) => {
    const index = indexOf.get(nodeId);
    return index === undefined ? "A step" : nodeDisplayName(graph.nodes[index], index);
  };

  const flowRefs = referencedFlowIds(graph).filter((ref) => ref.flowId !== flowId);
  const mediaRefs = referencedMedia(graph);

  const [flows, assets, others] = await Promise.all([
    flowRefs.length
      ? prisma.flow.findMany({
          where: { id: { in: [...new Set(flowRefs.map((r) => r.flowId))] }, workspaceId },
          select: { id: true, name: true, status: true, instagramAccountId: true },
        })
      : Promise.resolve([]),
    mediaRefs.length
      ? prisma.mediaAsset.findMany({
          where: { id: { in: [...new Set(mediaRefs.map((r) => r.mediaId))] }, workspaceId },
          select: { id: true, kind: true },
        })
      : Promise.resolve([]),
    triggers.length
      ? prisma.flow.findMany({
          where: {
            workspaceId,
            instagramAccountId,
            status: "ACTIVE",
            ...(flowId ? { id: { not: flowId } } : {}),
          },
          select: { id: true, name: true, triggers: true },
        })
      : Promise.resolve([]),
  ]);

  const flowById = new Map(flows.map((f) => [f.id, f] as const));
  for (const ref of flowRefs) {
    const target = flowById.get(ref.flowId);
    if (!target) {
      issues.push({ nodeId: ref.nodeId, message: `${stepLabel(ref.nodeId)}: starts a flow that no longer exists.` });
    } else if (target.instagramAccountId !== instagramAccountId) {
      issues.push({ nodeId: ref.nodeId, message: `${stepLabel(ref.nodeId)}: starts a flow from another Instagram account.` });
    } else if (target.status !== "ACTIVE") {
      // The engine only starts active flows, so this path stops here until then.
      warnings.push({
        nodeId: ref.nodeId,
        message: `${stepLabel(ref.nodeId)}: starts "${target.name}", which is not active yet. Activate it or the run stops here.`,
      });
    }
  }

  const assetById = new Map(assets.map((a) => [a.id, a] as const));
  for (const ref of mediaRefs) {
    const asset = assetById.get(ref.mediaId);
    if (!asset) {
      issues.push({ nodeId: ref.nodeId, message: `${stepLabel(ref.nodeId)}: ${ref.where} uses a file that was deleted. Pick another one.` });
    } else if (asset.kind !== ref.kind) {
      issues.push({ nodeId: ref.nodeId, message: `${stepLabel(ref.nodeId)}: ${ref.where} needs ${KIND_ARTICLE[ref.kind]} file.` });
    }
  }

  const conflicts = new Set<string>();
  for (const other of others) {
    const parsed = parseFlowTriggersShape(other.triggers);
    if (!parsed.ok) continue;
    triggers.forEach((trigger, index) => {
      const clash = parsed.value.some((theirs) => {
        if (trigger.type === "ref_link" && theirs.type === "ref_link") {
          return theirs.ref.toLowerCase() === trigger.ref.toLowerCase();
        }
        return (
          theirs.type === trigger.type &&
          ["welcome", "default_reply", "story_mention", "new_follower"].includes(trigger.type)
        );
      });
      if (!clash) return;
      const key = `${trigger.id}:${other.id}`;
      if (conflicts.has(key)) return;
      conflicts.add(key);
      const what =
        trigger.type === "ref_link"
          ? `the ref "${trigger.ref}"`
          : `the ${TRIGGER_TYPE_LABELS[trigger.type].toLowerCase()} trigger`;
      issues.push({
        nodeId: null,
        triggerId: trigger.id,
        message: `${triggerDisplayName(trigger, index)}: the active flow "${other.name}" already uses ${what}. Pause it or change this trigger.`,
      });
    });
  }

  return { errors: issues, warnings: dedupeIssues(warnings) };
}

function dedupeIssues(list: FlowIssue[]): FlowIssue[] {
  const seen = new Set<string>();
  return list.filter((issue) => {
    const key = `${issue.nodeId}|${issue.triggerId}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface FlowValidation {
  /** Everything that blocks activation (rules plus database checks). */
  errors: FlowIssue[];
  /** Lint warnings plus database warnings; never block. */
  warnings: FlowIssue[];
  /** The subset of `errors` only the server can know (database checks). */
  serverErrors: FlowIssue[];
  /** The subset of `warnings` only the server can know. */
  serverWarnings: FlowIssue[];
}

/**
 * Validate a stored or submitted flow. Shape problems become errors on the
 * flow itself so a malformed row still loads instead of crashing.
 * `commentTriggers` are the flow's comment triggers (Automation rows or
 * the submitted list); they add their own rules and overlap warnings.
 */
export async function buildValidation(params: {
  workspaceId: string;
  flowId: string | null;
  instagramAccountId: string;
  graph: unknown;
  triggers: unknown;
  commentTriggers: CommentTrigger[];
}): Promise<FlowValidation> {
  const graph = parseFlowGraphShape(params.graph);
  const triggers = parseFlowTriggersShape(params.triggers);
  const shapeErrors: FlowIssue[] = [
    ...(graph.ok ? [] : graph.errors.map((message) => ({ nodeId: null, message }))),
    ...(triggers.ok ? [] : triggers.errors.map((message) => ({ nodeId: null, message }))),
  ];
  if (!graph.ok || !triggers.ok) {
    return { errors: shapeErrors, warnings: [], serverErrors: shapeErrors, serverWarnings: [] };
  }

  const [server, liveComments] = await Promise.all([
    crossCheckFlow({
      workspaceId: params.workspaceId,
      flowId: params.flowId,
      instagramAccountId: params.instagramAccountId,
      graph: graph.value,
      triggers: triggers.value,
    }),
    params.commentTriggers.length > 0
      ? prisma.automation.findMany({
          where: {
            workspaceId: params.workspaceId,
            instagramAccountId: params.instagramAccountId,
            isActive: true,
            ...(params.flowId ? { OR: [{ flowId: null }, { flowId: { not: params.flowId } }] } : {}),
          },
          select: {
            id: true,
            name: true,
            postId: true,
            matchAnyPost: true,
            keywords: true,
            matchAnyWord: true,
            flow: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const overlap = commentOverlapWarnings(params.commentTriggers, liveComments);
  const commentTriggered = params.commentTriggers.length > 0;

  return {
    errors: [
      ...validateFlowGraph(graph.value),
      ...validateCommentTriggers(params.commentTriggers),
      ...validateFlowTriggers(triggers.value),
      ...server.errors,
    ],
    warnings: [...lintFlow(graph.value, { commentTriggered }), ...server.warnings, ...overlap],
    serverErrors: server.errors,
    serverWarnings: [...server.warnings, ...overlap],
  };
}

/** Linked Automation rows (comment triggers), with everything the editor needs. */
export const FLOW_AUTOMATION_SELECT = COMMENT_AUTOMATION_SELECT;

/**
 * The flow's trigger list as the editor sees it: comment triggers (from
 * the Automation rows) first, then Flow.triggers. A malformed
 * Flow.triggers is passed through untouched so the editor can show it.
 */
export function mergedTriggers(storedTriggers: unknown, rows: CommentAutomationRow[]): unknown {
  const comments: EditorTrigger[] = rows.map(commentTriggerFromRow);
  if (!Array.isArray(storedTriggers)) return comments.length > 0 ? comments : storedTriggers;
  return [...comments, ...(storedTriggers as FlowTrigger[])];
}

/** Automation refs for stats links (the per-campaign stats view). */
export function automationRefs(rows: CommentAutomationRow[]) {
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive }));
}

/** Runs that are still in progress (executing or parked). */
export const OPEN_RUN_STATUSES = ["RUNNING", "WAITING"] as const;
