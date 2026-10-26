# The AI Setter

This is the complete guide to OpenSetter's AI layer: what it does, how to
configure it, and how each safety mechanism behaves. For hosting and the
Meta app, read [setup.md](setup.md) first.

## What it does

When a prospect DMs your connected Instagram account, the setter drafts a
reply in your voice: grounded in your persona, your goal, the whole
conversation history, and (optionally) your knowledge base. Depending on
mode, the reply sends itself or waits for your approval.

Two campaign-side extras:

- **AI-personalized openers**: a campaign can rewrite its DM text per
  commenter, referencing their actual comment. Toggle it per campaign in
  the builder. Links, buttons, and follow gates work exactly as before;
  any model failure falls back to your static text.
- **Window nudges**: Instagram only lets a business reply within 24 hours
  of the prospect's last message. With nudges enabled, a prospect who
  goes quiet gets one gentle follow-up before the window closes (default
  after 20 quiet hours). One nudge per window, never more.

## Modes

Set the account default on the AI Setter page:

| Mode | Behavior |
| --- | --- |
| Off | Messages are mirrored, nothing is drafted. |
| Draft | Every reply is drafted and held for review. |
| Autopilot | Confident replies send themselves; edge cases are held. |

Every conversation can override the account default from the inbox
(thread header): account default, autopilot, drafts only, or off. That
lets you run trusted threads on autopilot while a sensitive one stays in
draft mode.

Held drafts appear in two places: inline in the inbox thread (edit,
approve, dismiss right where the conversation is) and on the AI Setter
page's review queue.

### Who can change what

Settings that decide whether, when, and to whom the setter sends on its
own are limited to workspace owners and admins: mode, the confidence
threshold, reply delay, the human-takeover pause, window nudges (on/off
and timing), the blocklist, strict voice evidence, and the model
provider. If a member tries to change any of them, the whole save is
rejected with a 403 that names the fields, and nothing is written.
Members can still edit persona, goal, booking link, language, knowledge
and style toggles, and voice rules, as long as the sending settings stay
as they are. For an account with no saved config, the defaults
(mode Off) count as the current values.

The same rule covers the per-thread mode in the inbox. Members can pause
a thread, switch the AI off for it, or move it to drafts, but cannot pin
a thread to Auto or make it auto-send by resetting it to an Auto account
default or re-enabling it (403). A member's change also never clears a
human takeover pause; only owners and admins resume a taken-over thread
immediately.

## Safety gates

Before an automatic send, all of these must pass; anything that fails
holds the draft for review with the reason attached:

- model confidence at or above your threshold (default 78%)
- the model itself did not ask for review
- no sensitive topics in either direction (payments, legal, medical,
  credentials; German and English patterns)
- draft under Instagram's length limit; inbound message not a wall of text
- every link in the draft points at the booking link's domain or a domain
  you allowed under "Other allowed link domains" (a link the model made up
  is held)

Independent of mode, the setter never replies when: the thread's AI is
off, the sender is blocklisted, the message is a bare acknowledgement
("ok", "danke"), a newer message from the same person supersedes it, or
you replied manually in the last hours ("step aside for humans").
Manual replies are detected via message echoes, so replying from the
Instagram app pauses the setter too.

## LLM providers

Set in the environment (worker):

```bash
AI_SETTER_PROVIDER=anthropic   # anthropic | openai | claude-cli | codex-cli
AI_SETTER_MODEL=claude-opus-5
ANTHROPIC_API_KEY=sk-ant-...
```

- `anthropic`: the default. Uses the Messages API.
- `openai`: any OpenAI-compatible endpoint (`AI_SETTER_BASE_URL`,
  `OPENAI_API_KEY`). Works with local inference servers on localhost.
- `claude-cli` / `codex-cli`: shell out to a locally installed `claude`
  or `codex` binary. Zero API spend if you have a subscription. The
  binary must be logged in under the user the worker runs as. Without
  `AI_SETTER_MODEL` no `--model` flag is passed, so the CLI's own
  default model runs.

