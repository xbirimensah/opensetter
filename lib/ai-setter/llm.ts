/**
 * LLM provider abstraction for the AI setter.
 *
 * Two configuration sources:
 *  - a UI-selected provider (LlmTarget): an API provider whose key is
 *    decrypted per call from the workspace's encrypted credential store,
 *    or a local CLI (no key); see providers/resolve.ts
 *  - the env-based provider below, the fallback when nothing is selected
 *
 * Four interchangeable env backends, resolved per call from env so a key
 * or provider change needs no restart:
 *  - anthropic:  @anthropic-ai/sdk against the Messages API (default)
 *  - openai:     any OpenAI-compatible /chat/completions endpoint
 *  - claude-cli: local `claude -p` binary (no API key spend)
 *  - codex-cli:  local `codex exec` binary
 */

import { execFile } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import type { ApiLlmTarget, CliLlmTarget, LlmTarget } from "./providers/resolve";
import {
  buildClaudeCliArgs,
  buildCodexCliArgs,
  resolveCliBin,
  type CliProviderId,
} from "./providers/cli";
import { isPrivateBaseUrlAllowed } from "./providers/base-url";
import { postJsonGuarded } from "./providers/guarded-request";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 120_000;
const HTTP_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 2048;
/** Reasoning models spend output tokens on thinking; leave headroom. */
const TARGET_MAX_OUTPUT_TOKENS = 4096;
const MAX_ERROR_BODY_CHARS = 300;

/** Remove a secret from text before it can reach logs or the database. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export type SetterLlmProvider =
  | "anthropic"
  | "openai"
  | "claude-cli"
  | "codex-cli";

export interface SetterLlmConfig {
  provider: SetterLlmProvider;
  model: string;
  baseUrl: string;
}

/** "" for the CLIs: no --model flag, the CLI's own default runs. */
const DEFAULT_MODELS: Record<SetterLlmProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4o-mini",
  "claude-cli": "",
  "codex-cli": "",
};

export function readSetterLlmConfig(): SetterLlmConfig {
  const raw = (process.env.AI_SETTER_PROVIDER ?? "anthropic").toLowerCase();
  const provider: SetterLlmProvider =
    raw === "openai" || raw === "claude-cli" || raw === "codex-cli"
      ? raw
      : "anthropic";

  return {
    provider,
    model: process.env.AI_SETTER_MODEL ?? DEFAULT_MODELS[provider],
    baseUrl: process.env.AI_SETTER_BASE_URL ?? "https://api.openai.com/v1",
  };
}

function resolveApiKey(provider: SetterLlmProvider): string | null {
  const generic = process.env.AI_SETTER_API_KEY ?? null;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY ?? generic;
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? generic;
  return null;
}

export interface EnvLlmFallback {
  provider: SetterLlmProvider;
  model: string;
  /** API providers: whether a key is set. CLI providers authenticate locally. */
  hasKey: boolean;
  kind: "api" | "cli";
}

/** Describe the env-based provider for the UI, without any secret. */
export function describeEnvLlmFallback(): EnvLlmFallback {
  const config = readSetterLlmConfig();
  const isCli = config.provider === "claude-cli" || config.provider === "codex-cli";
  return {
    provider: config.provider,
    model: config.model,
    hasKey: isCli ? true : Boolean(resolveApiKey(config.provider)),
    kind: isCli ? "cli" : "api",
  };
}

/** Refuse to send an API key over plain http to a non-localhost host. */
export function assertSafeBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol === "https:") return;
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return;
  throw new Error(
    `AI_SETTER_BASE_URL uses plain http to a remote host (${host}); refusing to send credentials`
  );
}

