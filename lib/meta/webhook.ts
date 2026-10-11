import { createHmac, timingSafeEqual } from "crypto";
import {
  normalizeWebhookMessage,
  type DmAttachment,
  type DmMessageKind,
} from "@/lib/meta/attachments";

export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  // Instagram-Login apps sign webhooks with the Instagram app secret, while
  // Facebook-Login apps use the Facebook app secret. Both belong to the same
  // app, so accept a signature that matches either — this avoids a config
  // guess about which key Meta uses for a given app type.
  const secrets = [
    process.env.FACEBOOK_APP_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
  ].filter((s): s is string => Boolean(s));

  if (secrets.length === 0) {
    throw new Error(
      "FACEBOOK_APP_SECRET or INSTAGRAM_APP_SECRET is required to verify webhooks"
    );
  }

  return secrets.some((secret) => {
    const expected =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export interface WebhookCommentEvent {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
}

interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: {
      id?: string;
      comment_id?: string;
      text?: string;
      from?: {
        id?: string;
        username?: string;
      };
      media?: {
        id?: string;
      };
      media_id?: string;
    };
  }>;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    postback?: { mid?: string; title?: string; payload?: string };
    read?: { watermark?: number; seq?: number; mid?: string };
    reaction?: { mid?: string; action?: string; emoji?: string; reaction?: string };
    message_edit?: { mid?: string; text?: string; num_edit?: number };
    referral?: { ref?: string; source?: string; type?: string };
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_deleted?: boolean;
      is_unsupported?: boolean;
      attachments?: Array<{ type?: string; payload?: Record<string, unknown> }>;
      reply_to?: Record<string, unknown>;
      quick_reply?: { payload?: string };
      referral?: { ref?: string; source?: string; type?: string };
    };
  }>;
}

export interface WebhookMessageEvent {
  instagramAccountId: string;
  /** IGSID of the other participant, regardless of direction. */
  participantId: string;
  mid: string;
  /** Readable text; a summary like "[Voice message]" for media. */
  text: string;
  /** Exactly what the person typed (empty for media); flows match on this. */
  rawText?: string;
  kind?: DmMessageKind;
  attachments?: DmAttachment[];
  replyToMid?: string;
  quickReplyPayload?: string;
  /** ig.me ref parameter, when the message arrived through a ref link. */
  referralRef?: string;
  /**
   * True when this is an echo of a message the account itself sent
   * (via the IG app, the dashboard, or an API send).
   */
  isEcho: boolean;
  /** Meta event timestamp in ms, when provided. */
  timestamp?: number;
}

export interface WebhookPostbackEvent {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  /** Button label the user tapped; mirrored into the inbox. */
  title?: string;
  timestamp?: number;
}

/** In-place changes to an already mirrored message. */
export type WebhookMessageUpdate =
  | { type: "reaction"; instagramAccountId: string; mid: string; emoji: string | null }
  | { type: "edit"; instagramAccountId: string; mid: string; text: string }
  | { type: "delete"; instagramAccountId: string; mid: string };

/** A user opened the chat through an ig.me/m/<handle>?ref=<ref> link. */
export interface WebhookReferralEvent {
  instagramAccountId: string;
  userId: string;
  ref: string;
  timestamp?: number;
}

export interface WebhookReadEvent {
  instagramAccountId: string;
  userId: string;
  watermark?: number;
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export function parseCommentEvents(payload: WebhookPayload): WebhookCommentEvent[] {
  const events: WebhookCommentEvent[] = [];

  if (payload.object !== "instagram") {
    return events;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const value = change.value;
      const commentId = value?.id ?? value?.comment_id;
      const mediaId = value?.media?.id ?? value?.media_id;
      const commenterId = value?.from?.id;

      if (!entry.id || !commentId || !mediaId || !commenterId) {
        continue;
      }

      // Skip the connected account's own comments and comment replies.
      // A private reply to yourself is rejected by Meta, so queueing one
      // only produces a failed log and wasted retries.
      if (commenterId === entry.id) {
        continue;
      }

      events.push({
        instagramAccountId: entry.id,
        commentId,
        commentText: value.text ?? "",
        commenterId,
        commenterName: value.from?.username,
        mediaId,
      });
    }
  }

  return events;
}

/**
 * Parse Instagram DM message events (inbound messages plus echoes of the
 * account's own sends). Inbound messages feed the AI setter; echoes keep
 * the local conversation mirror complete and reveal human takeovers.
 */
