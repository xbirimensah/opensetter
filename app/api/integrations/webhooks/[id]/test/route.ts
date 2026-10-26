import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireIntegrationManager } from "@/lib/integrations/manage";
import { sendTestEvent } from "@/lib/integrations/webhooks";

type RouteProps = { params: Promise<{ id: string }> };

/** Send one signed test event now and report what the endpoint answered. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const { id } = await params;
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id, workspaceId: access.context.workspaceId },
    select: { id: true, url: true, secret: true, workspaceId: true },
  });
  if (!endpoint) return NextResponse.json({ success: false, error: "Webhook not found" }, { status: 404 });
  const result = await sendTestEvent(endpoint);
  return NextResponse.json({ success: true, data: result });
}
