/**
 * Safety gates for the AI setter, ported from wa-bridge's autoreply
 * sidecar and adapted for a sales-setter context: scheduling and price
 * talk are the setter's job, so unlike the WhatsApp original they do not
 * trip the sensitive filter. Credentials, legal, medical and payment
 * details still do.
 */

import type { DraftReply } from "./types";
import { isReplyLanguageCompatible, type ChatLanguage } from "./language";
import { containsSecretMaterial } from "./secret-guard";

/** Instagram rejects DM text above 1000 chars; stay under with margin. */
const MAX_DRAFT_LENGTH = 900;
/** Very long inbound messages deserve a human read before any auto-send. */
const MAX_INCOMING_LENGTH_FOR_AUTO = 600;

const TRIVIAL_ACKNOWLEDGEMENT_PATTERNS: RegExp[] = [
  /^(?:yeah|yep|yup|yes|ok(?:ay)?|alright|sure|got it|makes sense|perfect|great|cool|nice|thanks|thank you|thx)[.!\s\u{1F44D}\u{2705}\u{1F44C}\u{1F642}\u{2764}\u{FE0F}\u{1F525}\u{1F64F}]*$/iu,
  /^(?:ja|jep|jo|okay|ok|alles klar|verstanden|passt|perfekt|mega|top|danke|dankeschön|dankesehr)[.!\s\u{1F44D}\u{2705}\u{1F44C}\u{1F642}\u{2764}\u{FE0F}\u{1F525}\u{1F64F}]*$/iu,
  /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]+$/u,
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(iban|wire transfer|bank transfer|refund|chargeback|invoice|überweisung|rückerstattung|rechnung|kündigung)\b/i,
  /\b(legal|lawyer|lawsuit|court|anwalt|klage|gericht|abmahnung|tax|steuer|finanzamt)\b/i,
  /\b(doctor|hospital|emergency|suicide|accident|police|arzt|krankenhaus|notfall|selbstmord|unfall|polizei)\b/i,
  /\b(otp|password|passwort|verification code|sicherheitscode|passport|reisepass|ausweis)\b/i,
];

/**
 * True when the inbound message is a bare acknowledgement that needs no
 * reply. Answering every "ok" makes the setter feel like a bot.
 */
export function isTrivialAcknowledgement(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return TRIVIAL_ACKNOWLEDGEMENT_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
}

export function matchesSensitiveTopic(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

// ─── Repetition protection (ported from wa-bridge) ──────────────────────────

const REPETITION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "be", "can", "das", "der", "die", "doch", "ein",
  "eine", "es", "for", "i", "ich", "im", "in", "is", "it", "ja", "mal", "mir", "of",
  "ok", "so", "the", "to", "und", "we", "with", "you",
]);

function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function meaningfulTokens(text: string): string[] {
  return normalizeForComparison(text)
    .split(" ")
    .filter((token) => token.length > 1 && !REPETITION_STOP_WORDS.has(token));
}

/**
 * True when the candidate repeats a recent AI reply in the same chat:
 * identical after normalization, or (for substantive replies) the same
 * two-word lead, the tell of a bot falling back to stock phrasing.
 */
export function isMeaningfullyRepetitiveReply(
  candidate: string,
  recentReplies: readonly string[]
): boolean {
  const normalized = normalizeForComparison(candidate);
  if (!normalized) return false;
  const candidateTokens = meaningfulTokens(candidate);
  return recentReplies.some((previous) => {
    const prior = normalizeForComparison(previous);
    if (prior && prior === normalized) return true;
    const priorTokens = meaningfulTokens(previous);
    return (
      candidateTokens.length >= 4 &&
      priorTokens.length >= 4 &&
      candidateTokens.slice(0, 2).join(" ") === priorTokens.slice(0, 2).join(" ")
    );
  });
}

// ─── Outbound commitments ───────────────────────────────────────────────────
// A model can rate a reply highly even when it commits the owner to a
// time, a price, a payment, or a meeting place. The generated text is
// checked independently at the final gate, in German and English. The
// booking link itself is the setter's job and does not trip these.

const WEEKDAYS =
  "montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const MEETING_COMMITMENT_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:${WEEKDAYS})\\b`, "i"),
  /\b\d{1,2}(?:[:.]\d{2})?\s*uhr\b/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?(?!\d)/,
  /\b(?:i\s+(?:can|will|am)|i['’]ll|we\s+can|let['’]?s)\s+(?:make it|join|meet|schedule|be available|be free|available|free|hop on|jump on)\b/i,
  /\b(?:meeting|call|appointment)\s+(?:for|at|on)\s+(?:\d|today|tomorrow|tonight)/i,
  /\b(?:ich|wir)\s+(?:hab|habe|haben|bin|sind|könnte|könnten|kann|können)\s+(?:\S+\s+){0,3}(?:zeit|frei|verfügbar)\b/i,
  /\b(?:lass(?:\s+uns)?|wollen\s+wir|können\s+wir)\s+(?:\S+\s+){0,4}(?:treffen|telefonieren|callen|facetimen|zoomen)\b/i,
  /\b(?:termin|call|treffen|meeting|gespräch|telefonat)\s+(?:am|um|für)\b/i,
  /(?<!\p{L})(?:morgen|übermorgen|heute abend|tomorrow|tonight)(?!\p{L}).{0,40}\b(?:call|termin|treffen|telefon\w*|zeit|meet|available|frei)\b/iu,
  /\b(?:call|termin|treffen|telefon\w*|meet)\b.{0,40}(?<!\p{L})(?:morgen|übermorgen|heute abend|tomorrow|tonight)(?!\p{L})/iu,
];

