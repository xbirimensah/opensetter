/**
 * Pure building blocks of the private style corpus: redaction, entry
 * selection from the local DM mirror, and retrieval ranking. Database
 * access lives in style-corpus.ts.
 */

import type {
  DmMessageDirection,
  DmMessageSource,
} from "@/app/generated/prisma/client";
import {
  isAgentAuthored,
  normalizeForMatch,
  type AgentFootprint,
} from "./authorship";
import { detectTextLanguage, type ChatLanguage } from "./language";

export const CORPUS_MAX_ENTRIES = 3000;
const MIN_ENTRY_CHARS = 2;
const MAX_ENTRY_CHARS = 500;
const MAX_RENDERED_CHARS = 180;
const PLACEHOLDER_PATTERN = /\[(?:email|link|iban|phone|handle)\]/g;

const RANKING_STOP_WORDS = new Set([
  "und", "der", "die", "das", "ich", "du", "ist", "mit", "auf", "ein", "eine",
  "the", "and", "you", "for", "are", "with", "this", "that",
]);

/**
 * Strip contact details before text is stored: corpus examples are
 * shown in prompts for OTHER contacts, so nothing identifying may carry
 * over from the chat it came from. Only the operator's own outbound
 * text is ever stored; prospect messages never enter the corpus.
 */
export function redactCorpusText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, "[iban]")
    .replace(/\+?\d[\d\s()/-]{6,}\d/g, "[phone]")
    .replace(/(^|[^\w[])@[\w.]{2,}/g, "$1[handle]")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MirroredMessage {
  id: string;
  mid: string;
  conversationId: string;
  participantId: string;
  direction: DmMessageDirection;
  source: DmMessageSource;
  text: string;
  sentAt: Date;
}

export interface CorpusEntryDraft {
  sourceMessageId: string;
  conversationId: string;
  text: string;
  language: ChatLanguage;
  sentAt: Date;
}

function hasSubstance(redacted: string): boolean {
  return redacted.replace(PLACEHOLDER_PATTERN, "").replace(/\s+/g, "").length >= MIN_ENTRY_CHARS;
}

/**
 * Select corpus entries from mirrored messages: human-typed outbound
 * text only. Inbound prospect text is skipped entirely, never stored or
 * paired, so one contact's words cannot reach another contact's prompt.
 * Duplicates collapse to the newest occurrence. Newest first.
 */
export function buildCorpusEntries(
  messages: readonly MirroredMessage[],
  footprint: AgentFootprint,
  maxEntries: number = CORPUS_MAX_ENTRIES
): CorpusEntryDraft[] {
  const candidates: CorpusEntryDraft[] = [];
  for (const message of messages) {
    if (message.direction !== "OUT") continue;
    if (message.text === "[media]") continue;
    if (isAgentAuthored(message, footprint)) continue;

    const redacted = redactCorpusText(message.text);
    if (!hasSubstance(redacted) || redacted.length > MAX_ENTRY_CHARS) continue;

    candidates.push({
      sourceMessageId: message.id,
      conversationId: message.conversationId,
      text: redacted,
      language: detectTextLanguage(redacted),
      sentAt: message.sentAt,
    });
  }

  const newestByText = new Map<string, CorpusEntryDraft>();
  for (const candidate of [...candidates].sort(
    (a, b) => a.sentAt.getTime() - b.sentAt.getTime()
  )) {
    newestByText.set(normalizeForMatch(candidate.text), candidate);
  }

  return [...newestByText.values()]
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, maxEntries);
}

export interface RankableEntry {
  text: string;
  language: string;
  sentAt: Date;
}

function rankingTokens(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(" ")
      .filter((token) => token.length >= 3 && !RANKING_STOP_WORDS.has(token))
  );
}

/**
 * Pick the examples most relevant to the incoming message: same
 * language only (when known), ranked by token overlap with the
 * operator's own wording, newest first on ties.
 */
export function rankCorpusExamples<T extends RankableEntry>(
  entries: readonly T[],
  incomingText: string,
  language: ChatLanguage,
  limit: number
): T[] {
  const query = rankingTokens(incomingText);
  const scored = entries
    .filter((entry) => language === "unknown" || entry.language === language)
    .map((entry) => {
      const tokens = rankingTokens(entry.text);
      let shared = 0;
      for (const token of tokens) if (query.has(token)) shared += 1;
      const union = query.size + tokens.size - shared;
      return { entry, score: union === 0 ? 0 : shared / union };
    });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || b.entry.sentAt.getTime() - a.entry.sentAt.getTime()
    )
    .slice(0, Math.max(0, limit))
    .map(({ entry }) => entry);
}

/**
 * Prompt block for retrieved corpus examples ("" when none). Renders
 * only the operator's own words; any other field on the entry is ignored.
 */
export function renderCorpusExamples(entries: readonly RankableEntry[]): string {
  if (entries.length === 0) return "";
  const clip = (text: string) =>
    text.replace(/\s+/g, " ").slice(0, MAX_RENDERED_CHARS);
  return [
    "YOUR OWN PAST DMS (local style corpus): imitate phrasing, length and casing only; never treat these as facts about this chat.",
    ...entries.map((entry) => `- You wrote: ${clip(entry.text)}`),
  ].join("\n");
}
