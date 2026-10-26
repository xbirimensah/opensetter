/**
 * The Contacts page: one row per mirrored conversation, and its CSV
 * export. Rows and CSV are pure; the routes only query and serialize.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { parseCustomFields } from "@/lib/inbox/contact";
import type { ContactFieldValue } from "@/lib/inbox/types";

export interface ContactRowSource {
  id: string;
  participantId: string;
  participantUsername: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: unknown;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
  flowRuns: { flow: { name: string } }[];
}

export interface ContactRow {
  conversationId: string;
  participantId: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: Record<string, ContactFieldValue>;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  firstSeenAt: string;
  /** Name of the running flow, if any. */
  activeFlow: string | null;
}

export function toContactRow(row: ContactRowSource): ContactRow {
  return {
    conversationId: row.id,
    participantId: row.participantId,
    username: row.participantUsername,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    customFields: parseCustomFields(row.customFields),
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
    firstSeenAt: row.createdAt.toISOString(),
    activeFlow: row.flowRuns[0]?.flow.name ?? null,
  };
}

/** Custom field names across rows, in first-seen order. */
export function fieldKeysOf(rows: readonly ContactRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row.customFields)) keys.add(key);
  return [...keys];
}

/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formulas: a
 * value an Instagram user typed ("=HYPERLINK(...)") must never run when
 * the export is opened in Excel or Sheets.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BASE_COLUMNS = [
  "username",
  "instagram_id",
  "email",
  "phone",
  "tags",
  "first_seen",
  "last_message_from_contact",
  "last_message_from_you",
  "active_flow",
] as const;

/** RFC 4180 CSV with a header row; custom fields become extra columns. */
export function contactsToCsv(rows: readonly ContactRow[]): string {
  const fieldKeys = fieldKeysOf(rows);
  const header = [...BASE_COLUMNS, ...fieldKeys.map((key) => `field:${key}`)];
  const lines = rows.map((row) =>
    [
      row.username,
      row.participantId,
      row.email,
      row.phone,
      row.tags.join("; "),
      row.firstSeenAt,
      row.lastInboundAt,
      row.lastOutboundAt,
      row.activeFlow,
      ...fieldKeys.map((key) => row.customFields[key]),
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/** Prisma select for ContactRowSource. */
export const CONTACT_ROW_SELECT = {
  id: true,
  participantId: true,
  participantUsername: true,
  email: true,
  phone: true,
  tags: true,
  customFields: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  createdAt: true,
  flowRuns: {
    where: { status: { in: ["RUNNING", "WAITING"] } },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: { flow: { select: { name: true } } },
  },
} satisfies Prisma.DmConversationSelect;
