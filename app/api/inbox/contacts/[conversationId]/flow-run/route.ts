import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { ACTIVE_RUN_STATUSES, isPlausibleId, loadInboxContact } from "@/lib/inbox/server";
import type { InboxStopFlowResponse } from "@/lib/inbox/types";

const bodySchema = z.strictObject({ action: z.literal("stop") });

type RouteProps = { params: Promise<{ conversationId: string }> };

function json(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Stop the contact's active flow: every RUNNING or WAITING run of the
 * conversation becomes CANCELLED. Queued engine jobs check the run's
 * status before acting, so this DB update is the whole stop.
 */
export async function POST(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return json(401, "Unauthorized");
  const { conversationId } = await params;
  if (!isPlausibleId(conversationId)) return json(400, "Invalid conversation");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, "Invalid request body");
  }
  if (!bodySchema.safeParse(body).success) return json(400, "Invalid request body");

  const conversation = await prisma.dmConversation.findFirst({
    where: { id: conversationId, instagramAccount: { workspaceId: context.workspaceId } },
    select: { id: true },
  });
  if (!conversation) return json(404, "Conversation not found");

  const { count } = await prisma.flowRun.updateMany({
    where: { conversationId: conversation.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  const contact = await loadInboxContact(conversation.id, context.workspaceId);
  if (!contact) return json(404, "Conversation not found");
  const data: InboxStopFlowResponse = { stopped: count, contact };
  return NextResponse.json({ success: true, data });
}
