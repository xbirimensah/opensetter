# Flows

Flows are ManyChat-style automations for Instagram DMs. A flow is a graph of
steps stored as JSON (`Flow.graph`, contract in `lib/flows/types.ts`). It runs
one contact at a time (`FlowRun`) and records per-step analytics (`FlowEvent`).

## Triggers

| Trigger | Where it lives | Notes |
|---|---|---|
| Comment on a post or reel | An `Automation` row with `flowId` = the flow, edited as a trigger in the flow editor | The flow API merges these rows into the trigger list (`type: "comment"`) and syncs them back on save. Keeps the comment pipeline: keyword matching, public reply rotation, dedupe, quota, rate limits, DmLog stats and share reports. The flow's first message goes out as the comment's private reply. |
| DM keyword | `Flow.triggers` | is / contains / whole word / begins with, case-insensitive, exclude list. |
| Story reply | `Flow.triggers` | Any story, or stories with a keyword. |
| Story mention | `Flow.triggers` | Optional once per 24h. |
| Ref link | `Flow.triggers` | `https://ig.me/m/<username>?ref=<ref>` |
| Welcome | `Flow.triggers` | First message ever from a new contact. |
| Default reply | `Flow.triggers` | Nothing else matched and the AI setter is off for the thread. |
| New follower | `Flow.triggers` | Stored, never fires: Meta offers follow events only to partners (ManyChat "Follow to DM"). |

Precedence when several match one message: ref link, story mention, story
reply, DM keyword, welcome, default reply. Within one type the oldest flow wins.

### Comment triggers and their Automation rows

Campaigns are merged into flows: there is one "Flows" list, and a comment
campaign is a flow's comment trigger. Storage did not change.

- `GET /api/flows/:id` returns the flow's Automation rows first in
  `triggers` (`{ type: "comment", automationId, postId, postUrl,
  matchAnyPost, pendingNextReel, keywords, matchAnyWord, wholeWordMatch,
  publicReplyEnabled, publicReplyMessages }`) plus `triggerVersions`.
- `PUT /api/flows/:id` splits the list: comment triggers are synced to
  Automation rows (create, update only the changed columns, delete the
  dropped ones) in the same transaction as the flow
  (`lib/flows/comment-triggers.ts`, `planCommentTriggerSync`). New rows get
  `dmMessage: ""`, the flow's account and a name from the flow name; rows
  are renamed only when the flow is renamed. An automationId that is not
  linked to this flow is never reused. A row changed elsewhere since the
  editor loaded it (the next-reel cron binding a reel) returns 409 with the
  fresh row instead of being overwritten.
- `Automation.isActive` follows the flow: ACTIVE = true, DRAFT and PAUSED =
  false. Only rows that disagree are touched.
- Comment triggers are validated like the campaign API (zod: up to 10
  keywords of 50 characters, up to 10 public replies of 1000, https
  instagram.com post links) and block going live until they have a post
  choice, a keyword (or "any comment") and reply text when replies are on.
- Deleting a flow deletes its comment triggers in the same transaction, so
  no campaign ever falls back to the classic DM pipeline.
- `PATCH /api/automations` refuses edits to a flow's comment trigger (409)
  apart from the share-report toggle.
- Campaigns without a flow ("Classic") are listed on the Flows page and
  open the old campaign editor. Nothing converts them automatically.
- Old links: `/campaigns` goes to `/flows`; `/campaigns/new?template=<slug>`
  (public template pages, through login) creates a draft flow from the
  template (`lib/flows/template-flow.ts`); `/campaigns/new?flowId=` opens
  the flow with a new comment trigger; `/campaigns/:id` stays as the
  trigger's stats view; `/campaigns/:id/edit` of a flow trigger opens the
  flow. The CSV import still uses the classic builder (`?import=1`).

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

## Editor

A canvas (`@xyflow/react`, `components/flows/canvas/`): the "When..."
trigger card, one card per step, curved connections from output handles
(buttons, quick replies, branches, "Next Step") to steps. Dragging a handle
onto a card connects it; dropping it on empty canvas opens the step menu
and creates the step connected. Positions are stored on `node.position`
(and `graph.triggerPosition`); steps without one are laid out left to
right by depth. The selected card is edited in a floating sidebar (a
bottom sheet on phones) that reuses the step editors.

The draft (graph, triggers, name) is one undo history (Cmd+Z, Shift+Cmd+Z).
Drafts and paused flows autosave; a live flow keeps its edits until
"Publish", so half-typed text never reaches leads. "Set Live" and
"Publish" run the same checks as the API and list blocking problems in the
sidebar instead of going live.

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
