/**
 * Flow contract shared by the engine, the editor and the API.
 *
 * A flow is a ManyChat-style automation for Instagram DMs: a graph of
 * nodes stored as JSON on Flow.graph. Comment triggers are Automation rows
 * with flowId = the flow (reusing the comment pipeline: keyword matching,
 * public replies, dedupe, quota and DmLog stats); the flow API merges them
 * into the trigger list as CommentTrigger. Every other trigger lives on
 * Flow.triggers.
 *
 * Meta limits encoded here (Instagram Messaging API):
 * - text: 1000 UTF-8 bytes (the engine trims by bytes), 640 characters
 *   when it carries buttons
 * - buttons: up to 3 per text or card, title up to 20 chars
 * - quick replies: up to 13, title up to 20 chars, no URLs
 * - cards (generic template): up to 10, title and subtitle up to 80 chars
 * - media by URL: image png/jpeg 8MB, video mp4/mov/webm 25MB,
 *   audio aac/m4a/wav/mp4 25MB, file pdf 25MB
 * - automated sends only inside the 24h window opened by a user message,
 *   a postback tap or a quick-reply tap (a comment allows one private reply)
 */

export const LIMITS = {
  textMax: 1000,
  textWithButtonsMax: 640,
  buttonsMax: 3,
  buttonTitleMax: 20,
  quickRepliesMax: 13,
  quickReplyTitleMax: 20,
  cardsMax: 10,
  cardTitleMax: 80,
  cardSubtitleMax: 80,
  typingMaxSeconds: 20,
  /** Total typing pauses per engine pass (the conversation lock is held). */
  typingMaxSecondsPerPass: 20,
  /** Identical taps inside this window are double taps and are ignored. */
  doubleTapMs: 60_000,
  /** Max chained "start another flow" hops. */
  maxFlowDepth: 5,
  windowMs: 24 * 60 * 60 * 1000,
  /** Steps executed in one engine pass before it yields (loop guard). */
  maxStepsPerPass: 40,
} as const;

// ─── Buttons ────────────────────────────────────────────────────────────────

export type FlowButton =
  /** Opens a URL. `track` routes it through /f/<slug> to count clicks. */
  | { id: string; type: "url"; title: string; url: string; track?: boolean }
  /** Postback: continues the flow at `next` (null = end the flow). */
  | { id: string; type: "next"; title: string; next: string | null }
  /** Postback: starts another flow from its start node. */
  | { id: string; type: "flow"; title: string; flowId: string };

export interface FlowQuickReply {
  id: string;
  title: string;
  next: string | null;
}

export interface FlowCard {
  id: string;
  title: string;
  subtitle?: string;
  /** MediaAsset id, or an external https URL in imageUrl. */
  imageMediaId?: string;
  imageUrl?: string;
  buttons: FlowButton[];
}

// ─── Message content blocks ────────────────────────────────────────────────

export type FlowMediaContentType = "image" | "video" | "audio" | "file";

export type FlowContent =
  | { id: string; type: "text"; text: string; buttons?: FlowButton[] }
  | {
      id: string;
      type: FlowMediaContentType;
      /** MediaAsset id (uploaded in OpenSetter) or an external https URL. */
      mediaId?: string;
      url?: string;
    }
  /** Generic template; more than one card renders as a swipeable gallery. */
  | { id: string; type: "cards"; cards: FlowCard[] }
  /** Pause between two blocks of the same message (ManyChat "Delay" block). */
  | { id: string; type: "typing"; seconds: number };

// ─── Conditions and actions ────────────────────────────────────────────────

export type FlowRuleSubject =
  | "follows" // contact follows the account (live check via Meta)
  | "tag"
  | "email"
  | "phone"
  | "field" // custom field, name in `key`
  | "last_input"; // the contact's last text message

export type FlowRuleOp =
  | "is_true"
  | "is_false"
  | "has"
  | "has_not"
  | "is_set"
  | "is_not_set"
  | "equals"
  | "not_equals"
  | "contains";

export interface FlowRule {
  id: string;
  subject: FlowRuleSubject;
  /** Custom field name for subject "field". Tag rules keep the tag in `value`. */
  key?: string;
  op: FlowRuleOp;
  value?: string;
}

