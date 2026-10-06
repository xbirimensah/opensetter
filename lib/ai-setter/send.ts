/**
 * Shared send path for AI setter replies, used by the worker (auto mode)
 * and the dashboard approval route (draft mode). Respects the same
 * workspace quota and per-account hourly rate limit as campaign DMs.
 */

import { prisma } from "@/lib/db/client";
import { MetaApiError, sendDirectMessage } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { getDMQueue, WINDOW_NUDGE_JOB_NAME } from "@/lib/queue/client";
import type { AiSetterConfig, DmConversation } from "@/app/generated/prisma/client";

const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Keep a margin so a nudge never races the window's actual close. */
const WINDOW_CLOSE_MARGIN_MS = 30 * 60 * 1000;

/**
 * Arm the quiet-prospect check for the current 24h window. Called on
 * every inbound mirror and after every setter send; the job id is
 * anchored to lastInboundAt, so one window can only ever produce one
 * nudge no matter how often this runs. When it fires, the processor
 * still verifies that we spoke last and the prospect stayed quiet.
 */
export async function scheduleWindowNudge(
  conversation: DmConversation,
  config: AiSetterConfig | null
): Promise<void> {
  if (!config?.windowNudgeEnabled) return;
  if ((conversation.modeOverride ?? config.mode) === "OFF") return;
  if (!conversation.lastInboundAt) return;

  const anchor = conversation.lastInboundAt.getTime();
  const fireAt = anchor + config.windowNudgeHours * 60 * 60 * 1000;
  const delay = fireAt - Date.now();
  if (delay <= 0) return;
  if (fireAt > anchor + WINDOW_MS - WINDOW_CLOSE_MARGIN_MS) return;

  await getDMQueue()
    .add(
      WINDOW_NUDGE_JOB_NAME,
      { conversationId: conversation.id, windowAnchorTs: anchor },
      { delay, jobId: `nudge_${conversation.id}_${anchor}` }
    )
    .catch(() => {});
}

export interface SendAiReplyParams {
  replyLogId: string;
  /** Optional human-edited text; defaults to the stored draft. */
  textOverride?: string;
}

export interface SendAiReplyResult {
  ok: boolean;
  /**
   * Machine-readable failure bucket for the caller to map to UX.
   * - conflict: another worker/click already claimed or sent this draft
   * - ambiguous: the send MAY have reached Instagram (network died
   *   mid-flight); the draft is quarantined as HELD, never auto-retried
   */
  error?:
    | "not_found"
    | "quota"
    | "rate_limit"
    | "send_failed"
    | "conflict"
    | "ambiguous";
  message?: string;
}

const AMBIGUOUS_SEND_REASON =
  "send was interrupted mid-flight; check the Instagram thread before approving again";

/**
 * Quarantine drafts stuck in SENDING (the process died between claiming
 * and recording the outcome). They become HELD with an explicit warning
 * instead of ever being resent automatically. Runs at worker boot and on
 * the reconcile interval.
 */
export async function recoverInterruptedSends(): Promise<number> {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
  const stale = await prisma.aiReplyLog.findMany({
    where: { status: "SENDING", updatedAt: { lt: staleBefore } },
    select: { id: true, reasons: true },
  });
  for (const row of stale) {
    await prisma.aiReplyLog.update({
      where: { id: row.id },
      data: {
        status: "HELD",
        reasons: [...row.reasons, AMBIGUOUS_SEND_REASON],
        errorMessage: "Send interrupted by a crash or restart",
      },
    });
  }
  return stale.length;
}

