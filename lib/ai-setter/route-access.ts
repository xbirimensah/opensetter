/**
 * Shared auth + account scoping for AI setter API routes: the caller
 * must be signed in and the Instagram account must belong to their
 * workspace.
 */

import { NextResponse } from "next/server";
import type { InstagramAccount } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceContext, type WorkspaceContext } from "@/lib/workspace-access";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";

export type SetterAccountAccess =
  | { ok: true; context: WorkspaceContext; account: InstagramAccount }
  | { ok: false; response: NextResponse };

export async function resolveSetterAccount(
  instagramAccountId: string | null | undefined
): Promise<SetterAccountAccess> {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  const account = await getWorkspaceInstagramAccount(context.workspaceId, instagramAccountId ?? null);
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Instagram account not connected." },
        { status: 400 }
      ),
    };
  }
  return { ok: true, context, account };
}
