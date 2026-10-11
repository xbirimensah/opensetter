import type { ChatLanguage } from "./language";

/**
 * Shared types for the AI DM setter.
 *
 * The reply engine is a port of the wa-bridge autoreply sidecar
 * (WhatsApp) onto OpenSetter's Instagram DM pipeline.
 */

export interface DraftReply {
  reply: string;
  /** Model self-rated confidence between 0 and 1. */
  confidence: number;
  /** Model's own judgment on whether this is safe to auto-send. */
  shouldSend: boolean;
  /** True when a human should review before anything goes out. */
  needsReview: boolean;
  reasons: string[];
}

export interface ConversationMessage {
  direction: "IN" | "OUT";
  source: "PARTICIPANT" | "HUMAN" | "AI" | "CAMPAIGN" | "FLOW";
  text: string;
  sentAt: Date;
}

export interface SetterPromptContext {
  incomingText: string;
  participantUsername?: string | null;
  /** Recent thread history, oldest first. */
  history: ConversationMessage[];
  /** Verbatim human-typed outbound messages: the strongest voice signal. */
  humanStyleAnchor: string[];
  /** Facts retrieved from the second brain, already rendered as text. */
  knowledgeContext: string;
  /** Style examples retrieved from the isolated style index. */
  styleExamples: string;
  /** Examples from the owner's local style corpus, already rendered. */
  corpusExamples?: string;
  /** Contact-scoped corrections for this exact chat, oldest first. */
  voiceCorrections?: string[];
  /** Resolved chat language; "unknown" lets the model match the message. */
  targetLanguage?: ChatLanguage;
  persona?: string | null;
  goal?: string | null;
  bookingLink?: string | null;
  language?: string | null;
  minConfidence: number;
}
