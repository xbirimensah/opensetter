/**
 * AI Setter Worker - Behavioral Tests
 *
 * Runs message events through processInboundDm with the database, draft
 * generation, and send path mocked, asserting the gate chain and the
 * draft/auto-send decisions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { ProcessInboundDmJob } from "../lib/queue/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    instagramAccount: { findUnique: vi.fn() },
    dmConversation: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    dmMessage: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    aiReplyLog: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  generateSetterDraft: vi.fn(),
  generateWindowNudge: vi.fn(),
  sendAiReply: vi.fn(),
  scheduleWindowNudge: vi.fn().mockResolvedValue(undefined),
  loadVoiceContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ai-setter/generate", () => ({
  generateSetterDraft: mocks.generateSetterDraft,
  generateWindowNudge: mocks.generateWindowNudge,
}));
vi.mock("@/lib/ai-setter/voice-context", () => ({
  loadVoiceContext: mocks.loadVoiceContext,
}));
vi.mock("@/lib/ai-setter/send", () => ({
  sendAiReply: mocks.sendAiReply,
  scheduleWindowNudge: mocks.scheduleWindowNudge,
}));

import { processInboundDm } from "../lib/queue/ai-setter-worker";
import { Prisma } from "@/app/generated/prisma/client";

const BASE_CONFIG = {
  id: "cfg_1",
  instagramAccountId: "acc_1",
  mode: "AUTO",
  persona: "coach",
  goal: "book calls",
  bookingLink: "https://cal.com/x",
  language: null,
  knowledgeEnabled: true,
  styleExamplesEnabled: true,
  minConfidence: 0.78,
  replyDelaySeconds: 10,
  pauseOnHumanReply: true,
  blockedUserIds: [],
};

const BASE_ACCOUNT = {
  id: "acc_1",
  instagramId: "17840001",
  workspaceId: "ws_1",
  accessToken: "encrypted",
  aiSetterConfig: BASE_CONFIG,
};

const BASE_CONVERSATION = {
  id: "conv_1",
  instagramAccountId: "acc_1",
  participantId: "9001",
  participantUsername: null,
  aiEnabled: true,
  humanTakeoverAt: null,
  lastInboundAt: null,
  lastOutboundAt: null,
};

function makeJob(
  overrides: Partial<ProcessInboundDmJob> = {}
): Job<ProcessInboundDmJob> {
  return {
    data: {
      instagramAccountId: "17840001",
      participantId: "9001",
      mid: "mid_1",
      text: "wie funktioniert dein coaching?",
      isEcho: false,
      timestamp: Date.now(),
      ...overrides,
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as unknown as Job<ProcessInboundDmJob>;
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "7.8.0",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.instagramAccount.findUnique.mockResolvedValue(BASE_ACCOUNT);
  mocks.prisma.dmConversation.upsert.mockResolvedValue(BASE_CONVERSATION);
  mocks.prisma.dmConversation.update.mockResolvedValue(BASE_CONVERSATION);
  mocks.prisma.dmMessage.create.mockResolvedValue({ id: "msg_1" });
  mocks.prisma.dmMessage.findMany.mockResolvedValue([]);
  mocks.prisma.dmMessage.findFirst.mockResolvedValue(null);
  mocks.prisma.aiReplyLog.findUnique.mockResolvedValue(null);
  mocks.prisma.aiReplyLog.create.mockResolvedValue({ id: "log_1" });
  mocks.prisma.aiReplyLog.update.mockResolvedValue({ id: "log_1" });
  mocks.generateSetterDraft.mockResolvedValue({
    reply: "klar, was machst du aktuell?",
    confidence: 0.9,
    shouldSend: true,
    needsReview: false,
    reasons: [],
  });
  mocks.generateWindowNudge.mockResolvedValue({
    reply: "hey, bist du noch dran?",
    confidence: 0.9,
    shouldSend: true,
    needsReview: false,
    reasons: [],
  });
  mocks.sendAiReply.mockResolvedValue({ ok: true });
  mocks.loadVoiceContext.mockResolvedValue({
    humanStyleAnchor: ["ja easy, was machst du so"],
    recentAiReplies: [],
    voiceCorrections: [],
    corpusEntryCount: 25,
  });
});

describe("processInboundDm", () => {
  it("should mirror the message and auto-send a confident reply in AUTO mode", async () => {
    await processInboundDm(makeJob());

    expect(mocks.prisma.dmMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mid: "mid_1",
          direction: "IN",
          source: "PARTICIPANT",
        }),
      })
    );
    expect(mocks.generateSetterDraft).toHaveBeenCalledOnce();
    expect(mocks.sendAiReply).toHaveBeenCalledWith({ replyLogId: "log_1" });
  });

  it("should store the message but never draft when the setter is off", async () => {
    mocks.prisma.instagramAccount.findUnique.mockResolvedValue({
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, mode: "OFF" },
    });

    await processInboundDm(makeJob());

    expect(mocks.prisma.dmMessage.create).toHaveBeenCalledOnce();
    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should do nothing more when the message was already processed", async () => {
    mocks.prisma.dmMessage.create.mockRejectedValue(uniqueViolation());

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should hold every reply in DRAFT mode instead of sending", async () => {
    mocks.prisma.instagramAccount.findUnique.mockResolvedValue({
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, mode: "DRAFT" },
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD" }),
      })
    );
  });

  it("should hold a low-confidence reply in AUTO mode", async () => {
    mocks.generateSetterDraft.mockResolvedValue({
      reply: "hmm not sure",
      confidence: 0.4,
      shouldSend: true,
      needsReview: false,
      reasons: [],
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "HELD",
          reasons: expect.arrayContaining([
            "confidence below minimum threshold",
          ]),
        }),
      })
    );
  });

  it("should skip trivial acknowledgements without drafting", async () => {
    await processInboundDm(makeJob({ text: "danke!" }));

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED" }),
      })
    );
  });

  it("should skip when a newer inbound message superseded this one", async () => {
    mocks.prisma.dmMessage.findFirst.mockResolvedValue({ id: "msg_newer" });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          reasons: ["superseded by a newer message"],
        }),
      })
    );
  });

  it("should not reply to blocked users", async () => {
    mocks.prisma.instagramAccount.findUnique.mockResolvedValue({
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, blockedUserIds: ["9001"] },
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
  });

  it("should not reply while the thread's AI toggle is off", async () => {
    mocks.prisma.dmConversation.upsert.mockResolvedValue({
      ...BASE_CONVERSATION,
      aiEnabled: false,
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
  });

  it("should pause while a human recently took over the thread", async () => {
    mocks.prisma.dmConversation.upsert.mockResolvedValue({
      ...BASE_CONVERSATION,
      humanTakeoverAt: new Date(Date.now() - 60_000),
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED" }),
      })
    );
  });

  it("should record a human echo and mark the takeover", async () => {
    await processInboundDm(makeJob({ isEcho: true, mid: "mid_echo" }));

    expect(mocks.prisma.dmMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "OUT",
          source: "HUMAN",
        }),
      })
    );
    expect(mocks.prisma.dmConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanTakeoverAt: expect.any(Date),
        }),
      })
    );
    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
  });

  it("should ignore echoes of our own API sends", async () => {
    mocks.prisma.dmMessage.create.mockRejectedValue(uniqueViolation());

    await processInboundDm(makeJob({ isEcho: true, mid: "mid_ours" }));

    expect(mocks.prisma.dmConversation.update).not.toHaveBeenCalled();
  });

  it("should resume a crashed PENDING draft instead of regenerating", async () => {
    mocks.prisma.aiReplyLog.findUnique.mockResolvedValue({
      id: "log_existing",
      status: "PENDING",
      draftText: "alte antwort",
      confidence: 0.9,
      shouldSend: true,
      needsReview: false,
      reasons: [],
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.sendAiReply).toHaveBeenCalledWith({
      replyLogId: "log_existing",
    });
  });

  it("should hold instead of throwing when the rate limit blocks the send", async () => {
    mocks.sendAiReply.mockResolvedValue({
      ok: false,
      error: "rate_limit",
      message: "Hourly Instagram DM rate limit reached",
    });

    await processInboundDm(makeJob());

    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD" }),
      })
    );
  });
});

import { processWindowNudge } from "../lib/queue/ai-setter-worker";
import type { ProcessWindowNudgeJob } from "../lib/queue/client";

const NUDGE_ANCHOR = Date.now() - 20 * 60 * 60 * 1000;

function makeNudgeJob(): Job<ProcessWindowNudgeJob> {
  return {
    data: { conversationId: "conv_1", windowAnchorTs: NUDGE_ANCHOR },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as unknown as Job<ProcessWindowNudgeJob>;
}

function nudgeConversation(overrides: Record<string, unknown> = {}) {
  return {
    ...BASE_CONVERSATION,
    lastInboundAt: new Date(NUDGE_ANCHOR),
    lastNudgeAt: null,
    modeOverride: null,
    instagramAccount: {
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, windowNudgeEnabled: true },
    },
    ...overrides,
  };
}

describe("voice guards in the worker", () => {
  it("should pass chat language, corrections and voice rules into the draft", async () => {
    mocks.prisma.instagramAccount.findUnique.mockResolvedValue({
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, voiceRules: "klein schreiben", llmProvider: "openai", llmModel: "gpt-5-codex" },
    });
    mocks.loadVoiceContext.mockResolvedValue({
      humanStyleAnchor: ["ja easy"],
      recentAiReplies: [],
      voiceCorrections: ["Avoid: Hallo!\nPrefer: yo"],
      corpusEntryCount: 3,
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        humanStyleAnchor: ["ja easy"],
        voiceCorrections: ["Avoid: Hallo!\nPrefer: yo"],
        chatLanguage: "de",
        config: expect.objectContaining({
          voiceRules: "klein schreiben",
          instagramAccountId: "acc_1",
          llmSelection: { workspaceId: "ws_1", provider: "openai", model: "gpt-5-codex" },
        }),
      })
    );
  });

  it("should hold a confident draft that commits to a meeting time", async () => {
    mocks.generateSetterDraft.mockResolvedValue({
      reply: "passt, dann morgen um 15 uhr",
      confidence: 0.95,
      shouldSend: true,
      needsReview: false,
      reasons: [],
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "HELD",
          reasons: expect.arrayContaining([
            "draft makes an availability or meeting commitment",
          ]),
        }),
      })
    );
  });

  it("should hold a draft that repeats a recent AI reply", async () => {
    mocks.loadVoiceContext.mockResolvedValue({
      humanStyleAnchor: ["ja easy"],
      recentAiReplies: ["klar, was machst du aktuell?"],
      voiceCorrections: [],
      corpusEntryCount: 3,
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should hold when there is no human voice evidence anywhere", async () => {
    mocks.loadVoiceContext.mockResolvedValue({
      humanStyleAnchor: [],
      recentAiReplies: [],
      voiceCorrections: [],
      corpusEntryCount: 0,
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reasons: expect.arrayContaining(["no human-written voice evidence yet"]),
        }),
      })
    );
  });
});

describe("processWindowNudge", () => {
  beforeEach(() => {
    mocks.prisma.dmConversation.findUnique.mockResolvedValue(
      nudgeConversation()
    );
    // Two distinct findFirst queries hit this mock: the "who spoke last"
    // check (no direction filter) and the late-supersede check (filters
    // direction IN). Answer each by shape.
    mocks.prisma.dmMessage.findFirst.mockImplementation(
      (args: { where?: { direction?: string } }) =>
        args?.where?.direction === "IN"
          ? Promise.resolve(null)
          : Promise.resolve({ direction: "OUT" })
    );
    mocks.generateSetterDraft.mockClear();
  });

  it("should draft and auto-send a nudge when the prospect stayed quiet", async () => {
    await processWindowNudge(makeNudgeJob());

    expect(mocks.prisma.aiReplyLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inboundMid: `nudge:conv_1:${NUDGE_ANCHOR}`,
          reasons: expect.arrayContaining([
            "window nudge: prospect went quiet",
          ]),
        }),
      })
    );
    expect(mocks.sendAiReply).toHaveBeenCalledWith({ replyLogId: "log_1" });
  });

  it("should skip when the prospect replied since scheduling", async () => {
    mocks.prisma.dmConversation.findUnique.mockResolvedValue(
      nudgeConversation({ lastInboundAt: new Date(NUDGE_ANCHOR + 60_000) })
    );

    await processWindowNudge(makeNudgeJob());

    expect(mocks.prisma.aiReplyLog.create).not.toHaveBeenCalled();
    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should skip when the prospect spoke last", async () => {
    mocks.prisma.dmMessage.findFirst.mockResolvedValue({ direction: "IN" });

    await processWindowNudge(makeNudgeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should skip when nudges are disabled", async () => {
    mocks.prisma.dmConversation.findUnique.mockResolvedValue(
      nudgeConversation({
        instagramAccount: {
          ...BASE_ACCOUNT,
          aiSetterConfig: { ...BASE_CONFIG, windowNudgeEnabled: false },
        },
      })
    );

    await processWindowNudge(makeNudgeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });

  it("should hold the nudge instead of sending when the thread is in draft mode", async () => {
    mocks.prisma.dmConversation.findUnique.mockResolvedValue(
      nudgeConversation({ modeOverride: "DRAFT" })
    );

    await processWindowNudge(makeNudgeJob());

    expect(mocks.sendAiReply).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD" }),
      })
    );
  });
});

describe("per-thread mode override", () => {
  it("should auto-send in an AUTO thread while the account default is DRAFT", async () => {
    mocks.prisma.instagramAccount.findUnique.mockResolvedValue({
      ...BASE_ACCOUNT,
      aiSetterConfig: { ...BASE_CONFIG, mode: "DRAFT" },
    });
    mocks.prisma.dmConversation.upsert.mockResolvedValue({
      ...BASE_CONVERSATION,
      modeOverride: "AUTO",
    });

    await processInboundDm(makeJob());

    expect(mocks.sendAiReply).toHaveBeenCalledWith({ replyLogId: "log_1" });
  });

  it("should stay silent in an OFF thread while the account default is AUTO", async () => {
    mocks.prisma.dmConversation.upsert.mockResolvedValue({
      ...BASE_CONVERSATION,
      modeOverride: "OFF",
    });

    await processInboundDm(makeJob());

    expect(mocks.generateSetterDraft).not.toHaveBeenCalled();
    expect(mocks.sendAiReply).not.toHaveBeenCalled();
  });
});
