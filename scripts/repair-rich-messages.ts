/**
 * One-off repair for messages mirrored before rich mirroring existed.
 *
 * Those rows have text "[media]" and kind "text": voice notes, photos,
 * ManyChat cards and shares that the inbox could not show. This script:
 *
 *  1. Graph API pass: for every conversation with such rows, reads the
 *     thread (Meta returns full content for the ~20 newest messages) and
 *     rewrites matching rows with kind, attachments and a readable text.
 *     Fresh CDN URLs here mean voice notes and photos can be downloaded.
 *  2. Webhook pass: for rows still unrepaired, finds the raw webhook that
 *     delivered them (WebhookEvent keeps payloads) and normalizes that.
 *     Old CDN URLs may have expired, so downloads can fail; the row still
 *     gets its kind, card text and buttons.
 *  3. Downloads media (MEDIA_DIR) for every repaired row that has any.
 *
 * Usage (from the app folder, with its .env):
 *   npx tsx --env-file=.env scripts/repair-rich-messages.ts [--dry-run] [--skip-graph]
 *
 * Safe to re-run: only rows whose text is still "[media]" are touched.
 */

import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { getConversationMessages, getConversations } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  hasGraphContent,
  normalizeGraphMessage,
  normalizeWebhookMessage,
  type NormalizedDm,
} from "@/lib/meta/attachments";
import { captureMessageMedia } from "@/lib/media/inbound";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_GRAPH = process.argv.includes("--skip-graph");

async function applyRepair(mid: string, normalized: NormalizedDm): Promise<boolean> {
  const row = await prisma.dmMessage.findUnique({
    where: { mid },
    select: { id: true, conversationId: true, text: true },
  });
  if (!row || row.text !== "[media]") return false;
  if (DRY_RUN) {
    console.log(`  would repair ${mid.slice(0, 24)}… → ${normalized.kind}: ${normalized.text.slice(0, 60).replace(/\n/g, " / ")}`);
    return true;
  }
  await prisma.dmMessage.update({
    where: { id: row.id },
    data: {
      text: normalized.text,
      kind: normalized.kind,
      ...(normalized.attachments.length > 0
        ? { attachments: normalized.attachments as unknown as Prisma.InputJsonValue }
        : {}),
      ...(normalized.replyToMid ? { replyToMid: normalized.replyToMid } : {}),
    },
  });
  if (normalized.attachments.length > 0) {
    await captureMessageMedia({
      id: row.id,
      conversationId: row.conversationId,
      attachments: normalized.attachments,
    }).catch(() => 0);
  }
  return true;
}

async function graphPass(): Promise<number> {
  let repaired = 0;
  const accounts = await prisma.instagramAccount.findMany({
    select: { id: true, instagramId: true, username: true, accessToken: true },
  });
  for (const account of accounts) {
    const broken = await prisma.dmConversation.findMany({
      where: { instagramAccountId: account.id, messages: { some: { text: "[media]" } } },
      select: { participantId: true },
    });
    if (broken.length === 0) continue;
    const wanted = new Set(broken.map((c) => c.participantId));
    console.log(`@${account.username}: ${wanted.size} conversation(s) with "[media]" rows`);

    const token = decryptToken(account.accessToken);
    const threads = await getConversations(token, account.instagramId);
    for (const thread of threads) {
      const contact = thread.participants?.data?.find((p) => p.id !== account.instagramId);
      if (!contact?.id || !wanted.has(contact.id)) continue;
      const messages = await getConversationMessages(token, thread.id);
      for (const message of messages) {
        if (!message.id || !hasGraphContent(message)) continue;
        if (await applyRepair(message.id, normalizeGraphMessage(message))) repaired += 1;
      }
    }
  }
  return repaired;
}

interface RawMessaging {
  message?: { mid?: string } & Record<string, unknown>;
}

async function webhookPass(): Promise<number> {
  const remaining = await prisma.dmMessage.findMany({
    where: { text: "[media]" },
    select: { mid: true },
  });
  if (remaining.length === 0) return 0;
  const wanted = new Set(remaining.map((r) => r.mid));
  console.log(`Webhook pass: ${wanted.size} row(s) left`);

  let repaired = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.webhookEvent.findMany({
      where: { object: "instagram" },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, payload: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const event of batch) {
      const entries = (event.payload as { entry?: { messaging?: RawMessaging[] }[] } | null)?.entry ?? [];
      for (const entry of entries) {
        for (const messaging of entry.messaging ?? []) {
          const mid = messaging.message?.mid;
          if (!mid || !wanted.has(mid)) continue;
          wanted.delete(mid);
          if (await applyRepair(mid, normalizeWebhookMessage(messaging.message))) repaired += 1;
        }
      }
    }
    if (wanted.size === 0) break;
  }
  console.log(`Webhook pass: ${wanted.size} row(s) had no stored payload`);
  return repaired;
}

async function main() {
  const before = await prisma.dmMessage.count({ where: { text: "[media]" } });
  console.log(`${before} "[media]" row(s) to repair${DRY_RUN ? " (dry run)" : ""}`);
  const viaGraph = SKIP_GRAPH ? 0 : await graphPass();
  const viaWebhook = await webhookPass();
  const after = await prisma.dmMessage.count({ where: { text: "[media]" } });
  console.log(`Repaired ${viaGraph} via Graph API, ${viaWebhook} via stored webhooks; ${after} left`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
