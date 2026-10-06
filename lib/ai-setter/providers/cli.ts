/**
 * Local CLI providers: Claude Code (`claude -p`) and Codex (`codex exec`)
 * running on this server under the operator's own CLI login. No API key
 * is stored or needed; the CLI's subscription pays for the call.
 *
 * Discovery never invents models. Codex ships a machine-readable model
 * catalog (`codex debug models`); Claude Code has no list command, so its
 * options are the aliases its own `--help` documents for `--model`. Any
 * other id stays usable as a custom model id. Auth status is reduced to
 * a readiness state; account identity (email, org) never leaves here.
 */

import { execFile } from "child_process";
import {
  CLI_PROVIDER_IDS,
  isValidCliModelId,
  type CliAuthStatus,
  type CliModelOption,
  type CliProviderId,
  type CliProviderStatus,
} from "./cli-shared";

export * from "./cli-shared";

/** Set to "off" to hide and refuse CLI providers (e.g. shared hosting). */
export const CLI_PROVIDERS_ENV = "AI_SETTER_CLI_PROVIDERS";

const DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_CACHE_MS = 60_000;
/** The Codex catalog carries full model instructions; ~0.5 MB today. */
const DISCOVERY_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_DETAIL_CHARS = 120;

interface CliDefinition {
  label: string;
  binEnv: string;
  defaultBin: string;
  loginHint: string;
}

export const CLI_CATALOG: Record<CliProviderId, CliDefinition> = {
  "claude-cli": {
    label: "Claude Code (local CLI)",
    binEnv: "AI_SETTER_CLAUDE_BIN",
    defaultBin: "claude",
    loginHint: "run `claude auth login` as the user that runs OpenSetter",
  },
  "codex-cli": {
    label: "Codex (local CLI)",
    binEnv: "AI_SETTER_CODEX_BIN",
    defaultBin: "codex",
    loginHint: "run `codex login` as the user that runs OpenSetter",
  },
};

export function cliProvidersEnabled(): boolean {
  return (process.env[CLI_PROVIDERS_ENV] ?? "").trim().toLowerCase() !== "off";
}

export function resolveCliBin(provider: CliProviderId): string {
  const definition = CLI_CATALOG[provider];
  return process.env[definition.binEnv]?.trim() || definition.defaultBin;
}

export function buildClaudeCliArgs(prompt: string, model: string | null): string[] {
  return [
    "--strict-mcp-config",
    "--setting-sources",
    "",
    ...(model ? ["--model", model] : []),
    "-p",
    prompt,
  ];
}

export function buildCodexCliArgs(prompt: string, model: string | null): string[] {
  return ["exec", "--sandbox", "read-only", ...(model ? ["--model", model] : []), prompt];
}

// ─── discovery ──────────────────────────────────────────────────────────────

export interface CliCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CliCommandRunner = (
  bin: string,
  args: string[],
  options: { timeoutMs: number; maxBuffer: number }
) => Promise<CliCommandResult>;

class CliMissingError extends Error {
  constructor(bin: string) {
    super(`${bin} not found`);
    this.name = "CliMissingError";
  }
}

/** Run a discovery command; non-zero exits are results, a missing binary throws. */
const defaultRunner: CliCommandRunner = (bin, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: options.timeoutMs, maxBuffer: options.maxBuffer, env: process.env },
      (error, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const err = typeof stderr === "string" ? stderr : String(stderr ?? "");
        if (!error) return resolve({ stdout: out, stderr: err, exitCode: 0 });
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EACCES") return reject(new CliMissingError(bin));
        resolve({ stdout: out, stderr: err, exitCode: typeof code === "number" ? code : 1 });
      }
    );
  });

function shorten(text: string): string {
  return text.trim().split("\n")[0].slice(0, MAX_DETAIL_CHARS);
}

/** Aliases quoted in the `--model` help entry, e.g. 'fable', 'opus', or 'sonnet'. */
export function parseClaudeModelAliases(helpText: string): string[] {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => /^\s*--model\b/.test(line));
  if (start === -1) return [];
  const block: string[] = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*-/.test(line)) break;
    block.push(line);
  }
  const text = block.join(" ");
  const aliasClause = text.match(/alias[^(]*\(e\.g\.([^)]*)\)/i);
  if (!aliasClause) return [];
  const aliases = [...aliasClause[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1].trim())
    .filter(isValidCliModelId);
  return [...new Set(aliases)];
}

export function parseClaudeAuthStatus(stdout: string): CliAuthStatus {
  try {
    const parsed = JSON.parse(stdout) as {
      loggedIn?: unknown;
      authMethod?: unknown;
      subscriptionType?: unknown;
    };
    if (parsed.loggedIn !== true) return { state: "unauthenticated", detail: null };
    const detail = [parsed.authMethod, parsed.subscriptionType]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ");
    return { state: "ready", detail: detail ? shorten(detail) : null };
  } catch {
    return { state: "unknown", detail: null };
  }
}

interface CodexCatalogModel {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  priority?: unknown;
}

