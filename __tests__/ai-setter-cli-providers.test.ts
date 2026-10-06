/**
 * Local CLI providers (Claude Code, Codex) - discovery and runtime tests
 *
 * CLI providers are first-class selections that need no API key. Model
 * options are only ever ones the CLI reports (Codex catalog) or aliases
 * its own --help documents (Claude Code); readiness reflects the CLI's
 * own auth status and never carries account identity to the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  prisma: { aiProviderCredential: { findUnique: vi.fn() } },
}));

vi.mock("child_process", () => ({ execFile: mocks.execFile }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));

import {
  CLI_PROVIDERS_ENV,
  buildClaudeCliArgs,
  buildCodexCliArgs,
  discoverCliProviders,
  isCliProviderId,
  isValidCliModelId,
  parseClaudeAuthStatus,
  parseClaudeModelAliases,
  parseCodexLoginStatus,
  parseCodexModelCatalog,
  resetCliDiscoveryCache,
  type CliCommandRunner,
} from "../lib/ai-setter/providers/cli";
import { isSelectableProvider } from "../lib/ai-setter/providers/catalog";
import { describeCliReadiness } from "../lib/ai-setter/providers/cli-shared";
import { LlmConfigurationError, resolveLlmTarget } from "../lib/ai-setter/providers/resolve";
import { completeSetterPrompt, describeEnvLlmFallback } from "../lib/ai-setter/llm";
import { CREDENTIALS_KEY_ENV } from "../lib/ai-setter/providers/credential-crypto";
import { personalizeCampaignOpener } from "../lib/ai-setter/campaign-opener";
import { generateWindowNudge } from "../lib/ai-setter/generate";

const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]

Options:
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  -n, --name <name>                     Set a display name for this session
`;

const CLAUDE_AUTH = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "owner@example.com",
  orgId: "a5d9c8b5-0000-0000-0000-772bbeeae437",
  orgName: "owner@example.com's Organization",
  subscriptionType: "max",
});

const CODEX_CATALOG = JSON.stringify({
  models: [
    { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list", priority: 3, description: "x" },
    { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list", priority: 2, description: "y" },
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 4 },
    { slug: "", display_name: "broken", visibility: "list", priority: 9 },
  ],
});

type FakeResult = { stdout?: string; stderr?: string; code?: number; missing?: boolean };

function fakeRunner(overrides: Record<string, FakeResult> = {}) {
  const defaults: Record<string, FakeResult> = {
    "claude --version": { stdout: "2.1.291 (Claude Code)\n" },
    "claude --help": { stdout: CLAUDE_HELP },
    "claude auth status --json": { stdout: CLAUDE_AUTH },
    "codex --version": { stdout: "codex-cli 0.155.1\n" },
    "codex debug models": { stdout: CODEX_CATALOG },
    // Codex prints its login status to stderr, not stdout.
    "codex login status": { stderr: "Logged in using ChatGPT\n" },
  };
  const table = { ...defaults, ...overrides };
  const runner: CliCommandRunner = vi.fn(async (bin: string, args: string[]) => {
    const key = `${bin.split("/").pop()} ${args.join(" ")}`;
    const entry = table[key];
    if (!entry || entry.missing) {
      const error = new Error(`spawn ${bin} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return { stdout: entry.stdout ?? "", stderr: entry.stderr ?? "", exitCode: entry.code ?? 0 };
  });
  return runner;
}

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = { ...process.env };
  delete process.env[CLI_PROVIDERS_ENV];
  delete process.env.AI_SETTER_CLAUDE_BIN;
  delete process.env.AI_SETTER_CODEX_BIN;
  resetCliDiscoveryCache();
});

afterEach(() => {
  process.env = savedEnv;
});

describe("CLI provider ids and model ids", () => {
  it("recognizes the CLI providers as selectable next to the API providers", () => {
    expect(isCliProviderId("claude-cli")).toBe(true);
    expect(isCliProviderId("codex-cli")).toBe(true);
    expect(isCliProviderId("anthropic")).toBe(false);
    expect(isSelectableProvider("claude-cli")).toBe(true);
    expect(isSelectableProvider("openai")).toBe(true);
    expect(isSelectableProvider("rm -rf")).toBe(false);
  });

  it.each(["sonnet", "opus[1m]", "claude-sonnet-5-5", "gpt-5.6-terra", "anthropic/claude-opus-5-5"])(
    "accepts the model id %s",
    (id) => expect(isValidCliModelId(id)).toBe(true)
  );

  it.each(["", "-p", "--dangerously-skip-permissions", "sonnet --print", "a\nb", "x".repeat(201)])(
    "rejects the model id %j so it can never become a CLI flag",
    (id) => expect(isValidCliModelId(id)).toBe(false)
  );
});

describe("CLI output parsing", () => {
  it("reads the model aliases Claude Code documents in its own help", () => {
    expect(parseClaudeModelAliases(CLAUDE_HELP)).toEqual(["fable", "opus", "sonnet"]);
  });

  it("claims no aliases when the help text does not document any", () => {
    expect(parseClaudeModelAliases("Usage: claude\n  --model <model>  Model to use\n")).toEqual([]);
  });

  it("keeps only readiness fields from Claude Code auth status, never identity", () => {
    const auth = parseClaudeAuthStatus(CLAUDE_AUTH);
    expect(auth).toEqual({ state: "ready", detail: "claude.ai · max" });
    expect(JSON.stringify(auth)).not.toContain("example.com");
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false })).state).toBe("unauthenticated");
    expect(parseClaudeAuthStatus("not json").state).toBe("unknown");
  });

  it("lists only visible Codex catalog models, in the CLI's priority order", () => {
    expect(parseCodexModelCatalog(CODEX_CATALOG)).toEqual([
      { id: "gpt-6-astra", label: "GPT-6-Astra", source: "catalog" },
      { id: "gpt-6-sol", label: "GPT-6-Sol", source: "catalog" },
    ]);
    expect(parseCodexModelCatalog("garbage")).toEqual([]);
  });

  it("maps Codex login status to readiness", () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT\n", 0)).toEqual({
      state: "ready",
      detail: "Logged in using ChatGPT",
    });
    expect(parseCodexLoginStatus("Not logged in\n", 1).state).toBe("unauthenticated");
  });
});

describe("discoverCliProviders", () => {
  it("reports installed, signed-in CLIs with their discoverable models", async () => {
    const runner = fakeRunner();
    const result = await discoverCliProviders({ runner });
    const claude = result.find((cli) => cli.provider === "claude-cli");
    const codex = result.find((cli) => cli.provider === "codex-cli");

    expect(claude).toMatchObject({
      enabled: true,
      installed: true,
      version: "2.1.291 (Claude Code)",
      auth: { state: "ready" },
      selectable: true,
    });
    expect(claude?.models.map((model) => model.id)).toEqual(["fable", "opus", "sonnet"]);
    expect(claude?.models.every((model) => model.source === "alias")).toBe(true);
    expect(codex).toMatchObject({ installed: true, auth: { state: "ready" }, selectable: true });
    expect(codex?.models.map((model) => model.id)).toEqual(["gpt-6-astra", "gpt-6-sol"]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("a5d9c8b5");
  });

  it("offers no models for a CLI that is not installed", async () => {
    const runner = fakeRunner({
      "codex --version": { missing: true },
      "codex debug models": { missing: true },
      "codex login status": { missing: true },
    });
    const codex = (await discoverCliProviders({ runner })).find((cli) => cli.provider === "codex-cli");
    expect(codex).toMatchObject({ installed: false, selectable: false, models: [] });
    expect(codex?.problem).toMatch(/not installed/i);
  });

  it("stays selectable but flags a CLI that is installed and signed out", async () => {
    const runner = fakeRunner({ "claude auth status --json": { stdout: '{"loggedIn":false}', code: 1 } });
    const claude = (await discoverCliProviders({ runner })).find((cli) => cli.provider === "claude-cli");
    expect(claude).toMatchObject({ installed: true, selectable: true, auth: { state: "unauthenticated" } });
    expect(claude?.problem).toMatch(/claude auth login/);
  });

  it("does not run any binary when CLI providers are switched off", async () => {
    process.env[CLI_PROVIDERS_ENV] = "off";
    const runner = fakeRunner();
    const result = await discoverCliProviders({ runner });
    expect(runner).not.toHaveBeenCalled();
    expect(result.every((cli) => !cli.enabled && !cli.selectable && cli.models.length === 0)).toBe(true);
  });

  it("caches discovery and re-runs it on refresh", async () => {
    const runner = fakeRunner();
    await discoverCliProviders({ runner });
    const callsAfterFirst = vi.mocked(runner).mock.calls.length;
    await discoverCliProviders({ runner });
    expect(vi.mocked(runner).mock.calls.length).toBe(callsAfterFirst);
    await discoverCliProviders({ runner, refresh: true });
    expect(vi.mocked(runner).mock.calls.length).toBe(callsAfterFirst * 2);
  });

  it("uses the operator-configured binary paths", async () => {
    process.env.AI_SETTER_CLAUDE_BIN = "/opt/homebrew/bin/claude";
    const runner = fakeRunner();
    await discoverCliProviders({ runner });
    expect(runner).toHaveBeenCalledWith("/opt/homebrew/bin/claude", ["--version"], expect.any(Object));
  });
});

describe("CLI runtime", () => {
  it("resolves a CLI selection without any saved key or encryption key", async () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    const target = await resolveLlmTarget({ workspaceId: "ws_1", provider: "claude-cli", model: "opus" });
    expect(target).toEqual({ kind: "cli", provider: "claude-cli", model: "opus" });
    expect(mocks.prisma.aiProviderCredential.findUnique).not.toHaveBeenCalled();
  });

  it("uses the CLI's own default model when none is chosen", async () => {
    const target = await resolveLlmTarget({ workspaceId: "ws_1", provider: "codex-cli", model: null });
    expect(target).toEqual({ kind: "cli", provider: "codex-cli", model: null });
  });

  it("fails closed on a model id that could inject CLI flags", async () => {
    await expect(
      resolveLlmTarget({ workspaceId: "ws_1", provider: "claude-cli", model: "--dangerously-skip-permissions" })
    ).rejects.toBeInstanceOf(LlmConfigurationError);
  });

  it("fails closed when CLI providers are switched off", async () => {
    process.env[CLI_PROVIDERS_ENV] = "off";
    await expect(
      resolveLlmTarget({ workspaceId: "ws_1", provider: "claude-cli", model: "sonnet" })
    ).rejects.toBeInstanceOf(LlmConfigurationError);
  });

  it("builds argument lists that only pass --model when a model is chosen", () => {
    expect(buildClaudeCliArgs("PROMPT", "opus")).toEqual([
      "--strict-mcp-config", "--setting-sources", "", "--model", "opus", "-p", "PROMPT",
    ]);
    expect(buildClaudeCliArgs("PROMPT", null)).not.toContain("--model");
    expect(buildCodexCliArgs("PROMPT", "gpt-6-sol")).toEqual([
      "exec", "--sandbox", "read-only", "--model", "gpt-6-sol", "PROMPT",
    ]);
    expect(buildCodexCliArgs("PROMPT", null)).toEqual(["exec", "--sandbox", "read-only", "PROMPT"]);
  });

  it("routes a CLI target through the local binary with system and user prompt combined", async () => {
    process.env.AI_SETTER_CODEX_BIN = "/usr/local/bin/codex";
    mocks.execFile.mockImplementation((_bin, _args, _opts, callback) =>
      callback(null, { stdout: '{"reply":"hey"}', stderr: "" })
    );
    const output = await completeSetterPrompt("SYSTEM", "USER", {
      kind: "cli",
      provider: "codex-cli",
      model: "gpt-6-sol",
    });
    expect(output).toBe('{"reply":"hey"}');
    const [bin, args] = mocks.execFile.mock.calls[0];
    expect(bin).toBe("/usr/local/bin/codex");
    expect(args).toEqual(["exec", "--sandbox", "read-only", "--model", "gpt-6-sol", "SYSTEM\n\nUSER"]);
  });

  it("describes the env CLI default without pretending it is a fixed model", () => {
    process.env.AI_SETTER_PROVIDER = "codex-cli";
    delete process.env.AI_SETTER_MODEL;
    expect(describeEnvLlmFallback()).toMatchObject({ provider: "codex-cli", kind: "cli", model: "" });
  });
});

describe("describeCliReadiness", () => {
  it("labels each readiness state honestly", async () => {
    const [claude, codex] = await discoverCliProviders({
      runner: fakeRunner({
        "codex --version": { missing: true },
        "codex debug models": { missing: true },
        "codex login status": { missing: true },
      }),
    });
    expect(describeCliReadiness(claude)).toEqual({ tone: "success", label: "Ready" });
    expect(describeCliReadiness(codex)).toEqual({ tone: "error", label: "Not installed" });
    expect(describeCliReadiness({ ...claude, auth: { state: "unauthenticated", detail: null } }).label).toBe(
      "Not signed in"
    );
    expect(describeCliReadiness({ ...claude, enabled: false }).label).toBe("Switched off");
  });
});

describe("CLI selection across setter features", () => {
  beforeEach(() => {
    process.env.AI_SETTER_CLAUDE_BIN = "/opt/homebrew/bin/claude";
    // The env default is an API provider: a CLI selection must win over it.
    process.env.AI_SETTER_PROVIDER = "anthropic";
  });

  it("personalizes campaign openers through the selected CLI", async () => {
    mocks.execFile.mockImplementation((_bin, _args, _opts, callback) =>
      callback(null, { stdout: "hey, here you go: {link}", stderr: "" })
    );
    const opener = await personalizeCampaignOpener({
      baseMessage: "Here is the guide: {link}",
      commentText: "guide pls",
      llmSelection: { workspaceId: "ws_1", provider: "claude-cli", model: "sonnet" },
    });
    expect(opener).toBe("hey, here you go: {link}");
    const [bin, args] = mocks.execFile.mock.calls[0];
    expect(bin).toBe("/opt/homebrew/bin/claude");
    expect(args).toEqual(expect.arrayContaining(["--model", "sonnet", "-p"]));
  });

  it("drafts window nudges through the selected CLI using its default model", async () => {
    mocks.execFile.mockImplementation((_bin, _args, _opts, callback) =>
      callback(null, {
        stdout: JSON.stringify({ reply: "noch interesse?", confidence: 0.9, shouldSend: true, needsReview: false, reasons: [] }),
        stderr: "",
      })
    );
    await generateWindowNudge({
      history: [],
      humanStyleAnchor: [],
      quietHours: 20,
      config: {
        knowledgeEnabled: false,
        styleExamplesEnabled: false,
        minConfidence: 0.8,
        llmSelection: { workspaceId: "ws_1", provider: "claude-cli", model: null },
      },
    });
    const [bin, args] = mocks.execFile.mock.calls[0];
    expect(bin).toBe("/opt/homebrew/bin/claude");
    expect(args).not.toContain("--model");
  });
});
