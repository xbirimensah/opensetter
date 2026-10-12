import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { z } from "zod";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import {
  deleteProviderCredential,
  listProviderStatuses,
  saveProviderCredential,
} from "@/lib/ai-setter/providers/credentials";
import { isProviderId } from "@/lib/ai-setter/providers/catalog";
import { getCredentialEncryptionReadiness } from "@/lib/ai-setter/providers/credential-crypto";
import { describeEnvLlmFallback } from "@/lib/ai-setter/llm";
import { discoverCliProviders } from "@/lib/ai-setter/providers/cli";

// The API key travels browser → server exactly once, on save. Every
// response carries the public view only (configured, fingerprint, model).
const saveSchema = z.object({
  provider: z.string().refine(isProviderId, "Unknown provider"),
  apiKey: z.string().min(1).max(512),
  baseUrl: z.string().max(500).optional().nullable(),
  defaultModel: z.string().max(200).optional().nullable(),
});

function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json(
    { success: false, error: "Only workspace owners and admins can manage model provider keys." },
    { status: 403 }
  );
}

function encryptionUnavailable(message: string) {
  return NextResponse.json(
    { success: false, error: message, code: "encryption_unavailable" },
    { status: 503 }
  );
}

// Provider readiness for the workspace: which keys are saved (never the
// keys), whether encryption is configured, the local CLIs (install, sign-in
// state, models they expose) and the env fallback. ?refresh=1 re-probes
// the CLIs instead of using the short discovery cache.
export async function GET(request?: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();

  const refresh = request?.nextUrl.searchParams.get("refresh") === "1";
  const [providers, cli] = await Promise.all([
    listProviderStatuses(context.workspaceId),
    discoverCliProviders({ refresh }),
  ]);
  return NextResponse.json(
    {
      success: true,
      data: {
        providers,
        cli,
        encryption: getCredentialEncryptionReadiness(),
        envFallback: describeEnvLlmFallback(),
        canManage: canManageWorkspace(context.role),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Save (or replace) one provider's key. Admin-only, fails closed when
// the encryption key is missing.
export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();

  let parsed: z.infer<typeof saveSchema>;
  try {
    parsed = saveSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid provider payload" },
      { status: 400 }
    );
  }
  if (!isProviderId(parsed.provider)) {
    return NextResponse.json({ success: false, error: "Unknown provider" }, { status: 400 });
  }

  const readiness = getCredentialEncryptionReadiness();
  if (!readiness.ready) return encryptionUnavailable(readiness.message);

  try {
    const provider = await saveProviderCredential({
      workspaceId: context.workspaceId,
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      baseUrl: parsed.baseUrl ?? null,
      defaultModel: parsed.defaultModel ?? null,
      userId: context.userId,
    });
    await audit({
      action: "ai.provider_key_saved",
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      detail: { provider: parsed.provider },
    });
    return NextResponse.json({ success: true, data: { provider } });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    if (name === "ProviderInputError") {
      return NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 400 }
      );
    }
    if (name === "CredentialEncryptionUnavailableError") {
      return encryptionUnavailable((error as Error).message);
    }
    // Never log the request body: it carries the key.
    console.error("[ai-setter] saving provider key failed:", name || "unknown error");
    return NextResponse.json(
      { success: false, error: "Could not save the provider key" },
      { status: 500 }
    );
  }
}

// Remove one provider's key; accounts using it fall back to the env provider.
export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return unauthorized();
  if (!canManageWorkspace(context.role)) return forbidden();

  const provider = request.nextUrl.searchParams.get("provider");
  if (!isProviderId(provider)) {
    return NextResponse.json({ success: false, error: "Unknown provider" }, { status: 400 });
  }

  const removed = await deleteProviderCredential(context.workspaceId, provider);
  if (removed) {
    await audit({
      action: "ai.provider_key_removed",
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      detail: { provider },
    });
  }
  return NextResponse.json({ success: true, data: { removed } });
}
