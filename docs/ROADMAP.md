# Roadmap

Features and improvements worth building next, ranked. Each item names
where it lives in the code (or "missing"), a rough size (S, M, L) and any
Meta API limit that shapes it. Tick an item off by moving it to "Done" with
the commit.

## Later: bigger features

### 9. Broadcasts to segments (M to L)
Send to contacts filtered by tag or field, limited to those inside the
messaging window (`lastInboundAt` under 24 h). Missing.
- Meta: no promotional sends outside 24 h. The HUMAN_AGENT tag (7 days) is
  for real human replies only.

### 11. Ice breakers (M)
Up to 4 starter questions shown in a new chat, each one starting a flow,
set through the messenger profile API. Missing.
- Meta: persistent menu support on Instagram is unverified.

### 12. Branch and funnel analytics (M)
The randomizer exists and `FlowEvent` records SENT, CLICKED and so on, but
there is no comparison by branch, no conversion funnel and no booked-call
attribution (no calendar integration).

### 13. Team inbox (M)
Assign conversations to members, internal notes, "needs a human" alerts.
`WorkspaceRole` exists; nothing per conversation.

### 14. Follow-up sequences that wait for a reply (M)
A delay never reopens the messaging window, so the run expires
(`lib/flows/types.ts:202`). Re-arm the sequence when the contact replies.

### Smaller gaps
- **Duplicate flow:** no clone button.
- **Flow versions:** no stored published vs draft snapshot. Unsaved edits
  to a live flow may be lost if the tab closes (unverified).
- **Voice note transcription:** deferred pending a privacy decision
  (`docs/DECISIONS.md` #8).

## Reliability and ops

- **Test gaps (M):** no tests reference `lib/polling/dm-reconciler.ts`,
  `lib/polling/comment-reconciler.ts`, `lib/flows/lock.ts`,
  `lib/meta/message-updates.ts`, `lib/tracking/server.ts`, the cron routes,
  manual send (`app/api/instagram/conversations`) or draft approval
  (`app/api/ai-setter/replies/[id]`). Some may be covered indirectly.
- **Object storage for media (M):** media sits on local disk (`MEDIA_DIR`,
  `docs/DECISIONS.md` #4). An S3 or R2 option is needed to run more than
  one web server.
- **Meta App Review (L, process):** needed only to connect accounts that
  are not app testers. `META_APP_REVIEW.md` covers the comment-reply
  permissions only, and review requires business verification.

## Not possible

- **DM on new follow:** Meta gives follow events to partners only. The
  `new_follower` trigger is stored but never fires.

## Done

Built 2026-10-26 on `flows`, verified on a clone of the live database
(745 tests, production build, browser run, real webhook deliveries).

- Link check on AI drafts, with a per-account domain allowlist (fa13634)
- 8 s deadline on opener personalization, `AI_SETTER_OPENER_TIMEOUT_MS`
  (1cb60ac, 0a3f143)
- Prompt caching for Anthropic (1cb60ac)
- Health, worker and token refresh alerts: ntfy, Telegram, webhook,
  email (ae7414c); docs/operations.md
- Backup script for the database and media, with rotation (40274ad)
- AI opener for comments that start a flow (d0ab34b)
- Inbox search and filters (4866c17)
- Contacts page with CSV export (1f44c63)
- Signed outgoing webhooks and the `/api/v1` API with keys (b89b307);
  docs/integrations.md