`AI_SETTER_API_KEY` works as a generic fallback key for either API
provider.

### Providers from the UI (Models tab)

Owners and admins can save keys for Anthropic, OpenAI (Responses API,
so Codex-class models work), Google Gemini, xAI, OpenRouter, or any
OpenAI-compatible endpoint, then pick a provider and model per account.
Nothing selected means the env provider above runs, unchanged.

- Keys are encrypted at rest with AES-256-GCM using
  `AI_CREDENTIALS_ENCRYPTION_KEY` (separate from `ENCRYPTION_KEY`), bound
  to workspace and provider. The browser never sees a key again after
  saving; the UI shows a short SHA-256 fingerprint instead.
- Without a valid `AI_CREDENTIALS_ENCRYPTION_KEY`, saving is disabled
  and an account that selected a UI provider fails closed (no draft)
  rather than silently using another provider.
- Custom base URLs must be https and public. Set
  `AI_PROVIDER_ALLOW_PRIVATE_BASE_URL=true` to allow local models.

### Local CLIs from the UI (no API key)

Claude Code and Codex installed on the server show up in the Models tab
as their own providers, selectable per account without any key. The tab
shows for each CLI whether it is installed (`--version`), signed in
(`claude auth status`, `codex login status`; only the login method and
plan are shown, never the account email) and which models it offers:

- Codex: the models `codex debug models` lists as visible.
- Claude Code: there is no list command, so the options are the aliases
  `claude --help` documents for `--model` (e.g. `opus`, `sonnet`), each
  resolving to the newest model of that family.
- "CLI default" passes no `--model`; "Custom model id" accepts any id the
  CLI serves (letters, digits and `. _ : / @ [ ] -`, starting with a
  letter or digit, so an id can never be read as a flag).

Discovery is cached for a minute; "Check again" re-runs it. The chosen
CLI drafts replies, follow-up nudges and personalized campaign openers.
The binary must be installed and logged in for the user both the web
app and the worker run as. `AI_SETTER_CLI_PROVIDERS=off` hides CLIs from
the UI and makes accounts that selected one fail closed, for setups where
workspaces must not share the server's CLI subscription.

## Sprachprofil (voice)

- **Voice rules**: the style guide every draft follows, editable in the
  UI. Safety rules stay fixed on top.
- **Same-chat anchor**: your hand-typed messages in the thread. Echoes
  of AI replies, campaign DMs (matched by send window, template text and
  tracked links) and edited AI drafts are filtered out; the setter never
  learns from its own output.
- **Style corpus**: rebuilt on demand from the locally mirrored DMs of
  the account (webhook echoes plus the official-API reconciler; nothing
  is fetched from other accounts). The card shows how many DMs are
  mirrored and how many are hand-typed, so an empty mirror (e.g. after
  disconnecting and reconnecting the Instagram account, since disconnect
  deletes its mirror, or while its token is expired) is visible instead
  of looking like a failed rebuild. If the rebuild response is lost (proxy timeout, phone left
  the page), the card asks the server for the corpus status until the
  rebuild is confirmed done, still running, or not applied. Only human-typed outbound text, with
  emails, phone numbers, IBANs, links and @handles redacted. Prospect
  messages are never stored in the corpus or shown in prompts: examples
  are reused across contacts, so only your own wording is kept. Drafts
  get a few examples in the chat's language, ranked by word overlap
  with the new incoming message.
- **Corrections per contact**: "don't say / say instead / note" pairs
  that apply only to drafts for that contact. Editing a held draft
  before approving records one automatically.
- **Guards before any auto-send**: chat language match, no repeat of a
  recent AI reply in the thread, no trivial or emoji-only replies, and
  no commitment to a date, time, price, discount, payment, refund or
  meeting place. Without any human voice evidence (no hand-typed
  messages in the chat and an empty corpus) drafts are held. Strict mode
  holds whenever the chat itself has no hand-typed message.

