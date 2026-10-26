/**
 * Helpers for the inbound integration API (/api/v1): which Instagram
 * account and which contact a call is about, inside the key's workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { ContactSnapshot } from "./events";
import { loadContactSnapshot, withoutWorkspace } from "./webhooks";

export function apiError(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/** How a call names a contact: the Instagram-scoped id, the handle or the email. */
export const contactRefSchema = z.object({
  instagramAccountId: z.string().max(64).optional(),
  contactId: z.string().regex(/^\d{1,40}$/, "contactId is the contact's Instagram-scoped id").optional(),
  username: z
    .string()
    .trim()
    .max(64)
    .transform((value) => value.replace(/^@+/, ""))
    .optional(),
  email: z.string().trim().max(254).optional(),
});

export type ContactRef = z.infer<typeof contactRefSchema>;

export interface ApiAccount {
  id: string;
  instagramId: string;
  workspaceId: string;
  accessToken: string;
  username: string;
}

/** The named account, or the workspace's only one. */
export async function resolveApiAccount(
  workspaceId: string,
  instagramAccountId: string | undefined
): Promise<{ ok: true; account: ApiAccount } | { ok: false; response: NextResponse }> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId, ...(instagramAccountId ? { id: instagramAccountId } : {}) },
    select: { id: true, instagramId: true, workspaceId: true, accessToken: true, username: true },
    take: 2,
  });
  if (accounts.length === 0) {
    return { ok: false, response: apiError(404, instagramAccountId ? "Instagram account not found" : "No Instagram account connected") };
  }
  if (accounts.length > 1) {
    return { ok: false, response: apiError(400, "This workspace has several Instagram accounts: pass instagramAccountId") };
  }
  return { ok: true, account: accounts[0] };
}

/** The contact's conversation in this account. Contacts exist once they messaged the account. */
export async function findContactConversation(accountId: string, ref: ContactRef): Promise<string | null> {
  const where = ref.contactId
    ? { participantId: ref.contactId }
    : ref.username
      ? { participantUsername: { equals: ref.username, mode: "insensitive" as const } }
      : ref.email
        ? { email: { equals: ref.email, mode: "insensitive" as const } }
        : null;
  if (!where) return null;
  const row = await prisma.dmConversation.findFirst({
    where: { instagramAccountId: accountId, ...where },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

export function hasContactRef(ref: ContactRef): boolean {
  return Boolean(ref.contactId || ref.username || ref.email);
}

export async function contactSnapshot(conversationId: string): Promise<ContactSnapshot | null> {
  const snapshot = await loadContactSnapshot(conversationId);
  return snapshot ? withoutWorkspace(snapshot) : null;
}
