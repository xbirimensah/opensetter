/**
 * Apply a contact patch (inbox edits, the integration API) with
 * optimistic concurrency, then announce what changed to webhooks.
 */

import { prisma } from "@/lib/db/client";
import { applyContactPatch, type ContactPatch } from "@/lib/inbox/contact";
import { emitContactChanges } from "@/lib/integrations/webhooks";

/** Retries when a flow writes the contact between our read and write. */
const MAX_ATTEMPTS = 3;

export type ContactUpdateResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function updateContact(
  conversationId: string,
  workspaceId: string,
  patch: ContactPatch
): Promise<ContactUpdateResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await prisma.dmConversation.findFirst({
      where: { id: conversationId, instagramAccount: { workspaceId } },
      select: { id: true, email: true, phone: true, tags: true, customFields: true, updatedAt: true },
    });
    if (!current) return { ok: false, status: 404, error: "Conversation not found" };

    const result = applyContactPatch(current, patch, new Date());
    if (!result.ok) return { ok: false, status: 400, error: result.error };
    if (Object.keys(result.data).length === 0) return { ok: true, changed: false };

    const { count } = await prisma.dmConversation.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt },
      data: result.data,
    });
    if (count === 1) {
      await emitContactChanges(current.id, current, result.data);
      return { ok: true, changed: true };
    }
  }
  return { ok: false, status: 409, error: "This contact changed while saving. Try again." };
}