export async function sendAiReply(
  params: SendAiReplyParams
): Promise<SendAiReplyResult> {
  const replyLog = await prisma.aiReplyLog.findUnique({
    where: { id: params.replyLogId },
    include: {
      conversation: true,
      instagramAccount: {
        select: {
          id: true,
          instagramId: true,
          accessToken: true,
          workspaceId: true,
          aiSetterConfig: true,
        },
      },
    },
  });
  if (!replyLog) return { ok: false, error: "not_found" };

  const text = (params.textOverride ?? replyLog.draftText).trim();
  if (!text) return { ok: false, error: "send_failed", message: "Empty reply" };

  const account = replyLog.instagramAccount;

  // Atomic claim: exactly one caller may move this draft into SENDING.
  // A concurrent approve click, a racing job retry, or a resumed crashed
  // job all lose the claim and back off instead of double-sending.
  const previousStatus = replyLog.status;
  const claim = await prisma.aiReplyLog.updateMany({
    where: {
      id: replyLog.id,
      status: { in: ["PENDING", "HELD", "FAILED"] },
    },
    data: { status: "SENDING", draftText: text },
  });
  if (claim.count === 0) {
    return {
      ok: false,
      error: "conflict",
      message: "This draft is already being sent (or was already sent).",
    };
  }

  const revertClaim = async () => {
    await prisma.aiReplyLog
      .updateMany({
        where: { id: replyLog.id, status: "SENDING" },
        data: { status: previousStatus },
      })
      .catch(() => {});
  };

  const usage = await reserveWorkspaceDMSend(account.workspaceId);
  if (!usage.allowed) {
    await revertClaim();
    return {
      ok: false,
      error: "quota",
      message: `Monthly DM limit reached (${usage.limit})`,
    };
  }

  const rateLimit = await reserveDMSlot(account.instagramId).catch(() => null);
  if (!rateLimit || !rateLimit.allowed) {
    await releaseWorkspaceDMReservation(account.workspaceId, usage.periodStart);
    await revertClaim();
    return {
      ok: false,
      error: "rate_limit",
      message: "Hourly Instagram DM rate limit reached",
    };
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const result = await sendDirectMessage(
      accessToken,
      account.instagramId,
      replyLog.conversation.participantId,
      text
    );

    const sentAt = new Date();
    // A human-edited approval is mirrored as HUMAN for the thread view.
    // Its text is still excluded from the style anchor and corpus (it
    // started as an AI draft); the edit is learned as a correction below.
    const humanEdited =
      params.textOverride !== undefined && text !== replyLog.draftText.trim();
    await prisma.dmMessage
      .create({
        data: {
          conversationId: replyLog.conversationId,
          mid: result.message_id,
          direction: "OUT",
          source: humanEdited ? "HUMAN" : "AI",
          text,
          sentAt,
        },
      })
      .catch(() => {});
    const isNudge = replyLog.inboundMid.startsWith("nudge:");
    await prisma.dmConversation.update({
      where: { id: replyLog.conversationId },
      data: {
        lastOutboundAt: sentAt,
        ...(isNudge ? { lastNudgeAt: sentAt } : {}),
      },
    });
    await prisma.aiReplyLog.update({
      where: { id: replyLog.id },
      data: {
        status: "SENT",
        draftText: text,
        sentMid: result.message_id,
        sentAt,
        humanEdited,
        errorMessage: null,
      },
    });
    if (humanEdited) {
      // The edit is the owner correcting the setter's voice for this
      // contact. It is stored as a contact-scoped contrast pair; the
      // edited text itself never enters the style corpus or anchor.
      await prisma.voiceCorrection
        .create({
          data: {
            instagramAccountId: account.id,
            conversationId: replyLog.conversationId,
            replyLogId: replyLog.id,
            kind: "EDIT",
            avoidText: replyLog.draftText,
            preferText: text,
          },
        })
        .catch((error: unknown) => {
          console.error("[ai-setter] could not record voice correction:", error);
        });
    }
    if (!isNudge) {
      await scheduleWindowNudge(
        replyLog.conversation,
        replyLog.instagramAccount.aiSetterConfig
      );
    }
    return { ok: true };
  } catch (error: unknown) {
    await releaseWorkspaceDMReservation(account.workspaceId, usage.periodStart);
    const message = error instanceof Error ? error.message : "Unknown error";

    if (error instanceof MetaApiError) {
      // Meta answered with an error: the DM definitively did not send.
      // Safe to release the claim so a retry (or a human) can try again.
      await prisma.aiReplyLog.update({
        where: { id: replyLog.id },
        data: { status: previousStatus, errorMessage: message },
      });
      return { ok: false, error: "send_failed", message };
    }

    // No response from Meta (network death, timeout): the DM may or may
    // not have gone out. Quarantine as HELD with a warning; never retry
    // this automatically.
    await prisma.aiReplyLog.update({
      where: { id: replyLog.id },
      data: {
        status: "HELD",
        reasons: [...replyLog.reasons, AMBIGUOUS_SEND_REASON],
        errorMessage: message,
      },
    });
    return { ok: false, error: "ambiguous", message };
  }
}
