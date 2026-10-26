import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { encryptToken } from "@/lib/meta/oauth";
import { newWebhookSecret } from "@/lib/integrations/events";
import {
  badRequest,
  createEndpointSchema,
  ENDPOINT_VIEW_SELECT,
  MAX_ENDPOINTS,
  readJson,
  requireIntegrationManager,
  toEndpointView,
} from "@/lib/integrations/manage";

export async function GET() {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const rows = await prisma.webhookEndpoint.findMany({
    where: { workspaceId: access.context.workspaceId },
    select: ENDPOINT_VIEW_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ success: true, data: { endpoints: rows.map(toEndpointView) } });
}

/** Add an endpoint. The signing secret is returned once, here only. */
export async function POST(request: NextRequest) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const parsed = createEndpointSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error);

  const { workspaceId, userId } = access.context;
  const count = await prisma.webhookEndpoint.count({ where: { workspaceId } });
  if (count >= MAX_ENDPOINTS) return badRequest(`A workspace can have up to ${MAX_ENDPOINTS} webhooks.`);

  const secret = newWebhookSecret();
  const row = await prisma.webhookEndpoint.create({
    data: { workspaceId, url: parsed.data.url, events: parsed.data.events, secret: encryptToken(secret) },
    select: ENDPOINT_VIEW_SELECT,
  });
  await audit({
    action: "webhooks.endpoint_saved",
    workspaceId,
    actorUserId: userId,
    detail: { endpointId: row.id, host: new URL(row.url).host },
  });
  return NextResponse.json({ success: true, data: { endpoint: toEndpointView(row), secret } }, { status: 201 });
}
