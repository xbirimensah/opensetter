/**
 * Which flow (if any) an inbound DM event should start. Pure: the caller
 * loads ACTIVE flows and the contact's state.
 *
 * Precedence (mirrors ManyChat): ref link > story mention > story reply >
 * DM keyword > welcome > default reply. Within one type the oldest flow wins.
 */

import type { FlowTrigger, KeywordMatch } from "./types";

export interface TriggerCandidate {
  flowId: string;
  createdAt: Date;
  triggers: FlowTrigger[];
}

export type InboundEvent =
  | {
      type: "message";
      text: string;
      isStoryReply: boolean;
      isStoryMention: boolean;
      isNewContact: boolean;
      aiActive: boolean;
    }
  | { type: "referral"; ref: string };

export interface TriggerHit {
  flowId: string;
  trigger: FlowTrigger;
  keyword?: string;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the first keyword that matches, or null. Case-insensitive. */
export function matchKeyword(
  text: string,
  keywords: string[],
  mode: KeywordMatch
): string | null {
  const haystack = normalize(text);
  for (const raw of keywords) {
    const keyword = normalize(raw);
    if (!keyword) continue;
    switch (mode) {
      case "is":
        if (haystack === keyword) return raw;
        break;
      case "begins_with":
        if (haystack.startsWith(keyword)) return raw;
        break;
      case "contains":
        if (haystack.includes(keyword)) return raw;
        break;
      case "whole_word": {
        // Letters/digits in any script count as word characters.
        const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(keyword)}($|[^\\p{L}\\p{N}])`, "u");
        if (pattern.test(haystack)) return raw;
        break;
      }
    }
  }
  return null;
}

const ORDER: FlowTrigger["type"][] = [
  "ref_link",
  "story_mention",
  "story_reply",
  "dm_keyword",
  "welcome",
  "default_reply",
];

function hitFor(trigger: FlowTrigger, event: InboundEvent): { keyword?: string } | null {
  if (event.type === "referral") {
    return trigger.type === "ref_link" && normalize(trigger.ref) === normalize(event.ref)
      ? {}
      : null;
  }
  switch (trigger.type) {
    case "story_mention":
      return event.isStoryMention ? {} : null;
    case "story_reply": {
      if (!event.isStoryReply) return null;
      const keywords = trigger.keywords ?? [];
      if (keywords.length === 0) return {};
      const keyword = matchKeyword(event.text, keywords, trigger.match ?? "contains");
      return keyword ? { keyword } : null;
    }
    case "dm_keyword": {
      if (event.isStoryMention) return null;
      if (trigger.excludeKeywords?.length && matchKeyword(event.text, trigger.excludeKeywords, "contains")) {
        return null;
      }
      const keyword = matchKeyword(event.text, trigger.keywords, trigger.match);
      return keyword ? { keyword } : null;
    }
    case "welcome":
      return event.isNewContact ? {} : null;
    case "default_reply":
      return event.aiActive ? null : {};
    default:
      return null;
  }
}

export function pickTrigger(
  candidates: TriggerCandidate[],
  event: InboundEvent
): TriggerHit | null {
  const sorted = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const type of ORDER) {
    for (const candidate of sorted) {
      for (const trigger of candidate.triggers) {
        if (trigger.type !== type) continue;
        const hit = hitFor(trigger, event);
        if (hit) return { flowId: candidate.flowId, trigger, ...hit };
      }
    }
  }
  return null;
}
