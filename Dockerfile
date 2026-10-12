# OpenSetter web + worker image. One image, two commands:
#   web    (default): migrate, then serve the dashboard and webhook
#   worker:           docker compose runs `npx tsx worker/dm-worker.ts`
#
# bookworm-slim (glibc) rather than alpine: the local embedding runtime
# (onnxruntime via @huggingface/transformers) ships native binaries that
# do not run on musl.
FROM node:22-bookworm-slim

WORKDIR /app

# OpenSSL is required by Prisma's query engine at runtime.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The build needs no live database; this placeholder is overridden by the
# real DATABASE_URL from the environment at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Run as the unprivileged "node" user; it only needs to write the media
# folder and Next's runtime cache.
RUN mkdir -p /app/data/media && chown -R node:node /app/data /app/.next
USER node

CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
