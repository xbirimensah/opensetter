import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { requireIntegrationManager } from "@/lib/integrations/manage";

type RouteProps = { params: Promise<{ id: string }> };

/** Revoke a key. Kept as a row (revokedAt) so the audit trail still resolves it. */
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const { id } = await params;
  const { workspaceId, userId } = access.context;
  const { count } = await prisma.apiKey.updateMany({
    where: { id, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ success: false, error: "API key not found" }, { status: 404 });
  await audit({ action: "api_keys.revoked", workspaceId, actorUserId: userId, detail: { keyId: id } });
  return NextResponse.json({ success: true });
}