export type FlowAction =
  | { id: string; type: "add_tag"; tag: string }
  | { id: string; type: "remove_tag"; tag: string }
  /** `value` supports {{variables}} (see renderTemplate). */
  | { id: string; type: "set_field"; key: string; value: string }
  | { id: string; type: "clear_field"; key: string }
  /**
   * External request (ManyChat "External Request"). `body` is a JSON
   * template with {{variables}}; omitted → the full contact profile.
   * `saveResponse` copies JSON paths from the response into fields.
   */
  | {
      id: string;
      type: "webhook";
      url: string;
      method?: "POST" | "GET";
      body?: string;
      headers?: Record<string, string>;
      saveResponse?: { path: string; key: string }[];
    }
  /** Records an operational event the owner sees in Diagnostics. */
  | { id: string; type: "notify"; message: string }
  /** Turn the AI setter off/on for this conversation. */
  | { id: string; type: "pause_ai" }
  | { id: string; type: "resume_ai" };

// ─── Nodes ────────────────────────────────────────────────────────────────

interface NodeBase {
  id: string;
  /** Label shown in the editor and analytics. */
  name?: string;
  /** Editor-only layout hint. */
  position?: { x: number; y: number };
}

/**
 * Sends its contents in order. Buttons and quick replies route on their own.
 * After sending: `next` set → continue at once; else buttons or quick replies
 * present → wait for a tap; else the flow ends.
 */
export interface MessageNode extends NodeBase {
  type: "message";
  contents: FlowContent[];
  quickReplies?: FlowQuickReply[];
  next?: string | null;
}

export type FlowInputType = "email" | "phone" | "number" | "text" | "url";

/** ManyChat "Data Collection": asks, validates, retries, saves. */
export interface InputNode extends NodeBase {
  type: "input";
  prompt: string;
  inputType: FlowInputType;
  /** "email" | "phone" | "field:<name>" */
  saveTo: string;
  retryMessage?: string;
  /** Re-asks after an invalid answer before taking `onFail`. Default 2. */
  maxRetries?: number;
  /** Adds a Skip quick reply with this title. */
  skipLabel?: string;
  /** Minutes to wait for an answer (capped by the 24h window). Default 1440. */
  timeoutMinutes?: number;
  next?: string | null;
  /** After the last failed retry, or a Skip tap. null = end. */
  onFail?: string | null;
}

export interface ConditionNode extends NodeBase {
  type: "condition";
  match: "all" | "any";
  rules: FlowRule[];
  next: string | null;
  elseNext: string | null;
}

export interface ActionNode extends NodeBase {
  type: "action";
  actions: FlowAction[];
  next?: string | null;
}

/** Smart delay. Never reopens the 24h window: a closed window expires the run. */
export interface DelayNode extends NodeBase {
  type: "delay";
  seconds: number;
  next?: string | null;
}

export interface RandomizerNode extends NodeBase {
  type: "randomizer";
  branches: { id: string; weight: number; next: string | null }[];
}

export interface StartFlowNode extends NodeBase {
  type: "start_flow";
  flowId: string;
}

/** Ends the flow and hands the thread to the AI setter. */
export interface AiHandoffNode extends NodeBase {
  type: "ai_handoff";
}

export type FlowNode =
  | MessageNode
  | InputNode
  | ConditionNode
  | ActionNode
  | DelayNode
  | RandomizerNode
  | StartFlowNode
  | AiHandoffNode;

export type FlowNodeType = FlowNode["type"];

export interface FlowGraph {
  startNodeId: string | null;
  nodes: FlowNode[];
  /** Editor-only: where the "When..." trigger card sits on the canvas. */
  triggerPosition?: { x: number; y: number };
}

// ─── Triggers ─────────────────────────────────────────────────────────────

export type KeywordMatch = "contains" | "is" | "whole_word" | "begins_with";

