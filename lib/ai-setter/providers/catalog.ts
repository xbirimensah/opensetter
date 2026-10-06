/**
 * Model providers selectable in the AI Setter UI. Model ids are
 * suggestions only; the UI accepts any id the provider serves.
 */

import { isCliProviderId, type CliProviderId } from "./cli-shared";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "xai"
  | "openrouter"
  | "openai-compatible";

/**
 * Wire protocol per provider:
 * - anthropic: official SDK, Messages API
 * - openai-responses: OpenAI Responses API (the only route to Codex models)
 * - openai-chat: OpenAI-style /chat/completions
 */
export type ProviderApiStyle = "anthropic" | "openai-responses" | "openai-chat";

export interface ProviderDefinition {
  label: string;
  apiStyle: ProviderApiStyle;
  /** Null when the operator must supply one. */
  defaultBaseUrl: string | null;
  requiresBaseUrl: boolean;
  defaultModel: string;
  suggestedModels: string[];
  /** Where to create a key, shown next to the input. */
  keyHelp: string;
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderDefinition> = {
  anthropic: {
    label: "Anthropic (Claude)",
    apiStyle: "anthropic",
    defaultBaseUrl: null,
    requiresBaseUrl: false,
    defaultModel: "claude-opus-5-5",
    suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    keyHelp: "platform.claude.com → API keys",
  },
  openai: {
    label: "OpenAI (incl. Codex)",
    apiStyle: "openai-responses",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresBaseUrl: false,
    defaultModel: "gpt-5",
    suggestedModels: ["gpt-5", "gpt-5-mini", "gpt-5-codex"],
    keyHelp: "platform.openai.com → API keys",
  },
  gemini: {
    label: "Google Gemini",
    apiStyle: "openai-chat",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    requiresBaseUrl: false,
    defaultModel: "gemini-2.5-pro",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    keyHelp: "aistudio.google.com → Get API key",
  },
  xai: {
    label: "xAI (Grok)",
    apiStyle: "openai-chat",
    defaultBaseUrl: "https://api.x.ai/v1",
    requiresBaseUrl: false,
    defaultModel: "grok-4",
    suggestedModels: ["grok-4", "grok-4-fast"],
    keyHelp: "console.x.ai → API keys",
  },
  openrouter: {
    label: "OpenRouter",
    apiStyle: "openai-chat",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresBaseUrl: false,
    defaultModel: "anthropic/claude-sonnet-5-5",
    suggestedModels: ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "openai/gpt-5"],
    keyHelp: "openrouter.ai → Keys",
  },
  "openai-compatible": {
    label: "OpenAI-compatible (custom)",
    apiStyle: "openai-chat",
    defaultBaseUrl: null,
    requiresBaseUrl: true,
    defaultModel: "",
    suggestedModels: [],
    keyHelp: "Any https endpoint that serves /chat/completions",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDER_CATALOG) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDER_CATALOG;
}

/** API providers (saved key) plus local CLI providers (operator login). */
export type SelectableProviderId = ProviderId | CliProviderId;

export function isSelectableProvider(value: unknown): value is SelectableProviderId {
  return isProviderId(value) || isCliProviderId(value);
}
