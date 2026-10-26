/**
 * Outgoing integration events: the catalog, the payload envelope, the
 * signature, and which events a contact change produces. Pure: no
 * database or network here (see webhooks.ts for delivery).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { parseCustomFields } from "@/lib/inbox/contact";
import type { ContactFieldValue } from "@/lib/inbox/types";
import { isWebhookEvent, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type WebhookEventType } from "./catalog";

export { isWebhookEvent, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type WebhookEventType };

/** The contact as integrations see it. */
export interface ContactSnapshot {
  conversationId: string;
  instagramAccountId: string;
  /** Instagram-scoped user id of the contact. */
  participantId: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: Record<string, ContactFieldValue>;
}

export interface WebhookPayload {
  id: string;
  type: WebhookEventType | "test";
  createdAt: string;
  workspaceId: string;
  data: Record<string, unknown>;
}

export function newEventId(): string {
  return `evt_${randomBytes(12).toString("base64url")}`;
}

export function buildPayload(
  workspaceId: string,
  type: WebhookPayload["type"],
  data: Record<string, unknown>,
  now: Date = new Date()
): WebhookPayload {
  return { id: newEventId(), type, createdAt: now.toISOString(), workspaceId, data };
}

/** Signing secrets are shown once; "whsec_" makes them recognisable. */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export const SIGNATURE_HEADER = "X-OpenSetter-Signature";
/** Receivers should refuse signatures older than this. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Stripe-style signature: HMAC-SHA256 over "<timestamp>.<body>", sent as
 * "t=<unix seconds>,v1=<hex>". The timestamp in the signed string stops
 * replays of an old delivery.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Reference verifier (also documented for receivers in docs/integrations.md). */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    })
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signPayload(secret, body, timestamp).split("v1=")[1], "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface ContactBefore {
  email: string | null;
  phone: string | null;
  tags: string[];
  customFields: unknown;
}

export interface ContactAfter {
  email?: string | null;
  phone?: string | null;
  tags?: string[];
  customFields?: unknown;
}

export interface ContactEvent {
  type: Extract<WebhookEventType, `contact.${string}`>;
  data: Record<string, unknown>;
}

/** Events a contact update produces: new email/phone, each added tag, each changed field. */
export function contactChangeEvents(before: ContactBefore, after: ContactAfter): ContactEvent[] {
  const events: ContactEvent[] = [];
  if (after.email && after.email !== before.email) {
    events.push({ type: "contact.email_captured", data: { email: after.email } });
  }
  if (after.phone && after.phone !== before.phone) {
    events.push({ type: "contact.phone_captured", data: { phone: after.phone } });
  }
  if (after.tags) {
    const had = new Set(before.tags.map((tag) => tag.toLowerCase()));
    for (const tag of after.tags) {
      if (!had.has(tag.toLowerCase())) events.push({ type: "contact.tag_added", data: { tag } });
    }
  }
  if (after.customFields !== undefined) {
    const old = parseCustomFields(before.customFields);
    for (const [key, value] of Object.entries(parseCustomFields(after.customFields))) {
      if (old[key] !== value) events.push({ type: "contact.field_set", data: { key, value } });
    }
  }
  return events;
}