async function completeViaAnthropic(
  system: string,
  userPrompt: string,
  config: SetterLlmConfig
): Promise<string> {
  const apiKey = resolveApiKey("anthropic");
  if (!apiKey) {
    throw new Error(
      "anthropic provider needs ANTHROPIC_API_KEY or AI_SETTER_API_KEY"
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: config.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("model declined the request (stop_reason: refusal)");
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function completeViaOpenAiCompatible(
  system: string,
  userPrompt: string,
  config: SetterLlmConfig
): Promise<string> {
  const apiKey = resolveApiKey("openai");
  if (!apiKey) {
    throw new Error(
      "openai provider needs OPENAI_API_KEY or AI_SETTER_API_KEY"
    );
  }
  assertSafeBaseUrl(config.baseUrl);

  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `openai-compatible endpoint returned ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai-compatible endpoint returned no content");
  return content;
}

/** Run one prompt through a local CLI; an empty model uses the CLI default. */
async function completeViaCli(
  provider: CliProviderId,
  prompt: string,
  model: string | null
): Promise<string> {
  const args =
    provider === "codex-cli"
      ? buildCodexCliArgs(prompt, model || null)
      : buildClaudeCliArgs(prompt, model || null);
  const { stdout } = await execFileAsync(resolveCliBin(provider), args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

// ─── UI-selected providers ──────────────────────────────────────────────────

/** POST to a UI-configured provider and parse JSON, redacting the key from errors. */
async function postToProvider<T>(
  target: ApiLlmTarget,
  path: string,
  payload: unknown
): Promise<T> {
  const response = await postJsonGuarded(
    `${target.baseUrl}${path}`,
    { Authorization: `Bearer ${target.apiKey}` },
    payload,
    { timeoutMs: HTTP_TIMEOUT_MS, allowPrivate: isPrivateBaseUrlAllowed() }
  );
  if (response.status < 200 || response.status >= 300) {
    const detail = redactSecret(response.body, target.apiKey).slice(0, MAX_ERROR_BODY_CHARS);
    throw new Error(`${target.provider} returned ${response.status}: ${detail}`);
  }
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`${target.provider} returned a non-JSON response`);
  }
}

async function completeTargetViaAnthropic(
  system: string,
  userPrompt: string,
  target: ApiLlmTarget
): Promise<string> {
  const client = new Anthropic({ apiKey: target.apiKey, timeout: HTTP_TIMEOUT_MS });
  const response = await client.messages.create({
    model: target.model,
    max_tokens: TARGET_MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("model declined the request (stop_reason: refusal)");
  }
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

interface ResponsesApiOutput {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

/** OpenAI Responses API: the route that serves Codex-class models too. */
async function completeTargetViaResponses(
  system: string,
  userPrompt: string,
  target: ApiLlmTarget
): Promise<string> {
  const data = await postToProvider<ResponsesApiOutput>(target, "/responses", {
    model: target.model,
    instructions: system,
    input: userPrompt,
    max_output_tokens: TARGET_MAX_OUTPUT_TOKENS,
  });
  const text =
    data.output_text ??
    (data.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && part.text)
      .map((part) => part.text)
      .join("\n");
  if (!text) throw new Error(`${target.provider} returned no text output`);
  return text;
}

async function completeTargetViaChat(
  system: string,
  userPrompt: string,
  target: ApiLlmTarget
): Promise<string> {
  const data = await postToProvider<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(target, "/chat/completions", {
    model: target.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${target.provider} returned no content`);
  return content;
}

async function completeWithTarget(
  system: string,
  userPrompt: string,
  target: ApiLlmTarget
): Promise<string> {
  try {
    if (target.apiStyle === "anthropic") {
      return await completeTargetViaAnthropic(system, userPrompt, target);
    }
    if (target.apiStyle === "openai-responses") {
      return await completeTargetViaResponses(system, userPrompt, target);
    }
    return await completeTargetViaChat(system, userPrompt, target);
  } catch (error: unknown) {
    // SDK and fetch errors can echo request details; never let the key
    // travel further than this function.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecret(message, target.apiKey));
  }
}

function completeWithCliTarget(
  system: string,
  userPrompt: string,
  target: CliLlmTarget
): Promise<string> {
  return completeViaCli(target.provider, `${system}\n\n${userPrompt}`, target.model);
}

/**
 * Run one draft completion. The system block carries the setter
 * instructions; the user prompt carries the untrusted conversation
 * material. CLI providers get both concatenated since they take a
 * single prompt string.
 */
export async function completeSetterPrompt(
  system: string,
  userPrompt: string,
  target?: LlmTarget | null
): Promise<string> {
  if (target?.kind === "cli") return completeWithCliTarget(system, userPrompt, target);
  if (target) return completeWithTarget(system, userPrompt, target);
  const config = readSetterLlmConfig();
  if (config.provider === "anthropic") {
    return completeViaAnthropic(system, userPrompt, config);
  }
  if (config.provider === "openai") {
    return completeViaOpenAiCompatible(system, userPrompt, config);
  }
  return completeViaCli(config.provider, `${system}\n\n${userPrompt}`, config.model);
}
