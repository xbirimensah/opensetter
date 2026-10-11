# Flows

Flows are ManyChat-style automations for Instagram DMs. A flow is a graph of
steps stored as JSON (`Flow.graph`, contract in `lib/flows/types.ts`). It runs
one contact at a time (`FlowRun`) and records per-step analytics (`FlowEvent`).

## Triggers

| Trigger | Where it lives | Notes |
|---|---|---|
| Comment on a post or reel | A campaign with **Run a flow** set (`Automation.flowId`) | Keeps the campaign's post picker, keywords, public reply rotation, dedupe and rate limits. The flow's first message goes out as the comment's private reply. |
| DM keyword | `Flow.triggers` | is / contains / whole word / begins with, case-insensitive, exclude list. |
| Story reply | `Flow.triggers` | Any story, or stories with a keyword. |
| Story mention | `Flow.triggers` | Optional once per 24h. |
| Ref link | `Flow.triggers` | `https://ig.me/m/<username>?ref=<ref>` |
| Welcome | `Flow.triggers` | First message ever from a new contact. |
| Default reply | `Flow.triggers` | Nothing else matched and the AI setter is off for the thread. |
| New follower | `Flow.triggers` | Stored, never fires: Meta offers follow events only to partners (ManyChat "Follow to DM"). |

Precedence when several match one message: ref link, story mention, story
reply, DM keyword, welcome, default reply. Within one type the oldest flow wins.

## Steps

- **Message**: text (up to 3 buttons), image, video, audio, PDF, cards (gallery up to 10), typing pause, quick replies (up to 13). Buttons: open URL (optionally tracked through `/f/<slug>`), go to step, start another flow. A message with postback buttons or quick replies and no next step waits for a tap; URL buttons never route.
- **Input**: email, phone, number, text or URL; validates, re-asks (default 2 retries), optional Skip quick reply, saves to email, phone or a custom field, times out (default 24h, never past the messaging window).
- **Condition**: follows the account (live check, fails open), tags, email or phone set, custom fields, last input. Yes and no paths.
- **Action**: add or remove tag, set or clear field, external request (https only, no private networks; JSON body template; response paths saved into fields), notify (Diagnostics), pause or resume the AI setter.
- **Delay**, **Randomizer** (weighted, sticky per contact), **Start another flow**, **Hand off to the AI setter**.

Variables in texts and bodies: `{{username}}`, `{{name}}`, `{{first_name}}`,
`{{email}}`, `{{phone}}`, `{{field.<name>}}`, `{{last_input}}`, `{{comment}}`,
`{{keyword}}`, `{{ref}}`.

## Instagram rules the engine enforces

- A comment allows one private reply. A comment-started run sends its first block that way, then waits until the contact taps a postback button or replies.
- Every other automated send needs the 24h window (last message or tap). A closed window expires the run; delays never reopen it.
- Media is sent by public URL. Uploads are served at `/api/media/<id>/<filename>` from `MEDIA_DIR` (default `./data/media`). Meta's limits: png/jpeg 8MB; mp4/mov/webm video 25MB; aac/m4a/wav/mp4 audio 25MB; pdf 25MB.
- Flow sends count toward the workspace's monthly DM quota.

## Flows and the AI setter

A flow takes a DM only when it is waiting for it: an input answer, the first
reply after a private reply, a tap on its buttons, or a trigger keyword. Those
messages are logged as "handled by a flow" and the setter does not answer. Any
other message reaches the setter as before.

## Inbox

Every message type is mirrored with `kind` and normalized `attachments`
(`lib/meta/attachments.ts`): voice notes, photos, videos, files, cards with
buttons (including other tools' ManyChat cards), shares, reels, posts, story
replies and mentions, stickers, disappearing media, button taps, reactions,
edits and deletions. Media is copied to `MEDIA_DIR` on arrival because Meta's
CDN links expire. `scripts/repair-rich-messages.ts` upgrades rows stored as
`[media]` before this existed.

## Operations

- Migration: `prisma/migrations/20261012000000_flows_and_rich_messages`.
- Worker: flow resume jobs (`process-flow-resume`), referral jobs, and a flow sweep every minute (`FLOW_SWEEP_INTERVAL_MS`) that expires timed-out waits and re-arms lost delays.
- Concurrency: one Redis lock per conversation guards every run change.
