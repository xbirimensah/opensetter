import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { authenticateApiRequest } from "@/lib/integrations/api-keys";

/**
 * Who am I: the key's workspace, its Instagram accounts and active flows.
 * Zapier, Make and n8n use it to test the connection and fill dropdowns.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { workspaceId } = auth.caller;
  const [workspace, accounts, flows] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } }),
    prisma.instagramAccount.findMany({ where: { workspaceId }, select: { id: true, username: true } }),
    prisma.flow.findMany({
      where: { workspaceId, status: "ACTIVE" },
      select: { id: true, name: true, instagramAccountId: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ success: true, data: { workspace, instagramAccounts: accounts, flows } });
}
