/**
 * Outgoing webhooks: queue an event for every endpoint that subscribed to
 * it, then deliver each one as a signed POST from the worker with retries.
 *
 * Emitting never throws and never blocks the caller for long: an
 * integration that is down must not break a flow or an inbox edit.
 */

import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getDMQueue, WEBHOOK_JOB_NAME, type DeliverWebhookJob } from "@/lib/queue/client";
import { safeRequest } from "@/lib/flows/safe-http";
import {
  buildPayload,
  contactChangeEvents,
  SIGNATURE_HEADER,
  signPayload,
  type ContactAfter,
  type ContactBefore,
  type ContactSnapshot,
  type WebhookEventType,
  type WebhookPayload,
} from "./events";
import { parseCustomFields } from "@/lib/inbox/contact";

/** Deliveries per event and endpoint, with exponential backoff from 30 s. */
const DELIVERY_ATTEMPTS = 6;
const FIRST_RETRY_MS = 30_000;
const MAX_ERROR_CHARS = 300;

/** Queue one event for every active endpoint of the workspace subscribed to it. */
export async function emitWebhookEvent(
  workspaceId: string,
  type: WebhookEventType,
  data: Record<string, unknown>
): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { workspaceId, isActive: true, events: { has: type } },
      select: { id: true },
    });
    if (endpoints.length === 0) return 0;
    const payload = buildPayload(workspaceId, type, data);
    await enqueueDeliveries(endpoints.map((endpoint) => endpoint.id), payload);
    return endpoints.length;
  } catch (error) {
    console.error(`[webhooks] could not queue ${type}:`, error instanceof Error ? error.message : error);
    return 0;
  }
}

async function enqueueDeliveries(endpointIds: string[], payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const queue = getDMQueue();
  await Promise.all(
    endpointIds.map((endpointId) =>
      queue.add(
        WEBHOOK_JOB_NAME,
        { endpointId, body, eventId: payload.id } satisfies DeliverWebhookJob,
        {
          jobId: `webhook_${payload.id}_${endpointId}`,
          attempts: DELIVERY_ATTEMPTS,
          backoff: { type: "exponential", delay: FIRST_RETRY_MS },
        }
      )
    )
  );
}

/** The contact snapshot every contact event carries. */
export async function loadContactSnapshot(conversationId: string): Promise<(ContactSnapshot & { workspaceId: string }) | null> {
  const row = await prisma.dmConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      instagramAccountId: true,
      participantId: true,
      participantUsername: true,
      email: true,
      phone: true,
      tags: true,
      customFields: true,
      instagramAccount: { select: { workspaceId: true } },
    },
  });
  if (!row) return null;
  return {
    workspaceId: row.instagramAccount.workspaceId,
    conversationId: row.id,
    instagramAccountId: row.instagramAccountId,
    participantId: row.participantId,
    username: row.participantUsername,
    email: row.email,
    phone: row.phone,
    tags: row.tags,
    customFields: parseCustomFields(row.customFields),
  };
}

/** The snapshot as integrations receive it (the workspace id is in the envelope). */
export function withoutWorkspace(snapshot: ContactSnapshot & { workspaceId: string }): ContactSnapshot {
  return {
    conversationId: snapshot.conversationId,
    instagramAccountId: snapshot.instagramAccountId,
    participantId: snapshot.participantId,
    username: snapshot.username,
    email: snapshot.email,
    phone: snapshot.phone,
    tags: snapshot.tags,
    customFields: snapshot.customFields,
  };
}

/**
 * After a contact update: emit email/phone/tag/field events for what
 * changed. Nothing changed means no query at all; otherwise one read for
 * the snapshot and one per event for the subscribed endpoints.
 */
export async function emitContactChanges(
  conversationId: string,
  before: ContactBefore,
  after: ContactAfter
): Promise<void> {
  try {
    const events = contactChangeEvents(before, after);
    if (events.length === 0) return;
    const snapshot = await loadContactSnapshot(conversationId);
    if (!snapshot) return;
    const contact = withoutWorkspace(snapshot);
    for (const event of events) {
      await emitWebhookEvent(snapshot.workspaceId, event.type, { ...event.data, contact });
    }
  } catch (error) {
    console.error("[webhooks] contact events failed:", error instanceof Error ? error.message : error);
  }
}

/** Emit an event about one conversation's contact (flow completed, draft held). */
export async function emitConversationEvent(
  conversationId: string,
  type: Exclude<WebhookEventType, `contact.${string}`>,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const snapshot = await loadContactSnapshot(conversationId);
    if (!snapshot) return;
    await emitWebhookEvent(snapshot.workspaceId, type, { ...data, contact: withoutWorkspace(snapshot) });
  } catch (error) {
    console.error(`[webhooks] ${type} failed:`, error instanceof Error ? error.message : error);
  }
}

function headersFor(secret: string, body: string, eventId: string, type: string, now: Date): Record<string, string> {
  return {
    [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(now.getTime() / 1000)),
    "X-OpenSetter-Event": type,
    "X-OpenSetter-Delivery": eventId,
  };
}

export interface DeliveryResult {
  ok: boolean;
  status: number;
  error: string | null;
}

/** One POST to one endpoint, recorded on the endpoint row. Never throws. */
export async function postToEndpoint(
  endpoint: { id: string; url: string; secret: string },
  body: string,
  meta: { eventId: string; type: string },
  now: Date = new Date()
): Promise<DeliveryResult> {
  let result: DeliveryResult;
  try {
    const response = await safeRequest({
      url: endpoint.url,
      method: "POST",
      body,
      headers: headersFor(decryptToken(endpoint.secret), body, meta.eventId, meta.type, now),
    });
    result = { ok: response.ok, status: response.status, error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    result = { ok: false, status: 0, error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS) };
  }
  await prisma.webhookEndpoint
    .update({
      where: { id: endpoint.id },
      data: { lastDeliveryAt: now, lastStatus: result.status, lastError: result.error },
    })
    .catch(() => undefined);
  return result;
}

/** Worker side: deliver one queued event; a failure throws so BullMQ retries. */
export async function deliverWebhook(job: DeliverWebhookJob): Promise<void> {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: job.endpointId },
    select: { id: true, url: true, secret: true, isActive: true },
  });
  // Deleted or paused since the event was queued: drop it quietly.
  if (!endpoint || !endpoint.isActive) return;
  const type = (JSON.parse(job.body) as { type?: string }).type ?? "unknown";
  const result = await postToEndpoint(endpoint, job.body, { eventId: job.eventId, type });
  if (!result.ok) throw new Error(`Webhook ${endpoint.id} failed: ${result.error}`);
}

/** Settings "Send test": one immediate, unqueued delivery. */
export async function sendTestEvent(endpoint: { id: string; url: string; secret: string; workspaceId: string }): Promise<DeliveryResult> {
  const payload = buildPayload(endpoint.workspaceId, "test", {
    message: "Test event from OpenSetter. Your endpoint is connected.",
  });
  return postToEndpoint(endpoint, JSON.stringify(payload), { eventId: payload.id, type: "test" });
}
