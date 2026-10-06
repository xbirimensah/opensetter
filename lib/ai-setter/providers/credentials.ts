/**
 * Workspace-scoped store for model-provider API keys.
 *
 * Write-only from the browser's perspective: listProviderStatuses and
 * saveProviderCredential return a public view (configured, fingerprint,
 * model, base URL) and never the key or its ciphertext.
 */

import { prisma } from "@/lib/db/client";
import {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  type ProviderId,
} from "./catalog";
import {
  decryptCredential,
  encryptCredential,
  fingerprintCredential,
} from "./credential-crypto";
import { isPrivateBaseUrlAllowed, validateProviderBaseUrl } from "./base-url";

export const MAX_API_KEY_LENGTH = 512;
export const MAX_MODEL_ID_LENGTH = 200;

export interface PublicProviderStatus {
  provider: ProviderId;
  label: string;
  configured: boolean;
  keyFingerprint: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  updatedAt: Date | null;
  requiresBaseUrl: boolean;
  suggestedModels: string[];
  catalogDefaultModel: string;
  keyHelp: string;
}

interface StoredCredentialView {
  provider: string;
  keyFingerprint: string;
  baseUrl: string | null;
  defaultModel: string | null;
  updatedAt: Date;
}

function toPublicStatus(
  provider: ProviderId,
  row: StoredCredentialView | null
): PublicProviderStatus {
  const definition = PROVIDER_CATALOG[provider];
  return {
    provider,
    label: definition.label,
    configured: row !== null,
    keyFingerprint: row?.keyFingerprint ?? null,
    baseUrl: row?.baseUrl ?? null,
    defaultModel: row?.defaultModel ?? null,
    updatedAt: row?.updatedAt ?? null,
    requiresBaseUrl: definition.requiresBaseUrl,
    suggestedModels: definition.suggestedModels,
    catalogDefaultModel: definition.defaultModel,
    keyHelp: definition.keyHelp,
  };
}

const PUBLIC_SELECT = {
  provider: true,
  keyFingerprint: true,
  baseUrl: true,
  defaultModel: true,
  updatedAt: true,
} as const;

export async function listProviderStatuses(
  workspaceId: string
): Promise<PublicProviderStatus[]> {
  const rows = await prisma.aiProviderCredential.findMany({
    where: { workspaceId },
    select: PUBLIC_SELECT,
  });
  return PROVIDER_IDS.map((provider) =>
    toPublicStatus(provider, rows.find((row) => row.provider === provider) ?? null)
  );
}

export class ProviderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderInputError";
  }
}

export async function saveProviderCredential(params: {
  workspaceId: string;
  provider: ProviderId;
  apiKey: string;
  baseUrl: string | null;
  defaultModel: string | null;
  userId: string;
}): Promise<PublicProviderStatus> {
  const definition = PROVIDER_CATALOG[params.provider];
  const apiKey = params.apiKey.trim();
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /\s/.test(apiKey)) {
    throw new ProviderInputError("API key is empty or malformed");
  }

  let baseUrl: string | null = null;
  const rawBaseUrl = params.baseUrl?.trim();
  if (rawBaseUrl) {
    const check = validateProviderBaseUrl(rawBaseUrl, {
      allowPrivate: isPrivateBaseUrlAllowed(),
    });
    if (!check.ok) throw new ProviderInputError(check.error);
    baseUrl = check.url;
  } else if (definition.requiresBaseUrl) {
    throw new ProviderInputError("This provider needs a base URL");
  }

  const defaultModel = params.defaultModel?.trim().slice(0, MAX_MODEL_ID_LENGTH) || null;
  if (definition.requiresBaseUrl && !defaultModel) {
    throw new ProviderInputError("This provider needs a model id");
  }

  // Encrypt first: without a valid encryption key this throws and
  // nothing is written.
  const context = { workspaceId: params.workspaceId, provider: params.provider };
  const encryptedKey = encryptCredential(apiKey, context);
  const keyFingerprint = fingerprintCredential(apiKey);
  const values = {
    encryptedKey,
    keyFingerprint,
    baseUrl,
    defaultModel,
    updatedByUserId: params.userId,
  };

  const row = await prisma.aiProviderCredential.upsert({
    where: {
      workspaceId_provider: {
        workspaceId: params.workspaceId,
        provider: params.provider,
      },
    },
    create: { workspaceId: params.workspaceId, provider: params.provider, ...values },
    update: values,
    select: PUBLIC_SELECT,
  });
  return toPublicStatus(params.provider, row);
}

/**
 * Delete a saved key. Accounts that had selected this provider are reset
 * to the env-based provider in the same transaction, so the UI shows
 * exactly what will run next instead of a selection that now fails.
 */
export async function deleteProviderCredential(
  workspaceId: string,
  provider: ProviderId
): Promise<boolean> {
  const [deleted] = await prisma.$transaction([
    prisma.aiProviderCredential.deleteMany({ where: { workspaceId, provider } }),
    prisma.aiSetterConfig.updateMany({
      where: { llmProvider: provider, instagramAccount: { workspaceId } },
      data: { llmProvider: null, llmModel: null },
    }),
  ]);
  return deleted.count > 0;
}

export interface ProviderSecret {
  apiKey: string;
  baseUrl: string | null;
  defaultModel: string | null;
}

/** Server-only: decrypt a saved key for an outgoing model call. */
export async function loadProviderSecret(
  workspaceId: string,
  provider: ProviderId
): Promise<ProviderSecret | null> {
  const row = await prisma.aiProviderCredential.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
    select: { encryptedKey: true, baseUrl: true, defaultModel: true },
  });
  if (!row) return null;
  return {
    apiKey: decryptCredential(row.encryptedKey, { workspaceId, provider }),
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
  };
}