## The knowledge base

Optional but transformative: the setter answers from facts about you,
your offer, and your positioning instead of improvising. Two backends,
picked automatically:

### Local SQLite (zero accounts, 2 minutes)

1. Create a folder of markdown files: who you are, what you sell, FAQs,
   objection handling, results.
2. Run:

```bash
npm run knowledge:ingest -- ./knowledge
```

That writes `./data/knowledge.db` (override with
`SECOND_BRAIN_SQLITE_PATH`). Embeddings are computed locally; nothing
leaves your machine. Re-run after editing your files. The setter picks
the file up automatically; no restart needed for content updates.

### Supabase (shared, remote, full-text + vector search)

1. Apply [schema/knowledge-base.sql](../schema/knowledge-base.sql) to a
   Supabase project (SQL editor).
2. Set env on web and worker:

```bash
SECOND_BRAIN_SUPABASE_URL=https://xxx.supabase.co
SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY=...
```

3. Ingest the same way; with these vars set the script writes to
   Supabase instead.

Already have your own knowledge tables? Point the setter at existing
RPCs with `SECOND_BRAIN_HYBRID_SEARCH_RPC`, `SECOND_BRAIN_STYLE_SEARCH_RPC`,
and `SECOND_BRAIN_DOCUMENTS_TABLE`. The expected signatures are in
[schema/knowledge-base.sql](../schema/knowledge-base.sql).

### Second-brain API (self-hosted knowledge base)

If your knowledge lives in a self-hosted second-brain vault, point the setter at its
REST API instead of Supabase. The API embeds queries server-side, so no
local embedding model is loaded on this path.

```bash
SECOND_BRAIN_BACKEND=brain-api
# BRAIN_API_URL=http://127.0.0.1:8790
# BRAIN_API_TOKEN=...            (or leave unset and use the token file)
# BRAIN_API_TOKEN_FILE=~/.config/opensetter/brain-api-token
```

Use the read-only search-scoped token (`token-search`). The token file
must be owner-only (`chmod 600`); a group- or world-readable file is
refused. `BRAIN_API_URL` must be loopback over http (`127.0.0.1`,
`localhost`, `::1`) or https; anything else is refused with a
`CONFIG_ERROR` and the token is never sent.

Knowledge uses `POST /v1/search` (hybrid, `text_chars: 1000` per hit,
mapped from `text`, falling back to `snippet`), style memory uses
`POST /v1/style/search`; only the operator's outbound text is mapped
out of the style response. `npm run knowledge:ingest` refuses in this
mode: add files to the vault instead. Keep the Supabase vars in place
and unset `SECOND_BRAIN_BACKEND` to roll back.

### Retrieval health

Retrieval fails open (a reply still goes out), so every backend logs
loudly instead:

- `[ai-setter][retrieval] RETRIEVAL_ERROR backend=... kind=knowledge|style reason=...`
  on errors, non-2xx responses, a missing token, or an unavailable embedder
- `[ai-setter][retrieval] RETRIEVAL_EMPTY backend=... kind=...` when a
  lookup yields nothing usable
- `[ai-setter][retrieval] HEALTH backend=... ok=...` once at worker start

`npm run knowledge:check -- "a query"` runs one knowledge and one style
lookup with the current env and exits non-zero on an unhealthy backend
or an empty result (`--show` also prints the rendered blocks).

### Style memory

A second, isolated index of your real replies teaches the setter how you
actually text (register, length, slang). It is retrieved as phrasing
examples only, never as facts. Only your own outbound text reaches the
prompt, re-redacted (emails, links, phones, handles, IBANs) and without
automation-authored replies; the prospect message a reply answered is
never sent to the model, since it belongs to a different contact. Supabase or
brain API backend only; see the `opensetter_style_examples` table in the schema. If you
skip it, the setter still anchors on your verbatim messages within each
thread.

### Embeddings

