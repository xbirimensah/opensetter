/**
 * Response shapes of the inbox API (/api/inbox/*), shared by the route
 * handlers and the inbox UI. Type-only: safe to import from the browser.
 */

import type { DmMessageKind } from "@/lib/meta/attachments";
import type { InboxAttachment } from "@/lib/inbox/attachments";

export type { InboxAttachment };

export type InboxMessageSource = "PARTICIPANT" | "HUMAN" | "AI" | "CAMPAIGN" | "FLOW";

/**
 * "mirror": read from the local DmConversation/DmMessage mirror (rich
 * messages, contact profile, flows). "live": the mirror has nothing for
 * this account yet, so the list and threads come straight from Meta's
 * Conversations API (text summaries only, no profile).
 */
export type InboxMode = "mirror" | "live";

export interface InboxMessage {
  /** DmMessage.id in mirror mode, the Meta message id in live mode. */
  id: string;
  /** Meta message id (what replyToMid points at). */
  mid: string;
  fromMe: boolean;
  source: InboxMessageSource;
  kind: DmMessageKind;
  /** Readable text; for media a summary such as "[Voice message]". */
  text: string;
  attachments: InboxAttachment[];
  replyToMid: string | null;
  reaction: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  sentAt: string;
  /** Client only: an optimistic send that is not mirrored yet. */
  pending?: boolean;
}

export interface InboxConversationItem {
  /** DmConversation.id in mirror mode, the Meta thread id in live mode. */
  id: string;
  /** contact.id is the participant's IGSID (used for sends and AI state). */
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  lastMessage: {
    text: string;
    kind: DmMessageKind;
    fromMe: boolean;
    source: InboxMessageSource;
    sentAt: string;
    deleted: boolean;
  } | null;
  hasActiveFlow: boolean;
  /** Contact tags (mirror mode only). */
  tags?: string[];
}

export interface InboxConversationsResponse {
  mode: InboxMode;
  conversations: InboxConversationItem[];
  /** Every tag used in this account, for the filter menu (mirror mode). */
  availableTags?: string[];
  /** True when the list was narrowed by search or filters. */
  filtered?: boolean;
}

export type ContactFieldValue = string | number | boolean;

export interface InboxFlowRun {
  id: string;
  status: "RUNNING" | "WAITING";
  currentNodeId: string | null;
  currentNodeName: string | null;
  flow: { id: string; name: string };
  /** FlowRun.waiting summarized: interaction | buttons | input | delay. */
  waiting: {
    kind: string;
    /** Input timeout or delay resume time (ISO). */
    until: string | null;
    /** For input waits: email | phone | number | text | url. */
    inputType: string | null;
  } | null;
  startedAt: string;
}

export interface InboxContact {
  conversationId: string;
  participantId: string;
  username: string | null;
  email: string | null;
  emailCapturedAt: string | null;
  phone: string | null;
  phoneCapturedAt: string | null;
  tags: string[];
  customFields: Record<string, ContactFieldValue>;
  /** Latest RUNNING or WAITING run, if any. */
  flowRun: InboxFlowRun | null;
}

export interface InboxThreadResponse {
  mode: InboxMode;
  /** Null in live mode (no mirrored conversation to attach a profile to). */
  contact: InboxContact | null;
  /** Chronological, oldest first. */
  messages: InboxMessage[];
  /** More, older messages exist (fetch with ?before=<sentAt>&beforeId=<id>). */
  hasMore: boolean;
}

export interface InboxContactResponse {
  contact: InboxContact;
}

export interface InboxStopFlowResponse {
  stopped: number;
  contact: InboxContact;
}
