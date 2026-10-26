/**
 * The webhook event catalog. No imports, so the Settings page (a client
 * component) can use it without pulling server code into the bundle.
 */

export const WEBHOOK_EVENTS = [
  "contact.email_captured",
  "contact.phone_captured",
  "contact.tag_added",
  "contact.field_set",
  "flow.completed",
  "ai.draft_held",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  "contact.email_captured": "Email captured",
  "contact.phone_captured": "Phone captured",
  "contact.tag_added": "Tag added",
  "contact.field_set": "Custom field set",
  "flow.completed": "Flow completed",
  "ai.draft_held": "AI draft held for review",
};

export function isWebhookEvent(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
