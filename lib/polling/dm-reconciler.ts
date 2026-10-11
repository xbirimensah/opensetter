/**
 * DM reconciliation sweep: the safety net for missed message webhooks.
 *
 * The comment side has had a polling reconciler from day one; this is
 * the same idea for DMs. Every sweep pulls each connected account's
 * recent conversations from Meta, backfills any message the local
 * mirror is missing (webhook outages, deploy gaps, Meta hiccups), and,
 * when the missed message is the thread's latest and still inside the
 * 24h reply window, enqueues it through the normal setter pipeline so
 * a prospect never sits unanswered because a webhook got lost.
 *
 * Mirror-only writes are idempotent (unique mid), and the setter job id
 * matches the webhook path's, so a race between sweep and webhook can
 * never double-process a message.
 */

import { prisma } from "@/lib/db/client";
import {
  getConversations,
  getConversationMessages,
  MetaApiError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getDMQueue, INBOUND_DM_JOB_NAME } from "@/lib/queue/client";
import { Prisma } from "@/app/generated/prisma/client";
import {
  hasGraphContent,
  isGraphUnsupportedOnly,
  normalizeGraphMessage,
} from "@/lib/meta/attachments";
import { captureMessageMedia } from "@/lib/media/inbound";

const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Newest threads first; a sweep never needs to touch cold history. */
const MAX_THREADS_PER_ACCOUNT = Number(
  process.env.DM_SWEEP_MAX_THREADS ?? 25
);

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

interface SweepStats {
  accounts: number;
  backfilled: number;
  enqueued: number;
}

