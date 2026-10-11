import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import { getConversations, MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { ACTIVE_RUN_STATUSES, coerceKind } from "@/lib/inbox/server";
import type {
  InboxConversationItem,
  InboxConversationsResponse,
  InboxMessageSource,
} from "@/lib/inbox/types";

/** Newest threads shown in the inbox list. */
const LIST_LIMIT = 200;

/**
 * Conversations for the inbox, newest activity first, read from the local
 * mirror (rich messages, contact profile, flows). Until the mirror holds
 * anything for the account, falls back to Meta's Conversations API so a
 * freshly connected account still sees its inbox.
 */
export async function GET(request: NextRequest) {
  const access = await resolveSetterAccount(request.nextUrl.searchParams.get("instagramAccountId"));
  if (!access.ok) return access.response;
  const { account } = access;

  try {
    const latest = await prisma.dmMessage.groupBy({
      by: ["conversationId"],
      where: { conversation: { instagramAccountId: account.id } },
      _max: { sentAt: true },
      orderBy: { _max: { sentAt: "desc" } },
      take: LIST_LIMIT,
    });

    if (latest.length === 0) {
      return await liveFallback(account);
    }

    const ids = latest.map((row) => row.conversationId);
    const [conversations, lastMessages] = await Promise.all([
      prisma.dmConversation.findMany({
        where: { id: { in: ids }, instagramAccountId: account.id },
        select: {
          id: true,
          participantId: true,
          participantUsername: true,
          flowRuns: {
            where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
            take: 1,
            select: { id: true },
          },
        },
      }),
      // One row per thread: the message at that thread's max(sentAt).
      prisma.dmMessage.findMany({
        where: {
          OR: latest
            .filter((row) => row._max.sentAt)
            .map((row) => ({ conversationId: row.conversationId, sentAt: row._max.sentAt as Date })),
        },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
        select: {
          conversationId: true,
          direction: true,
          source: true,
          text: true,
          kind: true,
          attachments: true,
          deletedAt: true,
          sentAt: true,
        },
      }),
    ]);

    // Ties on sentAt resolve to the last row by id (ordered ascending above).
    const lastByConversation = new Map(lastMessages.map((m) => [m.conversationId, m]));
    const byId = new Map(conversations.map((c) => [c.id, c]));

    const items: InboxConversationItem[] = ids.flatMap((id) => {
      const conversation = byId.get(id);
      if (!conversation) return [];
      const last = lastByConversation.get(id);
      const hasAttachments = Array.isArray(last?.attachments) && last.attachments.length > 0;
      return [
        {
          id: conversation.id,
          contact: {
            id: conversation.participantId,
            username: conversation.participantUsername,
          },
          updatedTime: last?.sentAt.toISOString() ?? null,
          lastMessage: last
            ? {
                text: last.text,
                kind: coerceKind(last.kind, hasAttachments),
                fromMe: last.direction === "OUT",
                source: last.source as InboxMessageSource,
                sentAt: last.sentAt.toISOString(),
                deleted: Boolean(last.deletedAt) || last.kind === "deleted",
              }
            : null,
          hasActiveFlow: conversation.flowRuns.length > 0,
        },
      ];
    });

    const data: InboxConversationsResponse = { mode: "mirror", conversations: items };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Inbox] Conversations error:", err);
    const message = err instanceof MetaApiError ? err.message : "Failed to load conversations";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Legacy path: list threads straight from Meta (text previews only). */
async function liveFallback(account: { instagramId: string; accessToken: string }) {
  const raw = await getConversations(decryptToken(account.accessToken), account.instagramId);
  const conversations: InboxConversationItem[] = raw.map((c) => {
    const participants = c.participants?.data ?? [];
    const contact =
      participants.find((p) => p.id !== account.instagramId) ?? participants[0] ?? null;
    const last = c.messages?.data?.[0] ?? null;
    const fromMe = last?.from?.id === account.instagramId;
    return {
      id: c.id,
      contact: { id: contact?.id ?? "", username: contact?.username ?? null },
      updatedTime: c.updated_time ?? null,
      lastMessage: last
        ? {
            text: last.message?.trim() || "[Media]",
            kind: "text",
            fromMe,
            source: fromMe ? "HUMAN" : "PARTICIPANT",
            sentAt: last.created_time ?? c.updated_time ?? new Date(0).toISOString(),
            deleted: false,
          }
        : null,
      hasActiveFlow: false,
    };
  });
  const data: InboxConversationsResponse = { mode: "live", conversations };
  return NextResponse.json({ success: true, data });
}
