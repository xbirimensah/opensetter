/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";
import type { DmAttachment, DmMessageKind } from "@/lib/meta/attachments";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. Recorded in the shared ProcessedComment
  // dedup store so the reconciler can tell webhook- from polling-caught comments.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
  /** Tapped button label, mirrored into the inbox. */
  title?: string;
  timestamp?: number;
}

// One Instagram DM message event (inbound or echo) for the AI setter
// pipeline: mirror it locally, then maybe draft and send a reply.
export interface ProcessInboundDmJob {
  instagramAccountId: string;
  participantId: string;
  mid: string;
  text: string;
  isEcho: boolean;
  /** Meta event timestamp in ms; falls back to enqueue time. */
  timestamp?: number;
  /** What the person typed, without media summaries (flows match on it). */
  rawText?: string;
  /** Rich content (absent on jobs queued before rich mirroring). */
  kind?: DmMessageKind;
  attachments?: DmAttachment[];
  replyToMid?: string;
  quickReplyPayload?: string;
  referralRef?: string;
  /**
   * The DM reconciler already wrote this message to the mirror. The job
   * then skips the insert (whose duplicate key would otherwise end it)
   * and goes straight to flows and the setter.
   */
  mirrored?: boolean;
  /** Re-runs after the flow lock was busy (bounded). */
  flowRetry?: number;
}

// A flow run parked on a delay step: continue at `nodeId` when it fires.
export interface ProcessFlowResumeJob {
  runId: string;
  nodeId: string;
}

// A user opened the chat through an ig.me ref link (no message yet).
export interface ProcessReferralJob {
  instagramAccountId: string;
  userId: string;
  ref: string;
  timestamp?: number;
}

// Delayed check on a quiet prospect: if they still have not replied when
// this fires (and the 24h window is still open), the setter nudges once.
export interface ProcessWindowNudgeJob {
  conversationId: string;
  /** lastInboundAt (ms) when the nudge was scheduled: the window anchor. */
  windowAnchorTs: number;
}

/** One signed POST of an integration event to one webhook endpoint. */
export interface DeliverWebhookJob {
  endpointId: string;
  /** The JSON body, already serialized, so every retry signs the same bytes. */
  body: string;
  eventId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessInboundDmJob
  | ProcessWindowNudgeJob
  | ProcessFlowResumeJob
  | ProcessReferralJob
  | DeliverWebhookJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const INBOUND_DM_JOB_NAME = "process-inbound-dm";
export const WINDOW_NUDGE_JOB_NAME = "process-window-nudge";
export const FLOW_RESUME_JOB_NAME = "process-flow-resume";
export const REFERRAL_JOB_NAME = "process-referral";
export const WEBHOOK_JOB_NAME = "deliver-webhook";

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
        // Clear failed jobs shortly after they exhaust retries. Job ids are
        // deterministic (comment_<acct>_<id>), so a retained failed job would
        // block the polling reconciler from ever retrying that comment. Clearing
        // them lets a later sweep re-enqueue and try again once a transient
        // failure (e.g. an Instagram rate-limit window) has passed. Failure
        // detail is still preserved in DmLog.
        removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: {
          type: "custom",
        },
      },
    });
  }
  return dmQueue;
}
