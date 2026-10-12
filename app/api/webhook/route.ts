import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import {
  parseCommentEvents,
  parseMessageEvents,
  parseMessageUpdates,
  parsePostbackEvents,
  parseReadEvents,
  parseReferralEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import {
  INBOUND_DM_JOB_NAME,
  POSTBACK_JOB_NAME,
  REFERRAL_JOB_NAME,
} from "@/lib/queue/client";
import { applyMessageUpdates } from "@/lib/meta/message-updates";
import { hasBlockingFlowRun } from "@/lib/flows/service";
import { Prisma } from "@/app/generated/prisma/client";

const OPENING_DM_READ_FALLBACK_DELAY_MS = 5 * 60 * 1000;
const ECHO_DELAY_SECONDS = 5;

/** True when a flow waits for this contact's next message (input or first reply). */
async function flowIsWaiting(accountRecordId: string, participantId: string): Promise<boolean> {
  const conversation = await prisma.dmConversation.findUnique({
    where: {
      instagramAccountId_participantId: { instagramAccountId: accountRecordId, participantId },
    },
    select: { id: true },
  });
  return conversation ? hasBlockingFlowRun(conversation.id).catch(() => false) : false;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

/** Meta's webhook batches are small; anything near this is not from Meta. */
const MAX_WEBHOOK_BYTES = 1024 * 1024;
/** At most one "bad signature" event per minute, so junk can't flood the table. */
const SIGNATURE_FAILURE_LOG_INTERVAL_MS = 60_000;
let lastSignatureFailureLogAt = 0;
let unloggedSignatureFailures = 0;

/** Read the body but stop past the cap (chunked requests have no length). */
async function readBodyCapped(request: NextRequest, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The envelope every Instagram webhook has; the parsers handle the rest. */
const webhookEnvelope = z.object({
  object: z.string().max(64),
  entry: z.array(z.record(z.string(), z.unknown())).max(1000),
});

export async function POST(request: NextRequest) {
  const rawBody = await readBodyCapped(request, MAX_WEBHOOK_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ success: false, error: "Payload too large" }, { status: 413 });
  }
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Record mismatches so a wrong FACEBOOK_APP_SECRET is visible rather
    // than a silent 401, but at most once a minute and without any of the
    // (unauthenticated) body.
    unloggedSignatureFailures += 1;
    if (Date.now() - lastSignatureFailureLogAt > SIGNATURE_FAILURE_LOG_INTERVAL_MS) {
      lastSignatureFailureLogAt = Date.now();
      const failures = unloggedSignatureFailures;
      unloggedSignatureFailures = 0;
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "WARNING",
            message: "Webhook signature verification failed",
            payload: { hadSignatureHeader: Boolean(signature), bodyLength: rawBody.length, failures },
          },
        })
        .catch(() => {});
    }
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }
  if (!webhookEnvelope.safeParse(payload).success) {
    return NextResponse.json({ success: false, error: "Unexpected payload shape" }, { status: 400 });
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      object:
        typeof payload === "object" && payload && "object" in payload
          ? String(payload.object)
          : null,
      payload: payload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  try {
    const commentEvents = parseCommentEvents(
      payload as Parameters<typeof parseCommentEvents>[0]
    );
    const queue = getDMQueue();

    for (const event of commentEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: { workspaceId: true },
      });

      await queue.add(
        "process-comment",
        {
          instagramAccountId: event.instagramAccountId,
          commentId: event.commentId,
          commentText: event.commentText,
          commenterId: event.commenterId,
          commenterName: event.commenterName,
          mediaId: event.mediaId,
          source: "WEBHOOK",
        },
        {
          jobId: `comment_${event.instagramAccountId}_${event.commentId}`,
        }
      );

      if (account) {
        await prisma.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { workspaceId: account.workspaceId },
        });
      }
    }

    // DM message events (inbound + echoes) → the AI setter pipeline. The
    // job is always enqueued so the local conversation mirror stays
    // complete even while the setter is off. Inbound messages wait a
    // short per-account delay so rapid-fire messages collapse into one
    // reply; echoes are processed immediately.
    const messageEvents = parseMessageEvents(
      payload as Parameters<typeof parseMessageEvents>[0]
    );

    for (const event of messageEvents) {
      const account = await prisma.instagramAccount.findUnique({
        where: { instagramId: event.instagramAccountId },
        select: {
          id: true,
          workspaceId: true,
          aiSetterConfig: { select: { replyDelaySeconds: true } },
        },
      });
      if (!account) continue;

      // Echoes wait a few seconds so the send-time mirror of our own API
      // sends (AI setter, flows) lands first; otherwise the echo would be
      // recorded as a human reply and pause the setter.
      const delaySeconds = event.isEcho
        ? ECHO_DELAY_SECONDS
        : account.aiSetterConfig?.replyDelaySeconds ?? 10;

      await queue.add(
        INBOUND_DM_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          participantId: event.participantId,
          mid: event.mid,
          text: event.text,
          rawText: event.rawText,
          isEcho: event.isEcho,
          timestamp: event.timestamp,
          kind: event.kind,
          attachments: event.attachments,
          replyToMid: event.replyToMid,
          quickReplyPayload: event.quickReplyPayload,
          referralRef: event.referralRef,
        },
        {
          // Quick-reply taps and answers to a waiting flow skip the debounce.
          delay: event.isEcho
            ? delaySeconds * 1000
            : event.quickReplyPayload || (await flowIsWaiting(account.id, event.participantId))
              ? 0
              : delaySeconds * 1000,
          // BullMQ forbids ":" in custom job ids and Meta mids are not
          // charset-guaranteed, so sanitize defensively.
          jobId: `dm_${event.mid.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        }
      );

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { workspaceId: account.workspaceId },
      });
    }

    // Button taps from opening DMs → deliver the reveal message.
    const postbackEvents = parsePostbackEvents(
      payload as Parameters<typeof parsePostbackEvents>[0]
    );

    for (const event of postbackEvents) {
      await queue.add(
        POSTBACK_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          userId: event.userId,
          payload: event.payload,
          mid: event.mid,
          title: event.title,
          timestamp: event.timestamp,
        },
        {
          // BullMQ forbids ":" in custom job ids, and the payload is
          // "reveal:<id>", so build with underscores and strip any colons.
          jobId: `postback_${event.instagramAccountId}_${event.userId}_${(
            event.mid ?? event.payload
          ).replace(/:/g, "_")}`,
        }
      );
    }

    // Reactions, edits and deletions change mirrored rows in place.
    await applyMessageUpdates(
      parseMessageUpdates(payload as Parameters<typeof parseMessageUpdates>[0])
    );

    // ig.me ref links. A referral riding on a message is handled with that
    // message; a standalone one (first-time contact) gets its own job.
    const referralEvents = parseReferralEvents(
      payload as Parameters<typeof parseReferralEvents>[0]
    );
    const messageSenders = new Set(messageEvents.map((e) => e.participantId));
    for (const event of referralEvents) {
      if (messageSenders.has(event.userId)) continue;
      await queue.add(
        REFERRAL_JOB_NAME,
        {
          instagramAccountId: event.instagramAccountId,
          userId: event.userId,
          ref: event.ref,
          timestamp: event.timestamp,
        },
        {
          jobId: `referral_${event.instagramAccountId}_${event.userId}_${event.timestamp ?? Date.now()}`,
        }
      );
    }

    // If a user reads the opening DM and never taps the button, deliver the
    // same next-step DM after five minutes. The worker no-ops this delayed job
    // if a real button tap has already delivered the reveal.
    const readEvents = parseReadEvents(
      payload as Parameters<typeof parseReadEvents>[0]
    );

    for (const event of readEvents) {
      const openingLogs = await prisma.dmLog.findMany({
        where: {
          commenterId: event.userId,
          status: "SENT",
          automation: {
            isActive: true,
            openingDmEnabled: true,
            instagramAccount: {
              instagramId: event.instagramAccountId,
            },
          },
        },
        select: {
          automation: {
            select: {
              id: true,
            },
          },
        },
      });

      const scheduledAutomationIds = new Set<string>();
      for (const log of openingLogs) {
        const automation = log.automation;
        if (scheduledAutomationIds.has(automation.id)) continue;
        scheduledAutomationIds.add(automation.id);

        await queue.add(
          POSTBACK_JOB_NAME,
          {
            instagramAccountId: event.instagramAccountId,
            userId: event.userId,
            payload: `reveal:${automation.id}`,
            fallback: true,
          },
          {
            delay: OPENING_DM_READ_FALLBACK_DELAY_MS,
            jobId: `read_fallback_${event.instagramAccountId}_${event.userId}_${automation.id}`,
          }
        );
      }
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        processedAt: new Date(),
      },
    });

    return NextResponse.json(
      { success: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