export type FlowTrigger =
  | {
      id: string;
      type: "dm_keyword";
      keywords: string[];
      match: KeywordMatch;
      excludeKeywords?: string[];
    }
  /** Reply to any story (empty keywords) or to stories containing a keyword. */
  | { id: string; type: "story_reply"; keywords?: string[]; match?: KeywordMatch }
  | { id: string; type: "story_mention"; oncePer24h?: boolean }
  /** ig.me/m/<handle>?ref=<ref> */
  | { id: string; type: "ref_link"; ref: string }
  /** First message ever from a new contact. */
  | { id: string; type: "welcome" }
  /** No other trigger matched and the AI setter is off for the thread. */
  | { id: string; type: "default_reply"; oncePer24h?: boolean }
  /**
   * Meta's follow event is a partner-only beta (ManyChat "Follow to DM"),
   * not on the public API. Stored so a flow is ready the day Meta delivers
   * follow webhooks to this app; it never fires before that.
   */
  | { id: string; type: "new_follower" };

export type FlowTriggerType = FlowTrigger["type"];

/**
 * Comment on a post or reel. Not stored in Flow.triggers: each one is an
 * Automation row with flowId = the flow, so the comment pipeline (dedupe,
 * quota, public replies, DmLog stats, share reports) stays unchanged. The
 * flow API returns these rows merged into the trigger list and syncs them
 * back on save (lib/flows/comment-triggers.ts).
 */
export interface CommentTrigger {
  id: string;
  type: "comment";
  /** The Automation row behind it; absent until the first save. */
  automationId?: string;
  /** Opaque row version from the API (optimistic concurrency); the editor keeps it outside its draft. */
  version?: string;
  /** Set only for a specific post or reel. */
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  /** Binds to the next reel the account posts (cron attach-next-reel). */
  pendingNextReel: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  publicReplyEnabled: boolean;
  /** Rotated public replies under the comment. */
  publicReplyMessages: string[];
  /**
   * Rewrite the flow's first message per commenter with the AI setter's
   * model (Automation.aiPersonalizeDm). Absent means off.
   */
  aiPersonalizeOpener?: boolean;
}

/** What the editor and the flow API list as a flow's triggers. */
export type EditorTrigger = FlowTrigger | CommentTrigger;
export type EditorTriggerType = EditorTrigger["type"];

/** What started a run. */
export interface FlowRunContext {
  trigger: FlowTriggerType | "comment" | "button" | "manual" | "start_flow" | "api";
  /** Comment-started runs: the first send is a private reply to this comment. */
  commentId?: string;
  commentText?: string;
  automationId?: string;
  keyword?: string;
  /** Comment runs: personalize the first message to the comment. */
  aiOpener?: boolean;
  ref?: string;
  /** Set once the contact replied or tapped (opens the 24h window). */
  interacted?: boolean;
  /** Randomizer stickiness: randomizer node id → chosen branch id. */
  randomizer?: Record<string, string>;
  /** Last button/quick-reply tap, to drop double taps. */
  lastTap?: { key: string; at: string };
  /** How many "start another flow" hops led here (cycle guard). */
  depth?: number;
}

/** What a WAITING run is parked on (FlowRun.waiting). */
export type FlowWaiting =
  /** Private reply sent; resume at `nodeId` content index once the contact interacts. */
  | { kind: "interaction"; nodeId: string; contentIndex: number }
  /** Message with buttons or quick replies, waiting for a tap. */
  | { kind: "buttons"; nodeId: string }
  | { kind: "input"; nodeId: string; expiresAt: string }
  | { kind: "delay"; nodeId: string; resumeAt: string };

/** Postback / quick-reply payload: FLOW|<flowId>|<nodeId>|<buttonId>. */
export const FLOW_PAYLOAD_PREFIX = "FLOW|";

export function encodeFlowPayload(flowId: string, nodeId: string, buttonId: string): string {
  return `${FLOW_PAYLOAD_PREFIX}${flowId}|${nodeId}|${buttonId}`;
}

export function decodeFlowPayload(
  payload: string
): { flowId: string; nodeId: string; buttonId: string } | null {
  if (!payload.startsWith(FLOW_PAYLOAD_PREFIX)) return null;
  const [flowId, nodeId, buttonId] = payload.slice(FLOW_PAYLOAD_PREFIX.length).split("|");
  if (!flowId || !nodeId || !buttonId) return null;
  return { flowId, nodeId, buttonId };
}
