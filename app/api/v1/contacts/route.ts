import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiRequest } from "@/lib/integrations/api-keys";
import { contactPatchSchema, firstIssueMessage } from "@/lib/inbox/contact";
import { updateContact } from "@/lib/inbox/contact-update";
import {
  apiError,
  contactRefSchema,
  contactSnapshot,
  findContactConversation,
  hasContactRef,
  resolveApiAccount,
} from "@/lib/integrations/v1";

/** Find one contact: ?contactId= | ?username= | ?email= (+ instagramAccountId with several accounts). */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const parsed = contactRefSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError(400, firstIssueMessage(parsed.error));
  if (!hasContactRef(parsed.data)) return apiError(400, "Pass contactId, username or email");

  const account = await resolveApiAccount(auth.caller.workspaceId, parsed.data.instagramAccountId);
  if (!account.ok) return account.response;
  const conversationId = await findContactConversation(account.account.id, parsed.data);
  const contact = conversationId ? await contactSnapshot(conversationId) : null;
  if (!contact) return apiError(404, "Contact not found");
  return NextResponse.json({ success: true, data: { contact } });
}

const updateBodySchema = z.object({
  contact: contactRefSchema,
  // Same rules as an edit in the inbox: email, phone, add/remove tags, set/unset fields.
  update: contactPatchSchema,
});

/** Update a contact (set fields, tags, email, phone) from Zapier, Make or n8n. */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Send a JSON body");
  }
  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) return apiError(400, firstIssueMessage(parsed.error));
  if (!hasContactRef(parsed.data.contact)) return apiError(400, "contact: pass contactId, username or email");

  const account = await resolveApiAccount(auth.caller.workspaceId, parsed.data.contact.instagramAccountId);
  if (!account.ok) return account.response;
  const conversationId = await findContactConversation(account.account.id, parsed.data.contact);
  if (!conversationId) return apiError(404, "Contact not found (they appear once they message the account)");

  const result = await updateContact(conversationId, auth.caller.workspaceId, parsed.data.update);
  if (!result.ok) return apiError(result.status, result.error);
  const contact = await contactSnapshot(conversationId);
  return NextResponse.json({ success: true, data: { contact, changed: result.changed } });
}
