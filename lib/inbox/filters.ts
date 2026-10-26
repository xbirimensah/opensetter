/**
 * Contact and conversation filters shared by the inbox list search and
 * the Contacts page: query parsing (pure) and the Prisma where clause.
 */

import type { Prisma } from "@/app/generated/prisma/client";

export const FILTER_LIMITS = {
  queryMax: 100,
  tagMax: 50,
  fieldKeyMax: 60,
  fieldValueMax: 200,
} as const;

/** Conversation states the inbox can narrow to. */
export const INBOX_STATUSES = ["needs_reply", "held_draft", "active_flow"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export interface ContactFilter {
  /** Matches @username, email, phone and (inbox only) message text. */
  q?: string;
  tag?: string;
  status?: InboxStatus;
  hasEmail?: boolean;
  hasPhone?: boolean;
  /** Custom field equality, e.g. budget = 2k. */
  field?: { key: string; value: string };
}

const FIELD_KEY = /^[\w .-]+$/;

function clean(value: string | null, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** Read filters from URL search params; unknown or malformed values are dropped. */
export function parseContactFilter(params: URLSearchParams): ContactFilter {
  const filter: ContactFilter = {};
  const q = clean(params.get("q"), FILTER_LIMITS.queryMax);
  if (q) filter.q = q;
  const tag = clean(params.get("tag"), FILTER_LIMITS.tagMax);
  if (tag) filter.tag = tag;
  const status = params.get("status");
  if (status && (INBOX_STATUSES as readonly string[]).includes(status)) filter.status = status as InboxStatus;
  if (params.get("hasEmail") === "1") filter.hasEmail = true;
  if (params.get("hasPhone") === "1") filter.hasPhone = true;
  const key = clean(params.get("fieldKey"), FILTER_LIMITS.fieldKeyMax);
  const value = clean(params.get("fieldValue"), FILTER_LIMITS.fieldValueMax);
  if (key && value !== undefined && FIELD_KEY.test(key)) filter.field = { key, value };
  return filter;
}

/** "Needs reply" and the like are inbox states, not contact properties. */
export function withoutInboxStatus(filter: ContactFilter): ContactFilter {
  return { ...filter, status: undefined };
}

export function hasActiveFilter(filter: ContactFilter): boolean {
  return Boolean(filter.q || filter.tag || filter.status || filter.hasEmail || filter.hasPhone || filter.field);
}

/** Leading @ is how people type handles; the stored username has none. */
function handleQuery(q: string): string {
  return q.replace(/^@+/, "");
}

/**
 * Where clause for DmConversation in one account. `searchMessages` adds
 * message text to the free-text search (the inbox does, the contact list
 * does not). "needs_reply" is decided on the last message by the caller.
 */
export function conversationWhere(
  instagramAccountId: string,
  filter: ContactFilter,
  options: { searchMessages?: boolean } = {}
): Prisma.DmConversationWhereInput {
  const and: Prisma.DmConversationWhereInput[] = [{ instagramAccountId }];
  if (filter.q) {
    const contains = { contains: filter.q, mode: "insensitive" as const };
    const or: Prisma.DmConversationWhereInput[] = [
      { participantUsername: { contains: handleQuery(filter.q), mode: "insensitive" } },
      { email: contains },
      { phone: contains },
      // Contacts page deep links search by the Instagram-scoped id.
      { participantId: filter.q },
    ];
    if (options.searchMessages) or.push({ messages: { some: { text: contains, deletedAt: null } } });
    and.push({ OR: or });
  }
  if (filter.tag) and.push({ tags: { has: filter.tag } });
  if (filter.hasEmail) and.push({ email: { not: null } });
  if (filter.hasPhone) and.push({ phone: { not: null } });
  if (filter.field) {
    const { key, value } = filter.field;
    const typed = coerceFieldValue(value);
    // "01234" may be stored as text or a flow may have saved 1234: match both.
    and.push({
      OR: [
        { customFields: { path: [key], equals: value } },
        ...(typed !== value ? [{ customFields: { path: [key], equals: typed } }] : []),
      ],
    });
  }
  if (filter.status === "held_draft") and.push({ aiReplies: { some: { status: "HELD" } } });
  if (filter.status === "active_flow") and.push({ flowRuns: { some: { status: { in: ["RUNNING", "WAITING"] } } } });
  return { AND: and };
}

/** Custom fields store numbers and booleans natively; match the typed value. */
export function coerceFieldValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Search params for a filter (the inverse of parseContactFilter). */
export function contactFilterParams(filter: ContactFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.status) params.set("status", filter.status);
  if (filter.hasEmail) params.set("hasEmail", "1");
  if (filter.hasPhone) params.set("hasPhone", "1");
  if (filter.field) {
    params.set("fieldKey", filter.field.key);
    params.set("fieldValue", filter.field.value);
  }
  return params;
}
