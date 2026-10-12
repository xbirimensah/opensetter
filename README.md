<div align="center">

# OpenSetter

Open source Instagram comment-to-DM automation with an AI DM setter.

Built on top of [OpenReply](https://github.com/diwenne/openreply) by Diwen Huang.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)

</div>

Someone comments `LINK` on your reel and gets your DM a second later. That part is OpenReply, and it works exactly as before. OpenSetter adds what happens next: when the prospect replies, an AI setter answers in your voice, keeps the conversation going, qualifies them, and moves the right people toward a booked call. You stay in control the whole time.

## What the AI setter does

- **Replies in your voice.** The setter drafts short, human DMs grounded in your persona, your goal, and (optionally) real examples of how you actually text, pulled from a style index.
- **Knows your business.** Connect a knowledge base (a Supabase project with your notes, offer docs, and positioning) and the setter retrieves relevant facts before every reply. It never cites the source, it just knows things.
- **Qualifies and books.** You give it a goal ("qualify for the mentorship, book a call") and a booking link. It hands out the link only when the conversation has earned it.
- **Draft mode or autopilot, per thread.** In draft mode every reply waits for your approval; on autopilot, confident replies send themselves and edge cases are held for review (low confidence, sensitive topics, payment or legal questions, walls of text). Each conversation can override the account default, so trusted threads run on autopilot while a delicate one stays in drafts. Held drafts appear right inside the inbox thread: edit, approve, dismiss.
- **AI-personalized campaign openers.** A comment campaign can rewrite its DM text per commenter, referencing their actual comment, in your voice. Links and buttons stay untouched; any failure falls back to your static text.
- **Follow-up nudges.** If a prospect goes quiet, the setter sends one gentle nudge before Instagram's 24h reply window closes. One per window, never more.
- **Steps aside for humans.** Reply to a thread yourself (from the IG app or the dashboard) and the setter backs off.
- **Full audit trail.** Every draft, send, hold, and skip is logged with the model's confidence and reasons.

## How it works

1. Meta delivers the DM to your webhook.
2. The message is mirrored into your own Postgres, so the setter remembers more than Meta's 20-message API window.
3. A short debounce collapses rapid-fire messages into one reply.
4. The worker gathers context: thread history, your own verbatim messages, knowledge-base facts, style examples.
5. One LLM call drafts the reply and rates its own confidence.
6. Safety gates decide: send it, or hold it for your review.
7. Sends respect the same per-account hourly rate limit and workspace quota as campaign DMs.

The LLM provider is pluggable: Anthropic API (default), any OpenAI-compatible endpoint, or a local `claude` / `codex` CLI if you want zero API spend. Retrieval embeddings run locally (no message content leaves your server for embedding).

Everything OpenReply does is still here: keyword campaigns, tracked links, follow gates, workspaces and roles, the inbox, templates, reports, and follower analytics. See the [OpenReply README](https://github.com/diwenne/openreply#readme) for the full feature list.

## Quick start

The fastest path is Docker (web + worker + Postgres + Redis in one command):

```bash
git clone https://github.com/xbirimensah/opensetter.git
cd opensetter
./scripts/setup.sh docker      # writes .env with generated secrets
docker compose up -d --build
```

Then open http://localhost:3000. Two external things are still yours to
bring, both covered step by step in [docs/setup.md](docs/setup.md):

1. A free [Resend](https://resend.com) API key for login emails (paste into `.env`).
2. A Meta developer app (webhook + Instagram login). This is the part that
   takes real time; the guide covers every wrong turn. The Instagram
   account must be Business or Creator, and Meta needs a public HTTPS URL
   for the webhook (Vercel, a VPS, or a Cloudflare tunnel in front of
   this stack).

For the AI setter, set a provider in `.env` (see [docs/ai-setter.md](docs/ai-setter.md)):

```bash
AI_SETTER_PROVIDER=anthropic        # anthropic | openai | claude-cli | codex-cli
AI_SETTER_MODEL=claude-opus-5
ANTHROPIC_API_KEY=sk-ant-...
```

Turn the setter on per account under **AI Setter** in the dashboard: pick draft mode or autopilot, describe who you are and what the goal is, drop your booking link, save. Start in draft mode, approve a few dozen replies, then flip to autopilot when you trust it.

### The knowledge base (2 minutes, no accounts)

Drop markdown files about you and your offer into a folder and run:

```bash
npm run knowledge:ingest -- ./knowledge
```

That builds a local SQLite knowledge base with locally computed embeddings; the setter starts answering from your facts immediately. Prefer something hosted? Apply [schema/knowledge-base.sql](schema/knowledge-base.sql) to a Supabase project, set the two `SECOND_BRAIN_SUPABASE_*` vars, and the same command ingests there instead. Existing knowledge infrastructure can be plugged in via the `SECOND_BRAIN_*_RPC` overrides. Full details in [docs/ai-setter.md](docs/ai-setter.md). If you skip all of this, the setter still works from persona, goal, and chat history alone.

## Credits

OpenSetter is a fork of [OpenReply](https://github.com/diwenne/openreply) by [Diwen Huang](https://github.com/diwenne) (with contributions by Anish Raj), which provides the entire comment-to-DM engine, dashboard, and Meta integration this project stands on. If OpenSetter is useful to you, star their repo too.

The AI reply engine is adapted from a private WhatsApp auto-reply bridge, rebuilt for Instagram on top of OpenReply's queue and worker.

## License

MIT. See [LICENSE](LICENSE).
