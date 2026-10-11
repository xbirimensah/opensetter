import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import { getConversationMessages, MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { normalizeGraphMessage } from "@/lib/meta/attachments";
import {
  isPlausibleId,
  loadInboxContact,
  MESSAGE_SELECT,
  toInboxMessage,
} from "@/lib/inbox/server";
import type { InboxMessage, InboxThreadResponse } from "@/lib/inbox/types";

/** Messages per page; older pages load with ?before=<sentAt>&beforeId=<id>. */
const PAGE_SIZE = 100;

type RouteProps = { params: Promise<{ conversationId: string }> };

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

/**
 * One thread for the inbox: messages (oldest first) with kind, attachments,
 * replies, reactions, edits and deletes, plus the contact profile and its
 * active flow run. `?live=1` reads a Meta thread id instead (used only
 * while the account's mirror is still empty).
 */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const search = request.nextUrl.searchParams;
  const access = await resolveSetterAccount(search.get("instagramAccountId"));
  if (!access.ok) return access.response;
  const { account, context } = access;

  const { conversationId } = await params;
  if (!isPlausibleId(conversationId)) return badRequest("Invalid conversation");

  if (search.get("live") === "1") {
    return liveThread(account, conversationId);
  }

  const conversation = await prisma.dmConversation.findFirst({
    where: { id: conversationId, instagramAccountId: account.id },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json(
      { success: false, error: "Conversation not found" },
      { status: 404 }
    );
  }

  const beforeRaw = search.get("before");
  const beforeId = search.get("beforeId");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime())) return badRequest("Invalid cursor");
  if (beforeId && !isPlausibleId(beforeId)) return badRequest("Invalid cursor");

  try {
    const cursor = before
      ? {
          OR: [
            { sentAt: { lt: before } },
            ...(beforeId ? [{ sentAt: before, id: { lt: beforeId } }] : []),
          ],
        }
      : {};

    const [rows, contact] = await Promise.all([
      prisma.dmMessage.findMany({
        where: { conversationId: conversation.id, ...cursor },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        select: MESSAGE_SELECT,
      }),
      loadInboxContact(conversation.id, context.workspaceId),
    ]);

    const hasMore = rows.length > PAGE_SIZE;
    const messages = rows.slice(0, PAGE_SIZE).reverse().map(toInboxMessage);

    const data: InboxThreadResponse = { mode: "mirror", contact, messages, hasMore };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Inbox] Thread error:", err);
    return NextResponse.json({ success: false, error: "Failed to load messages" }, { status: 500 });
  }
}

/** Legacy path: Meta's 20 most recent messages, as text summaries. */
async function liveThread(
  account: { instagramId: string; accessToken: string },
  threadId: string
) {
  try {
    const raw = await getConversationMessages(decryptToken(account.accessToken), threadId);
    const messages: InboxMessage[] = raw
      .map((m) => {
        const normalized = normalizeGraphMessage(m);
        const fromMe = m.from?.id === account.instagramId;
        const message: InboxMessage = {
          id: m.id,
          mid: m.id,
          fromMe,
          source: fromMe ? "HUMAN" : "PARTICIPANT",
          kind: "text",
          text: normalized.text,
          attachments: [],
          replyToMid: null,
          reaction: null,
          editedAt: null,
          deletedAt: null,
          sentAt: m.created_time ?? new Date(0).toISOString(),
        };
        return message;
      })
      .reverse();
    const data: InboxThreadResponse = { mode: "live", contact: null, messages, hasMore: false };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Inbox] Live thread error:", err);
    const message = err instanceof MetaApiError ? err.message : "Failed to load messages";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
