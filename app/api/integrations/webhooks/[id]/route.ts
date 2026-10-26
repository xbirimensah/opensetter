import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import {
  badRequest,
  ENDPOINT_VIEW_SELECT,
  readJson,
  requireIntegrationManager,
  toEndpointView,
  updateEndpointSchema,
} from "@/lib/integrations/manage";

type RouteProps = { params: Promise<{ id: string }> };

function notFound() {
  return NextResponse.json({ success: false, error: "Webhook not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const { id } = await params;
  const parsed = updateEndpointSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error);

  const { workspaceId, userId } = access.context;
  const { count } = await prisma.webhookEndpoint.updateMany({ where: { id, workspaceId }, data: parsed.data });
  if (count === 0) return notFound();
  const row = await prisma.webhookEndpoint.findFirst({ where: { id, workspaceId }, select: ENDPOINT_VIEW_SELECT });
  if (!row) return notFound();
  if (parsed.data.url) {
    await audit({
      action: "webhooks.endpoint_saved",
      workspaceId,
      actorUserId: userId,
      detail: { endpointId: id, host: new URL(row.url).host },
    });
  }
  return NextResponse.json({ success: true, data: { endpoint: toEndpointView(row) } });
}

export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const { id } = await params;
  const { workspaceId, userId } = access.context;
  const { count } = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId } });
  if (count === 0) return notFound();
  await audit({ action: "webhooks.endpoint_removed", workspaceId, actorUserId: userId, detail: { endpointId: id } });
  return NextResponse.json({ success: true });
}
