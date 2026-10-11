import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  applyContactPatch,
  contactPatchSchema,
  firstIssueMessage,
} from "@/lib/inbox/contact";
import { isPlausibleId, loadInboxContact } from "@/lib/inbox/server";
import type { InboxContactResponse } from "@/lib/inbox/types";

/** Optimistic-concurrency retries when a flow writes the contact mid-edit. */
const MAX_ATTEMPTS = 3;

type RouteProps = { params: Promise<{ conversationId: string }> };

function json(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

// The contact profile for one mirrored conversation.
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return json(401, "Unauthorized");
  const { conversationId } = await params;
  if (!isPlausibleId(conversationId)) return json(400, "Invalid conversation");

  const contact = await loadInboxContact(conversationId, context.workspaceId);
  if (!contact) return json(404, "Conversation not found");
  const data: InboxContactResponse = { contact };
  return NextResponse.json({ success: true, data });
}

/**
 * Edit the contact: email, phone, tags (add/remove) and custom fields
 * (set/unset). Flows write the same row, so the update only lands if the
 * row is unchanged since it was read, and retries on a race.
 */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
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
  const parsed = contactPatchSchema.safeParse(body);
  if (!parsed.success) return json(400, firstIssueMessage(parsed.error));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await prisma.dmConversation.findFirst({
      where: { id: conversationId, instagramAccount: { workspaceId: context.workspaceId } },
      select: { id: true, email: true, phone: true, tags: true, customFields: true, updatedAt: true },
    });
    if (!current) return json(404, "Conversation not found");

    const result = applyContactPatch(current, parsed.data, new Date());
    if (!result.ok) return json(400, result.error);
    if (Object.keys(result.data).length === 0) break;

    const { count } = await prisma.dmConversation.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt },
      data: result.data,
    });
    if (count === 1) break;
    if (attempt === MAX_ATTEMPTS) {
      return json(409, "This contact changed while saving. Try again.");
    }
  }

  const contact = await loadInboxContact(conversationId, context.workspaceId);
  if (!contact) return json(404, "Conversation not found");
  const data: InboxContactResponse = { contact };
  return NextResponse.json({ success: true, data });
}
