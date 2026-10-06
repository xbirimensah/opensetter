/**
 * Sprachprofil "Rebuild from mirrored DMs" - reliability tests
 *
 * The rebuild must report what it actually did, never leave the card on
 * stale numbers, and recover the real outcome when the HTTP response is
 * lost (proxy timeout, phone backgrounded the tab, concurrent click).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    aiSetterConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    styleCorpusEntry: {
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    dmConversation: { count: vi.fn() },
    dmMessage: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  loadAgentFootprint: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ai-setter/agent-footprint", () => ({ loadAgentFootprint: mocks.loadAgentFootprint }));

import { getStyleCorpusStatus, rebuildStyleCorpus } from "../lib/ai-setter/style-corpus";
import {
  describeCorpusState,
  describeRebuildSuccess,
  rebuildCorpusWithRecovery,
  type CorpusStatusView,
} from "../lib/ai-setter/style-corpus-client";

const T0 = new Date("2026-10-06T10:00:00.000Z");
const T1 = new Date("2026-10-06T10:00:30.000Z");

function stubEmptyStatusQueries() {
  mocks.prisma.styleCorpusEntry.count.mockResolvedValue(0);
  mocks.prisma.styleCorpusEntry.groupBy.mockResolvedValue([]);
  mocks.prisma.styleCorpusEntry.aggregate.mockResolvedValue({ _min: { sentAt: null }, _max: { sentAt: null } });
  mocks.prisma.styleCorpusEntry.findMany.mockResolvedValue([]);
  mocks.prisma.dmConversation.count.mockResolvedValue(0);
  mocks.prisma.dmMessage.findFirst.mockResolvedValue(null);
  mocks.prisma.dmMessage.count.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubEmptyStatusQueries();
  mocks.loadAgentFootprint.mockResolvedValue({ mids: new Set(), texts: new Set() });
  mocks.prisma.$transaction.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getStyleCorpusStatus", () => {
  it("reports how much of the mirror there is to learn from", async () => {
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue({ styleCorpusBuiltAt: T0 });
    mocks.prisma.dmMessage.count
      .mockResolvedValueOnce(3) // new human messages since build
      .mockResolvedValueOnce(420) // all mirrored messages
      .mockResolvedValueOnce(57); // human-typed outbound messages
    const status = await getStyleCorpusStatus("acc_1");
    expect(status).toMatchObject({
      newHumanMessagesSinceBuild: 3,
      mirroredMessageCount: 420,
      humanMessageCount: 57,
      isStale: true,
    });
  });
});

describe("rebuildStyleCorpus", () => {
  it("stamps the build with the scan start so messages mirrored mid-scan count as new", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    mocks.prisma.dmMessage.findMany.mockImplementation(async () => {
      vi.setSystemTime(T1);
      return [];
    });
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue({ styleCorpusBuiltAt: T0 });

    await rebuildStyleCorpus("acc_1");

    expect(mocks.prisma.aiSetterConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { styleCorpusBuiltAt: T0 } })
    );
  });

  it("returns a summary of what the rebuild did next to the fresh status", async () => {
    mocks.prisma.styleCorpusEntry.count.mockResolvedValueOnce(579).mockResolvedValue(0);
    mocks.prisma.dmMessage.findMany.mockResolvedValue([]);
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue({ styleCorpusBuiltAt: T0 });

    const outcome = await rebuildStyleCorpus("acc_1");

    expect(outcome.summary).toMatchObject({
      previousEntryCount: 579,
      entryCount: 0,
      scannedMessages: 0,
    });
    expect(outcome.summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.status.entryCount).toBe(0);
  });

  it("only reads the mirror of the requested account", async () => {
    mocks.prisma.dmMessage.findMany.mockResolvedValue([]);
    mocks.prisma.aiSetterConfig.findUnique.mockResolvedValue(null);
    await rebuildStyleCorpus("acc_1");
    expect(mocks.prisma.dmMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversation: { instagramAccountId: "acc_1" } } })
    );
    expect(mocks.prisma.styleCorpusEntry.deleteMany).toHaveBeenCalledWith({
      where: { instagramAccountId: "acc_1" },
    });
  });
});

// ─── client helper ──────────────────────────────────────────────────────────

function status(overrides: Partial<CorpusStatusView> = {}): CorpusStatusView {
  return {
    entryCount: 12,
    conversationCount: 4,
    mirroredConversations: 5,
    mirroredMessageCount: 300,
    humanMessageCount: 40,
    coveragePercent: 80,
    languages: { de: 12 },
    oldestMessageAt: "2026-09-01T00:00:00.000Z",
    newestMessageAt: "2026-10-05T00:00:00.000Z",
    builtAt: "2026-10-06T10:00:00.000Z",
    lastMirroredAt: "2026-10-06T09:00:00.000Z",
    newHumanMessagesSinceBuild: 0,
    isStale: false,
    rebuilding: false,
    samples: [],
    ...overrides,
  };
}

function json(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PREVIOUS_BUILT_AT = "2026-10-06T09:00:00.000Z";
const noSleep = () => Promise.resolve();

describe("rebuildCorpusWithRecovery", () => {
  it("returns the server's summary on a normal success", async () => {
    const fresh = status();
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      json({ success: true, data: { status: fresh, summary: { entryCount: 12, previousEntryCount: 9 } } })
    );
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "success", recovered: false, status: fresh });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/ai-setter/style-corpus");
    expect(JSON.parse(init.body)).toEqual({ instagramAccountId: "acc_1" });
  });

  it("recovers a success the proxy hid behind an HTML timeout page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>524 timeout</html>", { status: 524, headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(json({ success: true, data: { status: status() } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "success", recovered: true });
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/ai-setter/style-corpus?instagramAccountId=acc_1");
  });

  it("keeps polling while the server still reports the rebuild as running", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ success: true, data: { status: status({ builtAt: PREVIOUS_BUILT_AT, rebuilding: true }) } }))
      .mockResolvedValueOnce(json({ success: true, data: { status: status() } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "success", recovered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("waits for a rebuild that is already running instead of reporting a failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, code: "rebuild_in_progress", error: "busy" }, { status: 409 }))
      .mockResolvedValueOnce(json({ success: true, data: { status: status() } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "success", recovered: true });
  });

  it("reports a real server error and still refreshes the status", async () => {
    const latest = status({ builtAt: PREVIOUS_BUILT_AT });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, error: "Rebuilding the style corpus failed" }, { status: 500 }))
      .mockResolvedValueOnce(json({ success: true, data: { status: latest } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, { fetchImpl, sleep: noSleep });
    expect(outcome).toEqual({
      kind: "error",
      message: "Rebuilding the style corpus failed",
      status: latest,
    });
  });

  it("gives up with an honest message when the outcome stays unknown", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValue(json({ success: true, data: { status: status({ builtAt: PREVIOUS_BUILT_AT, rebuilding: true }) } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", PREVIOUS_BUILT_AT, {
      fetchImpl,
      sleep: noSleep,
      maxPolls: 3,
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/still running/i);
      expect(outcome.status?.rebuilding).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("treats the first ever build as done once any build time appears", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(json({ success: true, data: { status: status() } }));
    const outcome = await rebuildCorpusWithRecovery("acc_1", null, { fetchImpl, sleep: noSleep });
    expect(outcome).toMatchObject({ kind: "success", recovered: true });
  });
});

describe("describeCorpusState", () => {
  it("flags an empty mirror instead of claiming the corpus is up to date", () => {
    const view = describeCorpusState(
      status({ entryCount: 0, conversationCount: 0, mirroredConversations: 0, mirroredMessageCount: 0, humanMessageCount: 0 })
    );
    expect(view.badge).toEqual({ tone: "warning", label: "No mirrored DMs" });
    expect(view.hint).toMatch(/no DMs are mirrored/i);
  });

  it("explains a build with mirrored chats but no hand-typed replies", () => {
    const view = describeCorpusState(status({ entryCount: 0, humanMessageCount: 0 }));
    expect(view.badge.label).toBe("No examples");
    expect(view.hint).toMatch(/hand-typed/i);
  });

  it("shows new messages since the last rebuild", () => {
    expect(describeCorpusState(status({ isStale: true, newHumanMessagesSinceBuild: 4 })).badge).toEqual({
      tone: "warning",
      label: "4 new since rebuild",
    });
  });

  it("calls a fresh, non-empty corpus up to date", () => {
    expect(describeCorpusState(status()).badge).toEqual({ tone: "success", label: "Up to date" });
  });

  it("shows a running rebuild", () => {
    expect(describeCorpusState(status({ rebuilding: true })).badge.label).toBe("Rebuilding…");
  });

  it("says when the corpus was never built", () => {
    expect(describeCorpusState(status({ builtAt: null, isStale: true })).badge.label).toBe("Not built yet");
  });
});

describe("describeRebuildSuccess", () => {
  it("reports before/after counts from the server summary", () => {
    expect(
      describeRebuildSuccess({
        kind: "success",
        recovered: false,
        status: status(),
        summary: { previousEntryCount: 579, entryCount: 0, scannedMessages: 0, durationMs: 12 },
      })
    ).toBe("Rebuilt: 0 examples (was 579) from 0 mirrored messages.");
  });

  it("falls back to the refreshed status when the response was recovered", () => {
    expect(
      describeRebuildSuccess({ kind: "success", recovered: true, status: status({ entryCount: 1 }), summary: null })
    ).toBe("Rebuild finished on the server: 1 example from 4 chats.");
  });
});
