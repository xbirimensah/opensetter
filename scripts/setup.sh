#!/bin/sh
# Generate a .env with fresh secrets.
#
#   ./scripts/setup.sh          # host mode: databases on localhost
#   ./scripts/setup.sh docker   # compose mode: databases at postgres/redis
#
# Existing .env files are never overwritten.

set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists; not touching it."
  exit 0
fi

MODE="${1:-host}"
if [ "$MODE" = "docker" ]; then
  DATABASE_URL="postgresql://postgres:postgres@postgres:5432/opensetter"
  REDIS_URL="redis://redis:6379"
else
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opensetter"
  REDIS_URL="redis://localhost:6379"
fi

rand() { openssl rand -hex "$1"; }

cat > .env << EOF
# App
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(rand 32)
CRON_SECRET=$(rand 24)
ENCRYPTION_KEY=$(rand 32)

# Database / queue
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}

# Email magic links (Resend) - https://resend.com, free tier is enough
RESEND_API_KEY=
EMAIL_FROM="OpenSetter <onboarding@resend.dev>"

# Meta / Instagram - see docs/setup.md
META_GRAPH_API_VERSION=v25.0
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
FACEBOOK_APP_SECRET=
WEBHOOK_VERIFY_TOKEN=$(rand 16)

# AI setter - see docs/ai-setter.md
# Provider: anthropic | openai | claude-cli | codex-cli
AI_SETTER_PROVIDER=anthropic
AI_SETTER_MODEL=claude-opus-5
ANTHROPIC_API_KEY=
# Encrypts provider keys saved in the AI Setter UI
AI_CREDENTIALS_ENCRYPTION_KEY=$(rand 32)

# Knowledge base (optional) - see docs/ai-setter.md
SECOND_BRAIN_SUPABASE_URL=
SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY=
EOF

chmod 600 .env
echo "Wrote .env (${MODE} mode) with generated secrets."
echo "Fill in RESEND_API_KEY, the Meta values (docs/setup.md), and your LLM key (docs/ai-setter.md)."
