/**
 * Server-side reads for the inbox API: mirrored messages and the contact
 * profile with its active flow run. Imports Prisma, so never import this
 * from a client component.
 */

import { prisma } from "@/lib/db/client";
import type { DmMessageKind } from "@/lib/meta/attachments";
import { parseStoredAttachments, toInboxAttachment } from "@/lib/inbox/attachments";
import { parseCustomFields } from "@/lib/inbox/contact";
import type { InboxContact, InboxFlowRun, InboxMessage, InboxMessageSource } from "@/lib/inbox/types";

export const ACTIVE_RUN_STATUSES = ["RUNNING", "WAITING"] as const;

const KNOWN_KINDS = new Set<DmMessageKind>([
  "text",
  "image",
  "video",
  "audio",
  "file",
  "card",
  "share",
  "reel",
  "post",
  "story_reply",
  "story_mention",
  "postback",
  "quick_reply",
  "sticker",
  "ephemeral",
  "unsupported",
  "deleted",
]);

/** A stored kind the UI knows how to draw; unknown values degrade safely. */
export function coerceKind(kind: string | null | undefined, hasAttachments: boolean): DmMessageKind {
  if (kind && KNOWN_KINDS.has(kind as DmMessageKind)) return kind as DmMessageKind;
  return hasAttachments ? "unsupported" : "text";
}

export const MESSAGE_SELECT = {
  id: true,
  mid: true,
  direction: true,
  source: true,
  text: true,
  kind: true,
  attachments: true,
  replyToMid: true,
  reaction: true,
  editedAt: true,
  deletedAt: true,
  sentAt: true,
} as const;

interface MessageRow {
  id: string;
  mid: string;
  direction: "IN" | "OUT";
  source: InboxMessageSource;
  text: string;
  kind: string | null;
  attachments: unknown;
  replyToMid: string | null;
  reaction: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  sentAt: Date;
}

export function toInboxMessage(row: MessageRow): InboxMessage {
  const attachments = parseStoredAttachments(row.attachments).map(toInboxAttachment);
  return {
    id: row.id,
    mid: row.mid,
    fromMe: row.direction === "OUT",
    source: row.source,
    kind: coerceKind(row.kind, attachments.length > 0),
    text: row.text,
    attachments,
    replyToMid: row.replyToMid,
    reaction: row.reaction,
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    sentAt: row.sentAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** The node with `nodeId` in a stored FlowGraph, read defensively. */
function findNode(graph: unknown, nodeId: string | null): Record<string, unknown> | null {
  if (!nodeId) return null;
  const nodes = asRecord(graph)?.nodes;
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    const record = asRecord(node);
    if (record?.id === nodeId) return record;
  }
  return null;
}

interface FlowRunRow {
  id: string;
  status: string;
  currentNodeId: string | null;
  waiting: unknown;
  startedAt: Date;
  flow: { id: string; name: string; graph: unknown };
}

export function toInboxFlowRun(run: FlowRunRow): InboxFlowRun | null {
  if (run.status !== "RUNNING" && run.status !== "WAITING") return null;
  const waiting = asRecord(run.waiting);
  const waitingNodeId = asString(waiting?.nodeId) ?? run.currentNodeId;
  const node = findNode(run.flow.graph, run.currentNodeId ?? waitingNodeId);
  const waitingNode = waitingNodeId === run.currentNodeId ? node : findNode(run.flow.graph, waitingNodeId);
  const kind = asString(waiting?.kind);
  return {
    id: run.id,
    status: run.status,
    currentNodeId: run.currentNodeId,
    currentNodeName: asString(node?.name),
    flow: { id: run.flow.id, name: run.flow.name },
    waiting: kind
      ? {
          kind,
          until: asString(waiting?.expiresAt) ?? asString(waiting?.resumeAt),
          inputType: kind === "input" ? asString(waitingNode?.inputType) : null,
        }
      : null,
    startedAt: run.startedAt.toISOString(),
  };
}

/**
 * The contact profile for a mirrored conversation, or null when the
 * conversation does not exist or belongs to another workspace.
 */
export async function loadInboxContact(
  conversationId: string,
  workspaceId: string
): Promise<InboxContact | null> {
  const conversation = await prisma.dmConversation.findFirst({
    where: { id: conversationId, instagramAccount: { workspaceId } },
    select: {
      id: true,
      participantId: true,
      participantUsername: true,
      email: true,
      emailCapturedAt: true,
      phone: true,
      phoneCapturedAt: true,
      tags: true,
      customFields: true,
      flowRuns: {
        where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          currentNodeId: true,
          waiting: true,
          startedAt: true,
          flow: { select: { id: true, name: true, graph: true } },
        },
      },
    },
  });
  if (!conversation) return null;

  const run = conversation.flowRuns[0];
  return {
    conversationId: conversation.id,
    participantId: conversation.participantId,
    username: conversation.participantUsername,
    email: conversation.email,
    emailCapturedAt: conversation.emailCapturedAt?.toISOString() ?? null,
    phone: conversation.phone,
    phoneCapturedAt: conversation.phoneCapturedAt?.toISOString() ?? null,
    tags: conversation.tags,
    customFields: parseCustomFields(conversation.customFields),
    flowRun: run ? toInboxFlowRun(run) : null,
  };
}

/**
 * Route param ids are cuids or Meta ids (base64-ish); refuse anything else
 * early. No slashes, dots or query characters, so a live-mode thread id
 * can never change the Graph API path it is placed into.
 */
export function isPlausibleId(value: string): boolean {
  return /^[A-Za-z0-9_=:-]{1,256}$/.test(value);
}