Both retrieval and ingest use a local multilingual model
(`paraphrase-multilingual-MiniLM-L12-v2`, 384 dimensions) via
Transformers.js. First run downloads the model to the HuggingFace cache.
`AI_SETTER_EMBEDDINGS=off` disables embeddings entirely (keyword search
takes over where possible).

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_SETTER_PROVIDER` | `anthropic` | LLM backend |
| `AI_SETTER_MODEL` | per provider | Model id |
| `AI_SETTER_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AI_SETTER_API_KEY` | - | Credentials |
| `AI_SETTER_CLAUDE_BIN` / `AI_SETTER_CODEX_BIN` | `claude` / `codex` | CLI binaries |
| `AI_SETTER_CLI_PROVIDERS` | on | `off` hides local CLIs from the Models tab and refuses them at runtime |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | - | 32-byte hex; encrypts provider keys saved in the UI |
| `AI_PROVIDER_ALLOW_PRIVATE_BASE_URL` | off | `true` allows private/local base URLs for UI providers |
| `SECOND_BRAIN_BACKEND` | auto | `brain-api`, `supabase`, or `sqlite`; unset picks Supabase when configured, else SQLite |
| `BRAIN_API_URL` | `http://127.0.0.1:8790` | Second-brain API base URL; loopback http or https only |
| `BRAIN_API_TOKEN` | - | Brain API bearer token (wins over the token file) |
| `BRAIN_API_TOKEN_FILE` | `~/.config/opensetter/brain-api-token` | File holding the read-only search token; must be mode 600 |
| `BRAIN_API_SEARCH_FOLDERS` | - | Optional comma list limiting knowledge search to vault folders |
| `SECOND_BRAIN_SQLITE_PATH` | `./data/knowledge.db` | Local knowledge base file |
| `SECOND_BRAIN_SUPABASE_URL` | - | Supabase knowledge base |
| `SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY` | - | Supabase credentials |
| `SECOND_BRAIN_HYBRID_SEARCH_RPC` | `opensetter_hybrid_search` | Custom RPC name |
| `SECOND_BRAIN_STYLE_SEARCH_RPC` | `opensetter_style_search` | Custom RPC name |
| `SECOND_BRAIN_DOCUMENTS_TABLE` | `opensetter_documents` | Full-text fallback table |
| `SECOND_BRAIN_EMBEDDING_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Embedding model |
| `AI_SETTER_EMBEDDINGS` | on | `off` disables local embeddings |

## Operational notes

- All AI activity is logged (`AiReplyLog`): draft text, confidence, the
  model's own reasons, and every gate that held a reply back.
- Sends share the campaign pipeline's per-account hourly rate limit and
  workspace quota.
- The debounce (default 10s, per account) collapses rapid-fire messages
  into one reply, and a second supersede check runs after generation, so
  a prospect who double-texts mid-draft never gets a stale answer.
- **No double sends.** A draft is atomically claimed (SENDING) before
  the Meta call; concurrent approvals, job retries, and crash-resumes
  all back off. If the process dies mid-send or the network drops with
  the outcome unknown, the draft is quarantined as HELD with a warning
  to check the Instagram thread; nothing ambiguous is ever auto-retried.
- **Missed webhooks heal themselves.** A reconciliation sweep (default
  every 10 minutes, `DM_POLL_INTERVAL_MS`) backfills the local mirror
  from Meta's Conversations API and routes a missed, still-answerable
  prospect message through the normal pipeline.
- Nudges are armed when the prospect's message arrives, not when the
  setter replies, so windows where you replied by hand still nudge.
- **Editing drafts teaches the setter.** An approval you edited before
  sending is recorded as your own voice and feeds the style anchor of
  every future draft in that thread (and is flagged `humanEdited` for
  threshold tuning).
- Knowledge retrieval embeds the last few thread turns together with the
  newest message, so short follow-ups ("how much is it?") still retrieve
  the right facts.
- Instagram's 24h window is enforced by Meta: an approved draft whose
  window closed will fail with Meta's own error, visible on the draft.
