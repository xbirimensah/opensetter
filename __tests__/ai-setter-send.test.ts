/**
 * AI Setter Send Path - Double-Send Protection Tests
 *
 * The invariant under test: no code path may deliver the same draft to
 * Instagram twice, and an ambiguous outcome is quarantined for a human
 * instead of retried.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    aiReplyLog: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    dmMessage: { create: vi.fn() },
    dmConversation: { update: vi.fn() },
    voiceCorrection: { create: vi.fn() },
  },
  sendDirectMessage: vi.fn(),
  reserveDMSlot: vi.fn(),
  reserveWorkspaceDMSend: vi.fn(),
  releaseWorkspaceDMReservation: vi.fn(),
  queueAdd: vi.fn(),
}));

const { MockMetaApiError } = vi.hoisted(() => {
  class MockMetaApiError extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.code = code;
    }
  }
  return { MockMetaApiError };
});

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/meta/client", () => ({
  MetaApiError: MockMetaApiError,
  sendDirectMessage: mocks.sendDirectMessage,
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: () => "token" }));
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mocks.reserveDMSlot,
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mocks.reserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mocks.releaseWorkspaceDMReservation,
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mocks.queueAdd }),
  WINDOW_NUDGE_JOB_NAME: "process-window-nudge",
}));

import { sendAiReply, recoverInterruptedSends } from "../lib/ai-setter/send";

const BASE_REPLY_LOG = {
  id: "log_1",
  conversationId: "conv_1",
  inboundMid: "mid_1",
  draftText: "original draft",
  reasons: [],
  status: "HELD",
  conversation: {
    id: "conv_1",
    participantId: "9001",
    lastInboundAt: new Date(),
    modeOverride: null,
  },
  instagramAccount: {
    id: "acc_1",
    instagramId: "17840001",
    accessToken: "encrypted",
    workspaceId: "ws_1",
    aiSetterConfig: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.aiReplyLog.findUnique.mockResolvedValue(BASE_REPLY_LOG);
  mocks.prisma.aiReplyLog.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.aiReplyLog.update.mockResolvedValue({});
  mocks.prisma.dmMessage.create.mockResolvedValue({});
  mocks.prisma.dmConversation.update.mockResolvedValue({});
  mocks.prisma.voiceCorrection.create.mockResolvedValue({});
  mocks.reserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    periodStart: new Date(),
  });
  mocks.reserveDMSlot.mockResolvedValue({ allowed: true });
  mocks.sendDirectMessage.mockResolvedValue({
    recipient_id: "9001",
    message_id: "mid_sent",
  });
});

describe("sendAiReply double-send protection", () => {
  it("should claim the draft as SENDING before calling Meta", async () => {
    const result = await sendAiReply({ replyLogId: "log_1" });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.aiReplyLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "HELD", "FAILED"] },
        }),
        data: expect.objectContaining({ status: "SENDING" }),
      })
    );
    const claimOrder =
      mocks.prisma.aiReplyLog.updateMany.mock.invocationCallOrder[0];
    const sendOrder = mocks.sendDirectMessage.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);
  });

  it("should back off without sending when another caller holds the claim", async () => {
    mocks.prisma.aiReplyLog.updateMany.mockResolvedValue({ count: 0 });

    const result = await sendAiReply({ replyLogId: "log_1" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("conflict");
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("should release the claim when Meta definitively rejects the send", async () => {
    mocks.sendDirectMessage.mockRejectedValue(
      new MockMetaApiError("window closed", 10)
    );

    const result = await sendAiReply({ replyLogId: "log_1" });

    expect(result.error).toBe("send_failed");
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD" }),
      })
    );
    expect(mocks.releaseWorkspaceDMReservation).toHaveBeenCalled();
  });

  it("should quarantine as HELD when the outcome is ambiguous (network death)", async () => {
    mocks.sendDirectMessage.mockRejectedValue(new TypeError("fetch failed"));

    const result = await sendAiReply({ replyLogId: "log_1" });

    expect(result.error).toBe("ambiguous");
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "HELD",
          reasons: expect.arrayContaining([
            expect.stringContaining("interrupted mid-flight"),
          ]),
        }),
      })
    );
  });

  it("should record human-edited approvals as the owner's voice", async () => {
    await sendAiReply({ replyLogId: "log_1", textOverride: "my own wording" });

    expect(mocks.prisma.dmMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: "HUMAN" }),
      })
    );
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", humanEdited: true }),
      })
    );
  });

  it("should turn an edited approval into a contact-scoped voice correction", async () => {
    await sendAiReply({ replyLogId: "log_1", textOverride: "my own wording" });

    expect(mocks.prisma.voiceCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instagramAccountId: "acc_1",
        conversationId: "conv_1",
        replyLogId: "log_1",
        kind: "EDIT",
        avoidText: "original draft",
        preferText: "my own wording",
      }),
    });
  });

  it("should not record a correction for an unedited approval", async () => {
    await sendAiReply({ replyLogId: "log_1" });

    expect(mocks.prisma.voiceCorrection.create).not.toHaveBeenCalled();
  });

  it("should record unedited approvals as AI voice", async () => {
    await sendAiReply({ replyLogId: "log_1" });

    expect(mocks.prisma.dmMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: "AI" }),
      })
    );
  });

  it("should revert the claim when quota or rate limit blocks the send", async () => {
    mocks.reserveDMSlot.mockResolvedValue({ allowed: false });

    const result = await sendAiReply({ replyLogId: "log_1" });

    expect(result.error).toBe("rate_limit");
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
    expect(mocks.prisma.aiReplyLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SENDING" }),
        data: expect.objectContaining({ status: "HELD" }),
      })
    );
  });
});

describe("recoverInterruptedSends", () => {
  it("should quarantine stale SENDING rows as HELD with a warning", async () => {
    mocks.prisma.aiReplyLog.findMany.mockResolvedValue([
      { id: "log_stuck", reasons: ["draft mode"] },
    ]);

    const count = await recoverInterruptedSends();

    expect(count).toBe(1);
    expect(mocks.prisma.aiReplyLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log_stuck" },
        data: expect.objectContaining({
          status: "HELD",
          reasons: expect.arrayContaining([
            "draft mode",
            expect.stringContaining("interrupted mid-flight"),
          ]),
        }),
      })
    );
  });
});
