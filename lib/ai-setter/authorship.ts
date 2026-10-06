/**
 * Human vs agent authorship for outbound DMs.
 *
 * Every outbound Instagram message comes back as an echo, and echoes of
 * API sends (campaign DMs, AI openers, an AI reply whose echo beat the
 * send path's own mirror write) can land in the local mirror as
 * source=HUMAN. Training the voice on those would teach the setter its
 * own output. This classifier errs toward "agent": dropping a genuine
 * human message from the corpus costs nothing, keeping an agent message
 * corrupts the voice.
 */

import type { DmMessageSource } from "@/app/generated/prisma/client";

/** Shortest template prefix worth matching; shorter ones collide with real speech. */
const MIN_FINGERPRINT_CHARS = 12;
const FINGERPRINT_CHARS = 40;
/** Tracked campaign links (/r/<slug>) only ever come from automations. */
const TRACKED_LINK_PATTERN = /\/r\/[A-Za-z0-9_-]{4,}/;

export interface CampaignWindow {
  start: Date;
  end: Date;
}

export interface AgentFootprint {
  /** Meta mids of every message the AI setter sent. */
  aiSentMids: ReadonlySet<string>;
  /** Normalized texts the AI setter sent, per conversation id. */
  aiSentTextsByConversation: ReadonlyMap<string, ReadonlySet<string>>;
  /** Time windows in which a campaign DM went to a participant. */
  campaignWindowsByParticipant: ReadonlyMap<string, readonly CampaignWindow[]>;
  /** Normalized prefixes of the account's automation message templates. */
  templateFingerprints: readonly string[];
}

export interface OutboundMessage {
  mid: string;
  text: string;
  sentAt: Date;
  source: DmMessageSource;
  conversationId: string;
  participantId: string;
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Template prefixes with {link}/{username}-style placeholders removed. */
export function buildTemplateFingerprints(
  templates: ReadonlyArray<string | null | undefined>
): string[] {
  const fingerprints = new Set<string>();
  for (const template of templates) {
    if (!template) continue;
    const head = template.split(/\{[^}]*\}/)[0] ?? "";
    const normalized = normalizeForMatch(head).slice(0, FINGERPRINT_CHARS).trim();
    if (normalized.length >= MIN_FINGERPRINT_CHARS) fingerprints.add(normalized);
  }
  return [...fingerprints];
}

/** Text markers only automations produce (tracked campaign links). */
export function hasAutomationMarker(text: string): boolean {
  return TRACKED_LINK_PATTERN.test(text);
}

export function isAgentAuthored(
  message: OutboundMessage,
  footprint: AgentFootprint
): boolean {
  if (message.source !== "HUMAN") return true;
  if (footprint.aiSentMids.has(message.mid)) return true;

  const normalized = normalizeForMatch(message.text);
  if (footprint.aiSentTextsByConversation.get(message.conversationId)?.has(normalized)) {
    return true;
  }
  if (hasAutomationMarker(message.text)) return true;
  if (footprint.templateFingerprints.some((fingerprint) => normalized.startsWith(fingerprint))) {
    return true;
  }

  const windows = footprint.campaignWindowsByParticipant.get(message.participantId) ?? [];
  const at = message.sentAt.getTime();
  return windows.some(
    (window) => at >= window.start.getTime() && at <= window.end.getTime()
  );
}
