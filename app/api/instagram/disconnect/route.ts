import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can disconnect accounts" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body.instagramAccountId === "string" && body.instagramAccountId.length <= 64
      ? body.instagramAccountId
      : null;
  // One account at a time: a request without an id must never wipe them all.
  if (!instagramAccountId) {
    return NextResponse.json({ success: false, error: "Name the account to disconnect" }, { status: 400 });
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true, username: true },
  });
  if (!account) {
    return NextResponse.json({ success: false, error: "Account not found" }, { status: 404 });
  }
  await prisma.instagramAccount.delete({ where: { id: account.id } });
  await audit({
    action: "instagram.disconnected",
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    detail: { username: account.username },
  });

  return NextResponse.json({ success: true });
}