async function sweepAccount(
  account: {
    id: string;
    instagramId: string;
    accessToken: string;
  },
  options: { maxThreads: number; enqueue: boolean; paceMs?: number } = {
    maxThreads: MAX_THREADS_PER_ACCOUNT,
    enqueue: true,
  }
): Promise<{ backfilled: number; enqueued: number }> {
  const accessToken = decryptToken(account.accessToken);
  const threads = await getConversations(accessToken, account.instagramId);
  let backfilled = 0;
  let enqueued = 0;

  for (const [index, thread] of threads.slice(0, options.maxThreads).entries()) {
    // Backfills read many threads at once; pace them so Meta's per-account
    // read limit (code 4) never trips for the live sweep.
    if (options.paceMs && index > 0) await new Promise((r) => setTimeout(r, options.paceMs));
    const participants = thread.participants?.data ?? [];
    const contact = participants.find((p) => p.id !== account.instagramId);
    if (!contact?.id) continue;

    const conversation = await prisma.dmConversation.upsert({
      where: {
        instagramAccountId_participantId: {
          instagramAccountId: account.id,
          participantId: contact.id,
        },
      },
      create: {
        instagramAccountId: account.id,
        participantId: contact.id,
        participantUsername: contact.username ?? null,
      },
      // The sweep is also where usernames get learned; webhooks never
      // carry them.
      update: contact.username
        ? { participantUsername: contact.username }
        : {},
    });

    const messages = await getConversationMessages(accessToken, thread.id);
    // Meta returns newest first; walk oldest first so timestamps land in
    // order and "newest missed inbound" is simply the last one we add.
    const ordered = [...(messages ?? [])].reverse();
    let newestMissedInbound: {
      mid: string;
      text: string;
      kind: ReturnType<typeof normalizeGraphMessage>["kind"];
      rawText: string;
      sentAt: Date;
    } | null = null;

    for (const message of ordered) {
      const mid = message.id;
      if (!mid || !hasGraphContent(message)) continue;
      const normalized = normalizeGraphMessage(message);
      const text = normalized.text;
      const isEcho = message.from?.id === account.instagramId;
      const sentAt = message.created_time
        ? new Date(message.created_time)
        : new Date();
      const attachments =
        normalized.attachments.length > 0
          ? (normalized.attachments as unknown as Prisma.InputJsonValue)
          : undefined;

      let createdId: string;
      try {
        const created = await prisma.dmMessage.create({
          data: {
            conversationId: conversation.id,
            mid,
            direction: isEcho ? "OUT" : "IN",
            source: isEcho ? "HUMAN" : "PARTICIPANT",
            text,
            kind: normalized.kind,
            ...(attachments ? { attachments } : {}),
            sentAt,
          },
          select: { id: true },
        });
        createdId = created.id;
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
        // Mirror already has it. Repair rows stored before rich mirroring
        // ("[media]" placeholders) while Meta still returns their content;
        // a bare is_unsupported read knows less than the placeholder does.
        if (isGraphUnsupportedOnly(message)) continue;
        const repaired = await prisma.dmMessage.updateMany({
          where: { mid, text: "[media]" },
          data: { text, kind: normalized.kind, ...(attachments ? { attachments } : {}) },
        });
        if (repaired.count > 0 && normalized.attachments.length > 0) {
          const row = await prisma.dmMessage.findUnique({ where: { mid }, select: { id: true } });
          if (row) {
            await captureMessageMedia({
              id: row.id,
              conversationId: conversation.id,
              attachments: normalized.attachments,
            }).catch(() => {});
          }
        }
        continue;
      }

      if (normalized.attachments.length > 0) {
        await captureMessageMedia({
          id: createdId,
          conversationId: conversation.id,
          attachments: normalized.attachments,
        }).catch(() => {});
      }

      backfilled += 1;
      if (!isEcho) {
        newestMissedInbound = {
          mid,
          text,
          kind: normalized.kind,
          rawText: message.message?.trim() ?? "",
          sentAt,
        };
      } else {
        newestMissedInbound = null;
      }

      // Keep the window anchors truthful for backfilled traffic.
      await prisma.dmConversation.update({
        where: { id: conversation.id },
        data: isEcho
          ? { lastOutboundAt: sentAt }
          : { lastInboundAt: sentAt },
      });
    }

    // A missed inbound that is still the last word in the thread means a
    // prospect is waiting. Hand it to the normal pipeline if the reply
    // window is still open. The deterministic job id makes this a no-op
    // when the webhook actually did arrive.
    if (
      options.enqueue &&
      newestMissedInbound &&
      Date.now() - newestMissedInbound.sentAt.getTime() < WINDOW_MS
    ) {
      await getDMQueue().add(
        INBOUND_DM_JOB_NAME,
        {
          instagramAccountId: account.instagramId,
          participantId: contact.id,
          mid: newestMissedInbound.mid,
          text: newestMissedInbound.text,
          kind: newestMissedInbound.kind,
          rawText: newestMissedInbound.rawText,
          mirrored: true,
          isEcho: false,
          timestamp: newestMissedInbound.sentAt.getTime(),
        },
        {
          jobId: `dm_${newestMissedInbound.mid.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        }
      );
      enqueued += 1;
    }
  }

  return { backfilled, enqueued };
}

/** Sweep every connected account that has the AI setter configured. */
export async function reconcileDms(): Promise<SweepStats> {
  const accounts = await prisma.instagramAccount.findMany({
    where: { aiSetterConfig: { isNot: null } },
    select: { id: true, instagramId: true, accessToken: true },
  });

  const stats: SweepStats = { accounts: accounts.length, backfilled: 0, enqueued: 0 };

  for (const account of accounts) {
    try {
      const result = await sweepAccount(account);
      stats.backfilled += result.backfilled;
      stats.enqueued += result.enqueued;
    } catch (error: unknown) {
      const message =
        error instanceof MetaApiError
          ? `Meta API Error ${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      console.error(
        `[DM Reconciler] Sweep failed for account ${account.instagramId}:`,
        message
      );
    }
  }

  if (stats.backfilled > 0) {
    console.log(
      `[DM Reconciler] Backfilled ${stats.backfilled} messages, enqueued ${stats.enqueued} for the setter`
    );
  }
  return stats;
}

/**
 * Mirror-only backfill of up to `maxThreads` threads per account (Meta's
 * first page holds 50). Never hands anything to the setter or flows, so it
 * is safe to run once after deploy to fill the inbox with older threads.
 */
export async function backfillMirror(maxThreads = 50): Promise<SweepStats> {
  const accounts = await prisma.instagramAccount.findMany({
    select: { id: true, instagramId: true, accessToken: true },
  });
  const stats: SweepStats = { accounts: accounts.length, backfilled: 0, enqueued: 0 };
  for (const account of accounts) {
    const result = await sweepAccount(account, { maxThreads, enqueue: false, paceMs: 2_000 });
    stats.backfilled += result.backfilled;
  }
  return stats;
}
