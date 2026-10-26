# Integrations

OpenSetter talks to Zapier, Make, n8n or your own code in two directions:

- **Webhooks (out):** signed POSTs when something happens to a contact.
- **API (in):** update a contact or start a flow with an API key.

Both are set up under **Settings > Integrations** and only owners and
admins can see or change them.

## Webhooks

Add an endpoint URL (public `https://` only) and pick the events it gets.
The signing secret (`whsec_...`) is shown once, right after you add it.
"Send test" delivers a `test` event at once and shows the answer.

| Event | When |
|---|---|
| `contact.email_captured` | A flow or a person saved a new email |
| `contact.phone_captured` | A new phone number |
| `contact.tag_added` | One event per tag that was not there before |
| `contact.field_set` | One event per custom field that changed |
| `flow.completed` | A contact reached the end of a flow |
| `ai.draft_held` | The AI setter held a reply for review |

Every delivery looks like this:

```json
{
  "id": "evt_9Qm...",
  "type": "contact.email_captured",
  "createdAt": "2026-10-26T12:00:00.000Z",
  "workspaceId": "cm...",
  "data": {
    "email": "lena@example.com",
    "contact": {
      "conversationId": "cm...",
      "instagramAccountId": "cm...",
      "participantId": "17841400000000000",
      "username": "lena.coach",
      "email": "lena@example.com",
      "phone": null,
      "tags": ["webinar"],
      "customFields": { "budget": 2000 }
    }
  }
}
```

`flow.completed` adds `flow` (`id`, `name`), `runId` and `trigger`;
`ai.draft_held` adds `draft`, `incomingText`, `reasons`, `mode` and
`replyLogId`.

Headers: `X-OpenSetter-Event` (the type), `X-OpenSetter-Delivery` (the
event id, the same on every retry, so use it to drop duplicates) and
`X-OpenSetter-Signature`.

A delivery counts when your endpoint answers 2xx within 10 seconds.
Anything else is retried up to 6 times with exponential backoff starting
at 30 seconds. The last result shows next to the endpoint in Settings.
Redirects are not followed and private network addresses are refused.

### Checking the signature

`X-OpenSetter-Signature: t=<unix seconds>,v1=<hex>` where `v1` is
HMAC-SHA256 of `"<t>.<raw body>"` with your signing secret. Refuse
signatures older than 5 minutes.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Zapier's "Catch Hook" and Make's "Custom webhook" accept the events as
they are; check the signature in a code step if the URL could leak.

## API

Create a key under Settings > Integrations. It is shown once
(`os_...`); only a hash is stored. Send it as
`Authorization: Bearer os_...` (or `X-API-Key`). Each key may make 60
requests a minute. Revoking a key stops it at once.

A contact is named by `contactId` (the Instagram-scoped id from a webhook),
`username` or `email`. Contacts exist once they have messaged your
account. With more than one connected Instagram account, add
`instagramAccountId`.

### `GET /api/v1`

Tests the key and lists the workspace's Instagram accounts and active
flows (for dropdowns in Zapier or Make).

### `GET /api/v1/contacts?username=lena.coach`

Returns `{ "contact": { ... } }` in the webhook shape, or 404.

### `POST /api/v1/contacts`

```json
{
  "contact": { "email": "lena@example.com" },
  "update": {
    "addTags": ["paid"],
    "removeTags": ["lead"],
    "setFields": { "plan": "Mentoring" },
    "unsetFields": ["trial"],
    "phone": "+49 151 2345678"
  }
}
```

The same rules as editing a contact in the inbox. Changes fire the
matching webhooks, so avoid a Zap that re-tags on its own `tag_added`.

### `POST /api/v1/flows/start`

```json
{ "flowId": "cm...", "contact": { "contactId": "17841400000000000" } }
```

Starts an active flow for the contact and answers with `runId`, `status`
and `messagesSent`. Instagram only allows messages within 24 hours of the
contact's last message: outside that window the answer is 409 and nothing
is sent.

Errors are `{ "success": false, "error": "..." }` with 400 (bad input),
401 (key), 404 (flow or contact), 409 (window, inactive flow) or 429
(rate limit).