export function parseCodexModelCatalog(stdout: string): CliModelOption[] {
  let models: CodexCatalogModel[];
  try {
    const parsed = JSON.parse(stdout) as { models?: unknown };
    models = Array.isArray(parsed.models) ? (parsed.models as CodexCatalogModel[]) : [];
  } catch {
    return [];
  }
  return models
    .filter(
      (model): model is CodexCatalogModel & { slug: string } =>
        typeof model.slug === "string" &&
        isValidCliModelId(model.slug) &&
        model.visibility === "list"
    )
    .map((model) => ({
      option: {
        id: model.slug,
        label: typeof model.display_name === "string" ? model.display_name : model.slug,
        source: "catalog" as const,
      },
      priority: typeof model.priority === "number" ? model.priority : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => entry.option);
}

export function parseCodexLoginStatus(stdout: string, exitCode: number): CliAuthStatus {
  const detail = stdout.trim() ? shorten(stdout) : null;
  if (exitCode === 0 && /logged in/i.test(stdout) && !/not logged in/i.test(stdout)) {
    return { state: "ready", detail };
  }
  return { state: "unauthenticated", detail };
}

async function tryRun(
  runner: CliCommandRunner,
  bin: string,
  args: string[]
): Promise<CliCommandResult | null> {
  try {
    return await runner(bin, args, {
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBuffer: DISCOVERY_MAX_BUFFER,
    });
  } catch {
    return null;
  }
}

function describeProblem(
  provider: CliProviderId,
  installed: boolean,
  auth: CliAuthStatus
): string | null {
  const definition = CLI_CATALOG[provider];
  const name = definition.label.replace(" (local CLI)", "");
  if (!installed) {
    return `${name} CLI is not installed on this server (looked for \`${resolveCliBin(provider)}\`; set ${definition.binEnv} to its path).`;
  }
  if (auth.state === "unauthenticated") return `${name} CLI is not signed in: ${definition.loginHint}.`;
  if (auth.state === "unknown") return `Could not read ${name} CLI sign-in status.`;
  return null;
}

function disabledStatus(provider: CliProviderId, checkedAt: string): CliProviderStatus {
  return {
    provider,
    label: CLI_CATALOG[provider].label,
    enabled: false,
    installed: false,
    version: null,
    auth: { state: "unknown", detail: null },
    selectable: false,
    problem: `Local CLI providers are switched off (${CLI_PROVIDERS_ENV}=off).`,
    models: [],
    checkedAt,
  };
}

async function probeCli(
  provider: CliProviderId,
  runner: CliCommandRunner,
  checkedAt: string
): Promise<CliProviderStatus> {
  const bin = resolveCliBin(provider);
  const isClaude = provider === "claude-cli";
  const [versionResult, modelsResult, authResult] = await Promise.all([
    tryRun(runner, bin, ["--version"]),
    tryRun(runner, bin, isClaude ? ["--help"] : ["debug", "models"]),
    tryRun(runner, bin, isClaude ? ["auth", "status", "--json"] : ["login", "status"]),
  ]);

  const installed = versionResult !== null && versionResult.exitCode === 0;
  const auth: CliAuthStatus = !installed || !authResult
    ? { state: "unknown", detail: null }
    : isClaude
      ? parseClaudeAuthStatus(authResult.stdout)
      : // `codex login status` reports on stderr.
        parseCodexLoginStatus(`${authResult.stdout}\n${authResult.stderr}`.trim(), authResult.exitCode);
  const models: CliModelOption[] = !installed || !modelsResult
    ? []
    : isClaude
      ? parseClaudeModelAliases(modelsResult.stdout).map((id) => ({ id, label: id, source: "alias" as const }))
      : parseCodexModelCatalog(modelsResult.stdout);

  return {
    provider,
    label: CLI_CATALOG[provider].label,
    enabled: true,
    installed,
    version: installed && versionResult ? shorten(versionResult.stdout) || null : null,
    auth,
    selectable: installed,
    problem: describeProblem(provider, installed, auth),
    models,
    checkedAt,
  };
}

let cache: { at: number; statuses: CliProviderStatus[] } | null = null;
let inFlight: Promise<CliProviderStatus[]> | null = null;

export function resetCliDiscoveryCache(): void {
  cache = null;
  inFlight = null;
}

/**
 * Installed CLIs, their sign-in state and the models they expose. Cached
 * briefly because it spawns several processes; `refresh` forces a re-run.
 */
export async function discoverCliProviders(
  options: { refresh?: boolean; runner?: CliCommandRunner } = {}
): Promise<CliProviderStatus[]> {
  const checkedAt = new Date().toISOString();
  if (!cliProvidersEnabled()) {
    return CLI_PROVIDER_IDS.map((provider) => disabledStatus(provider, checkedAt));
  }
  if (!options.refresh && cache && Date.now() - cache.at < DISCOVERY_CACHE_MS) {
    return cache.statuses;
  }
  if (!options.refresh && inFlight) return inFlight;

  const runner = options.runner ?? defaultRunner;
  const probe = Promise.all(CLI_PROVIDER_IDS.map((provider) => probeCli(provider, runner, checkedAt)));
  inFlight = probe;
  try {
    const statuses = await probe;
    cache = { at: Date.now(), statuses };
    return statuses;
  } finally {
    if (inFlight === probe) inFlight = null;
  }
}
