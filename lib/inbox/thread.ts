/**
 * Client-side thread bookkeeping: merging polled pages, older pages and
 * optimistic sends into one chronological list. Pure.
 */

import type { InboxMessage } from "@/lib/inbox/types";

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Oldest first; ties break on id so order is stable across polls. */
export function sortMessages(messages: InboxMessage[]): InboxMessage[] {
  return [...messages].sort((a, b) => time(a.sentAt) - time(b.sentAt) || a.id.localeCompare(b.id));
}

/**
 * Merge a fetched page into what is shown. Fetched rows replace shown rows
 * with the same id (edits, deletes and reactions update in place), older
 * pages already loaded are kept, and an optimistic send stays until a
 * mirrored message with its mid arrives.
 */
export function mergeMessages(shown: InboxMessage[], fetched: InboxMessage[]): InboxMessage[] {
  const fetchedMids = new Set(fetched.map((m) => m.mid));
  const byId = new Map(
    shown.filter((m) => !(m.pending && fetchedMids.has(m.mid))).map((m) => [m.id, m])
  );
  for (const message of fetched) byId.set(message.id, message);
  return sortMessages([...byId.values()]);
}

/** The cursor for "Load earlier": the oldest mirrored (non-optimistic) message. */
export function oldestCursor(messages: InboxMessage[]): { before: string; beforeId: string } | null {
  const oldest = messages.find((m) => !m.pending);
  return oldest ? { before: oldest.sentAt, beforeId: oldest.id } : null;
}