export function parseMessageEvents(payload: WebhookPayload): WebhookMessageEvent[] {
  const events: WebhookMessageEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      if (!message?.mid) continue;

      const senderId = messaging.sender?.id;
      const recipientId = messaging.recipient?.id;
      const accountId = entry.id;
      if (!accountId || !senderId || !recipientId) continue;

      const isEcho = Boolean(message.is_echo) || senderId === accountId;
      const participantId = isEcho ? recipientId : senderId;
      // A self-thread cannot happen in a real DM; drop malformed events.
      if (!participantId || participantId === accountId) continue;

      // Deletions update the mirrored row in place (parseMessageUpdates).
      if (message.is_deleted) continue;
      const hasContent =
        Boolean(message.text?.trim()) ||
        (message.attachments?.length ?? 0) > 0 ||
        Boolean(message.reply_to) ||
        message.is_unsupported === true;
      if (!hasContent) continue;

      const normalized = normalizeWebhookMessage(message);
      events.push({
        instagramAccountId: accountId,
        participantId,
        mid: message.mid,
        text: normalized.text,
        rawText: message.text?.trim() ?? "",
        kind: normalized.kind,
        attachments: normalized.attachments,
        replyToMid: normalized.replyToMid,
        quickReplyPayload: normalized.quickReplyPayload,
        referralRef: message.referral?.ref,
        isEcho,
        timestamp: messaging.timestamp,
      });
    }
  }

  return events;
}

/**
 * Parse button-tap postbacks (from an opening DM's button) out of a webhook
 * payload. Each event carries the tapping user's IGSID and our postback payload.
 */
export function parsePostbackEvents(
  payload: WebhookPayload
): WebhookPostbackEvent[] {
  const events: WebhookPostbackEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const postbackPayload = messaging.postback?.payload;
      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!postbackPayload || !userId || !accountId) continue;
      // Ignore echoes of the account's own actions.
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        payload: postbackPayload,
        mid: messaging.postback?.mid,
        title: messaging.postback?.title,
        timestamp: messaging.timestamp,
      });
    }
  }

  return events;
}

/**
 * Parse Instagram DM read receipts. When a user reads an opening DM but does
 * not tap its button, the webhook route uses this to schedule the reveal after
 * a short grace period.
 */
export function parseReadEvents(payload: WebhookPayload): WebhookReadEvent[] {
  const events: WebhookReadEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      if (!messaging.read) continue;

      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!userId || !accountId) continue;
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        watermark: messaging.read.watermark,
      });
    }
  }

  return events;
}

/**
 * Reactions, edits and deletions of messages we already mirrored. They
 * change a row in place instead of adding a message.
 */
export function parseMessageUpdates(payload: WebhookPayload): WebhookMessageUpdate[] {
  const updates: WebhookMessageUpdate[] = [];
  if (payload.object !== "instagram") return updates;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;
    for (const messaging of entry.messaging ?? []) {
      const reaction = messaging.reaction;
      if (reaction?.mid) {
        updates.push({
          type: "reaction",
          instagramAccountId: accountId,
          mid: reaction.mid,
          emoji: reaction.action === "unreact" ? null : reaction.emoji ?? "\u2764",
        });
      }
      const edit = messaging.message_edit;
      if (edit?.mid && typeof edit.text === "string") {
        updates.push({ type: "edit", instagramAccountId: accountId, mid: edit.mid, text: edit.text });
      }
      if (messaging.message?.mid && messaging.message.is_deleted) {
        updates.push({ type: "delete", instagramAccountId: accountId, mid: messaging.message.mid });
      }
    }
  }
  return updates;
}

/**
 * ig.me ref-link opens. A first-time contact arrives as a standalone
 * `referral` event; an existing thread may carry it on the message.
 */
export function parseReferralEvents(payload: WebhookPayload): WebhookReferralEvent[] {
  const events: WebhookReferralEvent[] = [];
  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    for (const messaging of entry.messaging ?? []) {
      const ref = messaging.referral?.ref ?? messaging.message?.referral?.ref;
      const userId = messaging.sender?.id;
      if (!accountId || !ref || !userId || userId === accountId) continue;
      if (messaging.message?.is_echo) continue;
      events.push({ instagramAccountId: accountId, userId, ref, timestamp: messaging.timestamp });
    }
  }
  return events;
}
