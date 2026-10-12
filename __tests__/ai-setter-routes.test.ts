/**
 * AI Setter API Routes - Authorization and Secret-Handling Tests
 *
 * The provider route is admin-only, never echoes a key back, and fails
 * closed without the encryption key. Corrections and corpus routes stay
 * scoped to the caller's workspace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  getWorkspaceInstagramAccount: vi.fn(),
  listProviderStatuses: vi.fn(),
  saveProviderCredential: vi.fn(),
  deleteProviderCredential: vi.fn(),
  rebuildStyleCorpus: vi.fn(),
  getStyleCorpusStatus: vi.fn(),
  discoverCliProviders: vi.fn(),
  prisma: {
    aiSetterConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    aiProviderCredential: { findUnique: vi.fn() },
    dmConversation: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    voiceCorrection: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/instagram-accounts", () => ({
  getWorkspaceInstagramAccount: mocks.getWorkspaceInstagramAccount,
}));
vi.mock("@/lib/ai-setter/providers/credentials", () => ({
  listProviderStatuses: mocks.listProviderStatuses,
  saveProviderCredential: mocks.saveProviderCredential,
  deleteProviderCredential: mocks.deleteProviderCredential,
}));
vi.mock("@/lib/ai-setter/style-corpus", () => ({
  rebuildStyleCorpus: mocks.rebuildStyleCorpus,
  getStyleCorpusStatus: mocks.getStyleCorpusStatus,
}));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ai-setter/providers/cli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-setter/providers/cli")>()),
  discoverCliProviders: mocks.discoverCliProviders,
}));

import * as providersRoute from "../app/api/ai-setter/providers/route";
import * as correctionsRoute from "../app/api/ai-setter/corrections/route";
import * as corpusRoute from "../app/api/ai-setter/style-corpus/route";
import * as configRoute from "../app/api/ai-setter/config/route";
import * as conversationsRoute from "../app/api/ai-setter/conversations/route";
import { CREDENTIALS_KEY_ENV } from "../lib/ai-setter/providers/credential-crypto";

const SECRET = "sk-proj-THISMUSTNEVERLEAVE0987654321";

const CLI_STATUSES = [
  {
    provider: "claude-cli",
    label: "Claude Code (local CLI)",
    enabled: true,
    installed: true,
    version: "2.1.291 (Claude Code)",
    auth: { state: "ready", detail: "claude.ai · max" },
    selectable: true,
    problem: null,
    models: [{ id: "sonnet", label: "sonnet", source: "alias" }],
    checkedAt: "2026-10-06T10:00:00.000Z",
  },
  {
    provider: "codex-cli",
    label: "Codex (local CLI)",
    enabled: true,
    installed: false,
    version: null,
    auth: { state: "unknown", detail: null },
    selectable: false,
    problem: "Codex CLI is not installed on this server.",
    models: [],
    checkedAt: "2026-10-06T10:00:00.000Z",
  },
];

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = { ...process.env };
  process.env[CREDENTIALS_KEY_ENV] = "b".repeat(64);
  mocks.getCurrentWorkspaceContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: "ws_1",
    role: "OWNER",
  });
  mocks.getWorkspaceInstagramAccount.mockResolvedValue({ id: "acc_1", workspaceId: "ws_1" });
  mocks.listProviderStatuses.mockResolvedValue([]);
  mocks.discoverCliProviders.mockResolvedValue(CLI_STATUSES);
});

afterEach(() => {
  process.env = savedEnv;
});

describe("/api/ai-setter/providers", () => {
  it("rejects anonymous callers", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue(null);
    const response = await providersRoute.GET();
    expect(response.status).toBe(401);
  });

  it("reports encryption readiness and env fallback without secrets", async () => {
    process.env.ANTHROPIC_API_KEY = SECRET;
    const response = await providersRoute.GET();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text);
    expect(body.data.encryption.ready).toBe(true);
    expect(body.data.envFallback.hasKey).toBe(true);
    expect(body.data.canManage).toBe(true);
  });

  it("forbids members from saving keys", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    const response = await providersRoute.PUT(
      jsonRequest("/api/ai-setter/providers", "PUT", { provider: "openai", apiKey: SECRET })
    );
    expect(response.status).toBe(403);
    expect(mocks.saveProviderCredential).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the encryption key is missing", async () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    const response = await providersRoute.PUT(
      jsonRequest("/api/ai-setter/providers", "PUT", { provider: "openai", apiKey: SECRET })
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain(CREDENTIALS_KEY_ENV);
    expect(text).not.toContain(SECRET);
    expect(mocks.saveProviderCredential).not.toHaveBeenCalled();
  });

  it("saves and responds with the public view only", async () => {
    mocks.saveProviderCredential.mockResolvedValue({
      provider: "openai",
      configured: true,
      keyFingerprint: "0123456789ab",
    });
    const response = await providersRoute.PUT(
      jsonRequest("/api/ai-setter/providers", "PUT", {
        provider: "openai",
        apiKey: SECRET,
        defaultModel: "gpt-5-codex",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(SECRET);
    expect(mocks.saveProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", provider: "openai", apiKey: SECRET })
    );
  });

  it("rejects unknown providers", async () => {
    const response = await providersRoute.PUT(
      jsonRequest("/api/ai-setter/providers", "PUT", { provider: "evil", apiKey: SECRET })
    );
    expect(response.status).toBe(400);
  });

  it("lists local CLI providers with readiness and discovered models", async () => {
    const response = await providersRoute.GET(jsonRequest("/api/ai-setter/providers", "GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.cli).toEqual(CLI_STATUSES);
    expect(mocks.discoverCliProviders).toHaveBeenCalledWith({ refresh: false });
  });

  it("re-runs CLI discovery on an explicit refresh", async () => {
    await providersRoute.GET(jsonRequest("/api/ai-setter/providers?refresh=1", "GET"));
    expect(mocks.discoverCliProviders).toHaveBeenCalledWith({ refresh: true });
  });

  it("never offers a CLI as a key-backed provider", async () => {
    const response = await providersRoute.PUT(
      jsonRequest("/api/ai-setter/providers", "PUT", { provider: "claude-cli", apiKey: SECRET })
    );
    expect(response.status).toBe(400);
    expect(mocks.saveProviderCredential).not.toHaveBeenCalled();
  });
});

describe("/api/ai-setter/corrections", () => {
  it("refuses a correction for a conversation outside the workspace", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(null);
    const response = await correctionsRoute.POST(
      jsonRequest("/api/ai-setter/corrections", "POST", {
        instagramAccountId: "acc_1",
        participantId: "p_other",
        note: "immer englisch",
      })
    );
    expect(response.status).toBe(404);
    expect(mocks.prisma.voiceCorrection.create).not.toHaveBeenCalled();
  });

  it("requires some correction content", async () => {
    const response = await correctionsRoute.POST(
      jsonRequest("/api/ai-setter/corrections", "POST", {
        instagramAccountId: "acc_1",
        participantId: "p1",
      })
    );
    expect(response.status).toBe(400);
  });

  it("stores a manual contact-scoped correction", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue({ id: "conv_1" });
    mocks.prisma.voiceCorrection.create.mockResolvedValue({ id: "vc_1" });
    const response = await correctionsRoute.POST(
      jsonRequest("/api/ai-setter/corrections", "POST", {
        instagramAccountId: "acc_1",
        participantId: "p1",
        avoidText: "Hallo!",
        preferText: "yo",
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.voiceCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instagramAccountId: "acc_1",
        conversationId: "conv_1",
        kind: "MANUAL",
        avoidText: "Hallo!",
        preferText: "yo",
      }),
    });
  });

  it("deletes only within the selected account", async () => {
    mocks.prisma.voiceCorrection.deleteMany.mockResolvedValue({ count: 1 });
    const response = await correctionsRoute.DELETE(
      jsonRequest("/api/ai-setter/corrections?instagramAccountId=acc_1&id=vc_1", "DELETE")
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.voiceCorrection.deleteMany).toHaveBeenCalledWith({
      where: { id: "vc_1", instagramAccountId: "acc_1" },
    });
  });
});

describe("/api/ai-setter/style-corpus", () => {
  const summary = { previousEntryCount: 9, entryCount: 12, scannedMessages: 300, durationMs: 40 };

  it("rebuilds from mirrored messages for the caller's account and reports what it did", async () => {
    mocks.rebuildStyleCorpus.mockResolvedValue({ status: { entryCount: 12 }, summary });
    const response = await corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_1" })
    );
    expect(response.status).toBe(200);
    expect(mocks.rebuildStyleCorpus).toHaveBeenCalledWith("acc_1");
    const body = await response.json();
    expect(body.data).toEqual({ status: { entryCount: 12, rebuilding: false }, summary });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses an account outside the caller's workspace", async () => {
    mocks.getWorkspaceInstagramAccount.mockResolvedValue(null);
    const response = await corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_other" })
    );
    expect(response.status).toBe(400);
    expect(mocks.rebuildStyleCorpus).not.toHaveBeenCalled();
  });

  it("answers a concurrent click with a machine-readable in-progress code and reports it on GET", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.rebuildStyleCorpus.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mocks.getStyleCorpusStatus.mockResolvedValue({ entryCount: 0 });

    const first = corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_1" })
    );
    await vi.waitFor(() => expect(mocks.rebuildStyleCorpus).toHaveBeenCalled());

    const second = await corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_1" })
    );
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("rebuild_in_progress");

    const during = await corpusRoute.GET(
      jsonRequest("/api/ai-setter/style-corpus?instagramAccountId=acc_1", "GET")
    );
    expect((await during.json()).data.status.rebuilding).toBe(true);

    finish({ status: { entryCount: 3 }, summary });
    expect((await first).status).toBe(200);

    const after = await corpusRoute.GET(
      jsonRequest("/api/ai-setter/style-corpus?instagramAccountId=acc_1", "GET")
    );
    expect((await after.json()).data.status.rebuilding).toBe(false);
  });

  it("returns a JSON error with a code and frees the lock when the rebuild fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rebuildStyleCorpus.mockRejectedValueOnce(new Error("db down"));
    const failed = await corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_1" })
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ success: false, code: "rebuild_failed" });

    mocks.rebuildStyleCorpus.mockResolvedValueOnce({ status: { entryCount: 1 }, summary });
    const retry = await corpusRoute.POST(
      jsonRequest("/api/ai-setter/style-corpus", "POST", { instagramAccountId: "acc_1" })
    );
    expect(retry.status).toBe(200);
    consoleError.mockRestore();
  });
});

describe("/api/ai-setter/config provider selection", () => {
  const basePayload = {
    instagramAccountId: "acc_1",
    mode: "DRAFT",
    knowledgeEnabled: true,
    styleExamplesEnabled: true,
    minConfidence: 0.8,
    replyDelaySeconds: 10,
    pauseOnHumanReply: true,
    windowNudgeEnabled: false,
    windowNudgeHours: 20,
    blockedUserIds: [],
  };

  beforeEach(() => {
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue({
      ...basePayload,
      strictVoiceEvidence: false,
      llmProvider: null,
      llmModel: null,
    });
    mocks.prisma.aiSetterConfig.upsert.mockResolvedValue({ id: "cfg" });
    mocks.prisma.aiProviderCredential.findUnique.mockResolvedValue({ id: "cred" });
  });

  it("forbids members from switching the model provider", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "openai", llmModel: "gpt-5" })
    );
    expect(response.status).toBe(403);
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("lets members save other settings while the provider stays unchanged", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: null, llmModel: null })
    );
    expect(response.status).toBe(200);
  });

  it("rejects selecting a provider without a saved key", async () => {
    mocks.prisma.aiProviderCredential.findUnique.mockResolvedValue(null);
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "xai" })
    );
    expect(response.status).toBe(400);
  });

  it("lets admins select a local CLI provider without any saved key", async () => {
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "claude-cli", llmModel: "sonnet" })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.aiProviderCredential.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.aiSetterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ llmProvider: "claude-cli", llmModel: "sonnet" }),
      })
    );
  });

  it("accepts a custom CLI model id that discovery did not list", async () => {
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "claude-cli", llmModel: "claude-sonnet-5-5" })
    );
    expect(response.status).toBe(200);
  });

  it("rejects a CLI that is not installed on the server", async () => {
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "codex-cli", llmModel: null })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not installed/i);
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejects a CLI model id that could become a command-line flag", async () => {
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", {
        ...basePayload,
        llmProvider: "claude-cli",
        llmModel: "--dangerously-skip-permissions",
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("forbids members from switching to a CLI provider", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "claude-cli", llmModel: "opus" })
    );
    expect(response.status).toBe(403);
  });

  it("lets admins select a provider with a saved key", async () => {
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...basePayload, llmProvider: "openai", llmModel: "gpt-5-codex" })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.aiSetterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ llmProvider: "openai", llmModel: "gpt-5-codex" }),
      })
    );
  });
});

describe("/api/ai-setter/config operational settings", () => {
  const stored = {
    mode: "DRAFT",
    minConfidence: 0.8,
    replyDelaySeconds: 10,
    pauseOnHumanReply: true,
    windowNudgeEnabled: false,
    windowNudgeHours: 20,
    blockedUserIds: ["blocked_1"],
    strictVoiceEvidence: true,
    persona: "fitness coach",
    goal: null,
    bookingLink: null,
    voiceRules: null,
    knowledgeEnabled: true,
    llmProvider: null,
    llmModel: null,
  };
  const payload = {
    instagramAccountId: "acc_1",
    mode: "DRAFT",
    persona: "fitness coach",
    knowledgeEnabled: true,
    styleExamplesEnabled: true,
    minConfidence: 0.8,
    replyDelaySeconds: 10,
    pauseOnHumanReply: true,
    windowNudgeEnabled: false,
    windowNudgeHours: 20,
    blockedUserIds: ["blocked_1"],
    strictVoiceEvidence: true,
  };

  function asMember() {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
  }

  beforeEach(() => {
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue(stored);
    mocks.prisma.aiSetterConfig.upsert.mockResolvedValue({ id: "cfg" });
  });

  it.each([
    ["enabling auto-send", { mode: "AUTO" }],
    ["turning the setter off", { mode: "OFF" }],
    ["lowering the auto-send threshold", { minConfidence: 0.1 }],
    ["changing the reply delay", { replyDelaySeconds: 0 }],
    ["disabling the human-takeover pause", { pauseOnHumanReply: false }],
    ["enabling window nudges", { windowNudgeEnabled: true }],
    ["changing the nudge timing", { windowNudgeHours: 2 }],
    ["unblocking a contact", { blockedUserIds: [] }],
    ["dropping strict voice evidence", { strictVoiceEvidence: false }],
  ])("forbids members from %s", async (_label, change) => {
    asMember();
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...payload, ...change })
    );
    expect(response.status).toBe(403);
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("fails closed for members when no config exists and they try to enable auto-send", async () => {
    asMember();
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue(null);
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", {
        ...payload,
        mode: "AUTO",
        blockedUserIds: [],
        strictVoiceEvidence: false,
      })
    );
    expect(response.status).toBe(403);
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("lets members create a config that keeps the default operational settings", async () => {
    asMember();
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue(null);
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", {
        ...payload,
        persona: undefined,
        mode: "OFF",
        minConfidence: 0.78,
        blockedUserIds: [],
        strictVoiceEvidence: false,
      })
    );
    expect(response.status).toBe(200);
  });

  it("keeps members from changing what the setter says to prospects", async () => {
    asMember();
    for (const change of [
      { persona: "new persona" },
      { goal: "book calls" },
      { voiceRules: "klein schreiben" },
      { bookingLink: "https://cal.com/someone-else" },
      { knowledgeEnabled: false },
    ]) {
      const response = await configRoute.PUT(
        jsonRequest("/api/ai-setter/config", "PUT", { ...payload, ...change })
      );
      expect(response.status).toBe(403);
    }
    expect(mocks.prisma.aiSetterConfig.upsert).not.toHaveBeenCalled();
  });

  it("still lets members change settings that don't steer replies", async () => {
    asMember();
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...payload, styleCorpusEnabled: false })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.aiSetterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ persona: "fitness coach", mode: "DRAFT", minConfidence: 0.8 }),
      })
    );
  });

  it("accepts only https booking links", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "OWNER" });
    for (const bookingLink of ["javascript:alert(1)", "http://cal.com/x", "data:text/html,hi"]) {
      const response = await configRoute.PUT(jsonRequest("/api/ai-setter/config", "PUT", { ...payload, bookingLink }));
      expect(response.status).toBe(400);
    }
  });

  it("treats a reordered block list as unchanged", async () => {
    asMember();
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue({ ...stored, blockedUserIds: ["b", "a"] });
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", { ...payload, blockedUserIds: ["a", "b"] })
    );
    expect(response.status).toBe(200);
  });

  it("lets admins enable auto-send and tune operational settings", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "ADMIN" });
    const response = await configRoute.PUT(
      jsonRequest("/api/ai-setter/config", "PUT", {
        ...payload,
        mode: "AUTO",
        minConfidence: 0.6,
        windowNudgeEnabled: true,
        pauseOnHumanReply: false,
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.aiSetterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ mode: "AUTO", minConfidence: 0.6, windowNudgeEnabled: true }),
      })
    );
  });
});

describe("/api/ai-setter/conversations PATCH thread safety", () => {
  const TAKEOVER_AT = new Date("2026-10-06T09:00:00Z");
  const thread = {
    aiEnabled: true,
    modeOverride: null as "OFF" | "DRAFT" | "AUTO" | null,
    humanTakeoverAt: TAKEOVER_AT as Date | null,
  };

  function asRole(role: "OWNER" | "ADMIN" | "MEMBER") {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role });
  }

  function withState(accountMode: "OFF" | "DRAFT" | "AUTO" | null, stored: Partial<typeof thread> | null) {
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue(
      accountMode === null ? null : { mode: accountMode }
    );
    mocks.prisma.dmConversation.findUnique.mockResolvedValue(
      stored === null ? null : { ...thread, ...stored }
    );
  }

  function patch(body: Record<string, unknown>) {
    return conversationsRoute.PATCH(
      jsonRequest("/api/ai-setter/conversations", "PATCH", {
        instagramAccountId: "acc_1",
        participantId: "p1",
        ...body,
      })
    );
  }

  function upsertArgs() {
    return mocks.prisma.dmConversation.upsert.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    mocks.prisma.dmConversation.upsert.mockResolvedValue({ id: "conv_1" });
  });

  it("rejects anonymous callers", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue(null);
    const response = await patch({ modeOverride: "OFF" });
    expect(response.status).toBe(401);
    expect(mocks.prisma.dmConversation.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["pinning a thread to auto-send", "DRAFT", {}, { modeOverride: "AUTO", aiEnabled: true }],
    ["pinning auto-send even when the account already runs on auto", "AUTO", {}, { modeOverride: "AUTO" }],
    ["resetting a draft thread to an auto-send account default", "AUTO", { modeOverride: "DRAFT" }, { modeOverride: null, aiEnabled: true }],
    ["resetting a paused thread to an auto-send account default", "AUTO", { modeOverride: "OFF" }, { modeOverride: null }],
    ["re-enabling a killed thread that would auto-send", "AUTO", { aiEnabled: false }, { aiEnabled: true }],
  ] as const)("forbids members from %s", async (_label, accountMode, stored, body) => {
    asRole("MEMBER");
    withState(accountMode, stored);
    const response = await patch(body);
    expect(response.status).toBe(403);
    expect(mocks.prisma.dmConversation.upsert).not.toHaveBeenCalled();
  });

  it("forbids members from creating a new thread pinned to auto-send", async () => {
    asRole("MEMBER");
    withState("DRAFT", null);
    const response = await patch({ modeOverride: "AUTO" });
    expect(response.status).toBe(403);
    expect(mocks.prisma.dmConversation.upsert).not.toHaveBeenCalled();
  });

  it("never lets a member clear an active human takeover when resuming drafts", async () => {
    asRole("MEMBER");
    withState("AUTO", { modeOverride: "OFF" });
    const response = await patch({ modeOverride: "DRAFT", aiEnabled: true });
    expect(response.status).toBe(200);
    const args = upsertArgs();
    expect(args.update).toEqual({ aiEnabled: true, modeOverride: "DRAFT" });
    expect(args.update).not.toHaveProperty("humanTakeoverAt");
  });

  it("lets members pause a thread the way the inbox sends it (OFF plus aiEnabled)", async () => {
    asRole("MEMBER");
    withState("AUTO", {});
    const response = await patch({ modeOverride: "OFF", aiEnabled: true });
    expect(response.status).toBe(200);
    expect(upsertArgs().update).toEqual({ aiEnabled: true, modeOverride: "OFF" });
  });

  it("lets members kill the AI on a thread", async () => {
    asRole("MEMBER");
    withState("AUTO", {});
    const response = await patch({ aiEnabled: false });
    expect(response.status).toBe(200);
    expect(upsertArgs().update).toEqual({ aiEnabled: false });
  });

  it("lets members reset a thread to a non-auto account default", async () => {
    asRole("MEMBER");
    withState("DRAFT", { modeOverride: "OFF" });
    const response = await patch({ modeOverride: null, aiEnabled: true });
    expect(response.status).toBe(200);
    expect(upsertArgs().update).toEqual({ aiEnabled: true, modeOverride: null });
  });

  it("fails closed for members when the account has no config yet", async () => {
    asRole("MEMBER");
    withState(null, null);
    const response = await patch({ modeOverride: null, aiEnabled: true });
    expect(response.status).toBe(200);
    expect(upsertArgs().create).toEqual(
      expect.objectContaining({ aiEnabled: true, modeOverride: null })
    );
  });

  it("lets members re-save an unchanged auto thread without touching the takeover", async () => {
    asRole("MEMBER");
    withState("DRAFT", { modeOverride: "AUTO" });
    const response = await patch({ modeOverride: "AUTO", aiEnabled: true });
    expect(response.status).toBe(200);
    expect(upsertArgs().update).not.toHaveProperty("humanTakeoverAt");
  });

  it.each(["OWNER", "ADMIN"] as const)("lets %s pin auto-send and clear the takeover", async (role) => {
    asRole(role);
    withState("DRAFT", {});
    const response = await patch({ modeOverride: "AUTO", aiEnabled: true });
    expect(response.status).toBe(200);
    expect(upsertArgs().update).toEqual({
      aiEnabled: true,
      modeOverride: "AUTO",
      humanTakeoverAt: null,
    });
  });

  it("scopes the upsert to the caller's account", async () => {
    asRole("MEMBER");
    withState("DRAFT", {});
    await patch({ modeOverride: "OFF" });
    expect(upsertArgs().where).toEqual({
      instagramAccountId_participantId: { instagramAccountId: "acc_1", participantId: "p1" },
    });
  });
});