const FINANCIAL_COMMITMENT_PATTERNS: RegExp[] = [
  /(?:€|\$|£)\s?\d/,
  /\d[\d.,]*\s?(?:€|eur\b|euro\b|usd\b|chf\b|dollar)/i,
  /\b(?:der\s+)?(?:preis|kosten|investment|investition)\s+(?:ist|sind|liegt|liegen|beträgt|betragen)\b/i,
  /\bkostet\b/i,
  /\b(?:the\s+)?(?:price|cost|rate|fee|investment)\s+(?:is|are|will be)\b/i,
  /\b(?:i|we)\s+(?:can|will|['’]ll)\s+(?:offer|send|issue|refund|discount|charge|invoice)\b/i,
  /(?<![\p{L}\p{N}])(?:rabatt|discount|gutschein|coupon|rückerstattung|refund|geld[- ]zurück|money[- ]back|ratenzahlung|installments?|payment plan|zahlungsplan|überweis\p{L}*|rechnung|invoice|bezahl\p{L}*|zahlung\p{L}*)(?![\p{L}\p{N}])/iu,
  /\b(?:garantier\w*|guarantee\w*)\b/i,
];

const LOGISTICS_PATTERNS: RegExp[] = [
  /\b(?:adresse|anschrift|address|treffpunkt|meeting point|zoom[- ]link|google meet|meet\.google|zoom\.us|teams[- ]link)\b/i,
];

export const MEETING_COMMITMENT_REASON =
  "draft makes an availability or meeting commitment";
export const FINANCIAL_COMMITMENT_REASON =
  "draft makes a price or financial commitment";
export const LOGISTICS_REASON = "draft shares or asks for logistics details";

/** Reasons a draft must be reviewed because it commits the owner. */
export function findOutboundCommitments(draftText: string): string[] {
  const text = draftText.normalize("NFKC");
  const reasons: string[] = [];
  if (MEETING_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push(MEETING_COMMITMENT_REASON);
  }
  if (FINANCIAL_COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push(FINANCIAL_COMMITMENT_REASON);
  }
  if (LOGISTICS_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push(LOGISTICS_REASON);
  }
  return reasons;
}

/** Pictographs, modifiers and joiners only: a reaction, not a reply. */
export function isEmojiOnlyReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u.test(
    trimmed
  );
}

export interface VoiceEvidence {
  /** Human-typed messages from the owner in this exact chat. */
  sameChatHumanMessages: number;
  /** Entries in the owner's local style corpus. */
  corpusEntries: number;
  /** Require same-chat human messages (the sidecar's strict rule). */
  strict: boolean;
}

export interface AutoSendCheck {
  allowed: boolean;
  reasons: string[];
}

/**
 * Final gate before an automatic send. Every reason is recorded on the
 * reply log so a held draft explains itself in the dashboard.
 */
export function evaluateAutoSendSafety(params: {
  incomingText: string;
  draft: DraftReply;
  minConfidence: number;
  /** Language this chat runs in; a mismatching draft is held. */
  chatLanguage?: ChatLanguage;
  /** The setter's own recent replies in this chat, newest last. */
  recentAiReplies?: readonly string[];
  /** Whether there is human-written voice to imitate at all. */
  voiceEvidence?: VoiceEvidence;
}): AutoSendCheck {
  const reasons: string[] = [];
  const incoming = params.incomingText.trim();
  const draftText = params.draft.reply.trim();

  if (!incoming) reasons.push("incoming text empty");
  if (incoming.length > MAX_INCOMING_LENGTH_FOR_AUTO) {
    reasons.push("incoming message too long for safe auto-send");
  }
  if (!draftText) reasons.push("draft reply empty");
  if (draftText.length > MAX_DRAFT_LENGTH) reasons.push("draft reply too long");
  if (params.draft.confidence < params.minConfidence) {
    reasons.push("confidence below minimum threshold");
  }
  if (!params.draft.shouldSend) {
    reasons.push("model marked reply as should_send=false");
  }
  if (params.draft.needsReview) {
    reasons.push("model marked reply as needs_review=true");
  }
  if (matchesSensitiveTopic(incoming)) {
    reasons.push("incoming message matches a sensitive-topic pattern");
  }
  if (matchesSensitiveTopic(draftText)) {
    reasons.push("draft reply matches a sensitive-topic pattern");
  }
  if (containsSecretMaterial(draftText)) {
    reasons.push("draft contains secret-looking material");
  }
  if (draftText) {
    if (isEmojiOnlyReply(draftText)) reasons.push("draft is emoji-only");
    if (isTrivialAcknowledgement(draftText)) {
      reasons.push("draft is a trivial acknowledgement");
    }
    reasons.push(...findOutboundCommitments(draftText));
  }
  if (
    params.chatLanguage &&
    !isReplyLanguageCompatible(draftText, params.chatLanguage)
  ) {
    reasons.push("draft language does not match the chat language");
  }
  if (
    params.recentAiReplies &&
    isMeaningfullyRepetitiveReply(draftText, params.recentAiReplies)
  ) {
    reasons.push("draft repeats a recent AI reply in this chat");
  }
  const evidence = params.voiceEvidence;
  if (evidence && evidence.sameChatHumanMessages === 0) {
    if (evidence.strict) {
      reasons.push("no human-written messages from you in this chat yet");
    } else if (evidence.corpusEntries === 0) {
      reasons.push("no human-written voice evidence yet");
    }
  }

  return { allowed: reasons.length === 0, reasons };
}
