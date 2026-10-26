import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { contactPatchSchema, firstIssueMessage } from "@/lib/inbox/contact";
import { updateContact } from "@/lib/inbox/contact-update";
import { isPlausibleId, loadInboxContact } from "@/lib/inbox/server";
import type { InboxContactResponse } from "@/lib/inbox/types";

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

  const updated = await updateContact(conversationId, context.workspaceId, parsed.data);
  if (!updated.ok) return json(updated.status, updated.error);

  const contact = await loadInboxContact(conversationId, context.workspaceId);
  if (!contact) return json(404, "Conversation not found");
  const data: InboxContactResponse = { contact };
  return NextResponse.json({ success: true, data });
}
