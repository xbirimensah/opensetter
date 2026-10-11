/**
 * Display helpers for the inbox UI. Pure and client-safe.
 */

import { describeAttachment } from "@/lib/meta/attachments";
import type { InboxFlowRun, InboxMessage } from "@/lib/inbox/types";

/** Rows mirrored before rich messages existed carry only "[media]". */
export function isLegacyMedia(message: Pick<InboxMessage, "text" | "attachments">): boolean {
  return message.attachments.length === 0 && message.text.trim().toLowerCase() === "[media]";
}

export function isDeleted(message: Pick<InboxMessage, "kind" | "deletedAt">): boolean {
  return message.kind === "deleted" || Boolean(message.deletedAt);
}

const SUMMARY_LINE =
  /^\[(?:photo|video|voice message|file|card|sticker|media|unsupported message|disappearing photo or video|mentioned you in their story|shared (?:link|reel|post|story)|button:)[^\]]*\](?:\s.*)?$/i;

/**
 * The person's own words in a media message. The mirror stores text as
 * "<their text>\n<one summary line per attachment>"; drop the summaries
 * so a story reply shows only what they typed.
 */
export function ownText(message: Pick<InboxMessage, "text" | "attachments">): string {
  const text = message.text.trim();
  const summary = message.attachments.map((a) => describeAttachment(a)).join("\n");
  if (summary && text === summary) return "";
  if (summary && text.endsWith(`\n${summary}`)) {
    return text.slice(0, text.length - summary.length).trim();
  }
  return text
    .split("\n")
    .filter((line) => !SUMMARY_LINE.test(line.trim()))
    .join("\n")
    .trim();
}

/** One-line list preview: "[Voice message]" reads as "Voice message". */
export function previewText(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
      if (!match) return line;
      const [, label, rest] = match;
      const pretty = label.toLowerCase() === "media" ? "Media" : label;
      return rest ? `${pretty}: ${rest}` : pretty;
    });
  return lines.join(" · ") || "(no text)";
}

/** A tapped button is stored as its title, sometimes wrapped as "[Button: X]". */
export function postbackLabel(text: string): string {
  const match = /^\[(?:button|tapped|postback)[^:\]]*:\s*(.+?)\]$/i.exec(text.trim());
  return (match ? match[1] : text).trim() || "Button";
}

export type TextToken = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:'"]+$/;

function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, "");
  // Keep a closing parenthesis only when the URL opened one.
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return url;
}

/** Split text into plain runs and http(s) links. */
export function linkify(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const value = trimUrl(match[0]);
    if (!value) continue;
    if (start > cursor) tokens.push({ type: "text", value: text.slice(cursor, start) });
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    tokens.push({ type: "link", value, href });
    cursor = start + value.length;
  }
  if (cursor < text.length) tokens.push({ type: "text", value: text.slice(cursor) });
  return tokens;
}

/** http(s) only: anything else is never rendered as a clickable href. */
export function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string | undefined | null): string | null {
  const href = safeHref(url);
  if (!href) return null;
  return new URL(href).hostname.replace(/^www\./, "");
}

/** List and bubble timestamps: time today, date otherwise. */
export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Day divider label inside a thread. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** Seconds as m:ss for the voice note player. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const INPUT_LABELS: Record<string, string> = {
  email: "an email address",
  phone: "a phone number",
  number: "a number",
  url: "a link",
  text: "a reply",
};

/** "Waiting for ..." line for the contact panel's flow card. */
export function waitingLabel(run: InboxFlowRun): string {
  if (run.status === "RUNNING" || !run.waiting) return "Sending steps now";
  switch (run.waiting.kind) {
    case "buttons":
      return "Waiting for a button tap";
    case "input":
      return `Waiting for ${INPUT_LABELS[run.waiting.inputType ?? "text"] ?? "a reply"}`;
    case "delay":
      return "Waiting on a delay";
    case "interaction":
      return "Waiting for the first reply";
    default:
      return "Waiting";
  }
}

/** Kinds shown with a small type icon in the conversation list. */
export const MEDIA_PREVIEW_KINDS = new Set([
  "image",
  "video",
  "audio",
  "file",
  "card",
  "share",
  "reel",
  "post",
  "story_reply",
  "story_mention",
  "sticker",
  "ephemeral",
  "deleted",
  "postback",
]);
