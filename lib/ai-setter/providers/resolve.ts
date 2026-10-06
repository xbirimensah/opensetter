/**
 * Turn the per-account provider selection into a concrete call target.
 * No selection means "use the env-based provider", which keeps every
 * existing deployment working unchanged. A selection that cannot be
 * honoured (no saved key, no encryption key, CLIs switched off, unsafe
 * model id) throws instead of silently falling back, so a draft is never
 * produced by a provider the owner did not choose.
 */

import { PROVIDER_CATALOG, isProviderId, type ProviderId, type ProviderApiStyle } from "./catalog";
import { getCredentialEncryptionReadiness } from "./credential-crypto";
import { loadProviderSecret } from "./credentials";
import {
  CLI_CATALOG,
  CLI_PROVIDERS_ENV,
  cliProvidersEnabled,
  isCliProviderId,
  isValidCliModelId,
  type CliProviderId,
} from "./cli";

export interface LlmSelection {
  workspaceId: string;
  provider: string | null;
  model: string | null;
}

export interface ApiLlmTarget {
  kind: "api";
  provider: ProviderId;
  apiStyle: ProviderApiStyle;
  model: string;
  apiKey: string;
  /** Null for the Anthropic SDK default endpoint. */
  baseUrl: string | null;
}

/** A local CLI under the operator's login; no key involved. */
export interface CliLlmTarget {
  kind: "cli";
  provider: CliProviderId;
  /** Null lets the CLI use its own default model. */
  model: string | null;
}

export type LlmTarget = ApiLlmTarget | CliLlmTarget;

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

export async function resolveLlmTarget(
  selection: LlmSelection
): Promise<LlmTarget | null> {
  const provider = selection.provider?.trim();
  if (!provider) return null;
  if (isCliProviderId(provider)) return resolveCliTarget(provider, selection.model);
  if (!isProviderId(provider)) {
    throw new LlmConfigurationError(`Unknown model provider "${provider}"`);
  }

  const readiness = getCredentialEncryptionReadiness();
  if (!readiness.ready) throw new LlmConfigurationError(readiness.message);

  const secret = await loadProviderSecret(selection.workspaceId, provider);
  if (!secret) {
    throw new LlmConfigurationError(
      `${PROVIDER_CATALOG[provider].label} is selected but no API key is saved for it`
    );
  }

  const definition = PROVIDER_CATALOG[provider];
  const model = selection.model?.trim() || secret.defaultModel || definition.defaultModel;
  if (!model) {
    throw new LlmConfigurationError(`No model selected for ${definition.label}`);
  }
  const baseUrl = secret.baseUrl ?? definition.defaultBaseUrl;
  if (definition.apiStyle !== "anthropic" && !baseUrl) {
    throw new LlmConfigurationError(`${definition.label} has no base URL configured`);
  }

  return { kind: "api", provider, apiStyle: definition.apiStyle, model, apiKey: secret.apiKey, baseUrl };
}

function resolveCliTarget(provider: CliProviderId, rawModel: string | null): CliLlmTarget {
  const label = CLI_CATALOG[provider].label;
  if (!cliProvidersEnabled()) {
    throw new LlmConfigurationError(
      `${label} is selected but local CLI providers are switched off (${CLI_PROVIDERS_ENV}=off)`
    );
  }
  const model = rawModel?.trim() || null;
  if (model && !isValidCliModelId(model)) {
    throw new LlmConfigurationError(`"${model.slice(0, 60)}" is not a valid model id for ${label}`);
  }
  return { kind: "cli", provider, model };
}
