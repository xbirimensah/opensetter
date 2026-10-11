import { NextRequest, NextResponse } from "next/server";
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

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Record the attempt so a signature mismatch is visible rather than a
    // silent 401. This is the common symptom of FACEBOOK_APP_SECRET being
    // set to the wrong app's secret for the webhook's signing key.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Webhook signature verification failed",
          payload: {
            hadSignatureHeader: Boolean(signature),
            bodyLength: rawBody.length,
            bodyPreview: rawBody.slice(0, 200),
          },
        },
      })
      .catch(() => {});
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
