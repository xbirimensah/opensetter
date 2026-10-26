import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { generateApiKey } from "@/lib/integrations/api-keys";
import {
  API_KEY_VIEW_SELECT,
  badRequest,
  createApiKeySchema,
  MAX_API_KEYS,
  readJson,
  requireIntegrationManager,
  toApiKeyView,
} from "@/lib/integrations/manage";

export async function GET() {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const rows = await prisma.apiKey.findMany({
    where: { workspaceId: access.context.workspaceId, revokedAt: null },
    select: API_KEY_VIEW_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ success: true, data: { keys: rows.map(toApiKeyView) } });
}

/** Create a key. The key itself is returned once, here only; only its hash is stored. */
export async function POST(request: NextRequest) {
  const access = await requireIntegrationManager();
  if (!access.ok) return access.response;
  const parsed = createApiKeySchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error);

  const { workspaceId, userId } = access.context;
  const count = await prisma.apiKey.count({ where: { workspaceId, revokedAt: null } });
  if (count >= MAX_API_KEYS) return badRequest(`A workspace can have up to ${MAX_API_KEYS} API keys.`);

  const { key, prefix, keyHash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: { workspaceId, name: parsed.data.name, prefix, keyHash, createdById: userId },
    select: API_KEY_VIEW_SELECT,
  });
  await audit({ action: "api_keys.created", workspaceId, actorUserId: userId, detail: { keyId: row.id, prefix } });
  return NextResponse.json({ success: true, data: { key: toApiKeyView(row), secret: key } }, { status: 201 });
}
