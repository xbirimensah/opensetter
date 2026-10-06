/**
 * Private style corpus service.
 *
 * Built only from the local DM mirror (Meta webhook echoes and the
 * official-API reconciler), i.e. the account's own authorized message
 * history. No scraping, no third-party accounts, and nothing leaves the
 * database except the few retrieved examples that go into a draft
 * prompt for the account's own configured model provider.
 */

import { prisma } from "@/lib/db/client";
import { loadAgentFootprint } from "./agent-footprint";
import type { ChatLanguage } from "./language";
import {
  buildCorpusEntries,
  rankCorpusExamples,
  renderCorpusExamples,
  type MirroredMessage,
} from "./style-corpus-core";

/** Newest mirrored messages scanned per rebuild. */
const MIRROR_SCAN_LIMIT = 20_000;
/** Candidate pool for ranking at draft time. */
const RETRIEVAL_POOL = 1500;
const DEFAULT_EXAMPLES = 4;
const STATUS_SAMPLE_SIZE = 12;

export interface StyleCorpusSample {
  id: string;
  text: string;
  language: string;
  sentAt: Date;
}

export interface StyleCorpusStatus {
  entryCount: number;
  conversationCount: number;
  mirroredConversations: number;
  /** Every mirrored DM of the account, both directions. */
  mirroredMessageCount: number;
  /** Mirrored outbound DMs typed by a human: the raw material. */
  humanMessageCount: number;
  coveragePercent: number;
  languages: Record<string, number>;
  oldestMessageAt: Date | null;
  newestMessageAt: Date | null;
  builtAt: Date | null;
  lastMirroredAt: Date | null;
  /** Human-typed outbound messages mirrored since the last rebuild. */
  newHumanMessagesSinceBuild: number;
  isStale: boolean;
  samples: StyleCorpusSample[];
}

export async function getStyleCorpusStatus(
  instagramAccountId: string
): Promise<StyleCorpusStatus> {
  const config = await prisma.aiSetterConfig.findUnique({
    where: { instagramAccountId },
    select: { styleCorpusBuiltAt: true },
  });
  const builtAt = config?.styleCorpusBuiltAt ?? null;

  const [
    entryCount,
    byLanguage,
    byConversation,
    range,
    mirroredConversations,
    lastMirrored,
    newHuman,
    samples,
    mirroredMessageCount,
    humanMessageCount,
  ] = await Promise.all([
      prisma.styleCorpusEntry.count({ where: { instagramAccountId } }),
      prisma.styleCorpusEntry.groupBy({
        by: ["language"],
        where: { instagramAccountId },
        _count: { _all: true },
      }),
      prisma.styleCorpusEntry.groupBy({
        by: ["conversationId"],
        where: { instagramAccountId },
      }),
      prisma.styleCorpusEntry.aggregate({
        where: { instagramAccountId },
        _min: { sentAt: true },
        _max: { sentAt: true },
      }),
      prisma.dmConversation.count({ where: { instagramAccountId } }),
      prisma.dmMessage.findFirst({
        where: { conversation: { instagramAccountId } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.dmMessage.count({
        where: {
          conversation: { instagramAccountId },
          direction: "OUT",
          source: "HUMAN",
          ...(builtAt ? { createdAt: { gt: builtAt } } : {}),
        },
      }),
      prisma.styleCorpusEntry.findMany({
        where: { instagramAccountId },
        orderBy: { sentAt: "desc" },
        take: STATUS_SAMPLE_SIZE,
        select: { id: true, text: true, language: true, sentAt: true },
      }),
      prisma.dmMessage.count({ where: { conversation: { instagramAccountId } } }),
      prisma.dmMessage.count({
        where: { conversation: { instagramAccountId }, direction: "OUT", source: "HUMAN" },
      }),
    ]);

  const conversationCount = byConversation.length;
  return {
    entryCount,
    conversationCount,
    mirroredConversations,
    mirroredMessageCount,
    humanMessageCount,
    coveragePercent:
      mirroredConversations === 0
        ? 0
        : Math.round((conversationCount / mirroredConversations) * 100),
    languages: Object.fromEntries(
      byLanguage.map((row) => [row.language, row._count._all])
    ),
    oldestMessageAt: range._min.sentAt ?? null,
    newestMessageAt: range._max.sentAt ?? null,
    builtAt,
    lastMirroredAt: lastMirrored?.createdAt ?? null,
    newHumanMessagesSinceBuild: newHuman,
    isStale: builtAt === null || newHuman > 0,
    samples,
  };
}

export interface StyleCorpusRebuildSummary {
  previousEntryCount: number;
  entryCount: number;
  /** Mirrored messages read for this rebuild (capped at MIRROR_SCAN_LIMIT). */
  scannedMessages: number;
  durationMs: number;
}

export interface StyleCorpusRebuildOutcome {
  status: StyleCorpusStatus;
  summary: StyleCorpusRebuildSummary;
}

/**
 * Rebuild the corpus from the local mirror. Replaces the previous
 * corpus atomically so a half-built corpus is never visible.
 *
 * The build is stamped with the moment the scan started, not when it
 * finished: a message mirrored while the scan runs is not in this build
 * and must still count as "new since rebuild".
 */
export async function rebuildStyleCorpus(
  instagramAccountId: string
): Promise<StyleCorpusRebuildOutcome> {
  const startedAt = Date.now();
  const builtAt = new Date(startedAt);
  const [rows, footprint, previousEntryCount] = await Promise.all([
    prisma.dmMessage.findMany({
      where: { conversation: { instagramAccountId } },
      orderBy: { sentAt: "desc" },
      take: MIRROR_SCAN_LIMIT,
      select: {
        id: true,
        mid: true,
        conversationId: true,
        direction: true,
        source: true,
        text: true,
        sentAt: true,
        conversation: { select: { participantId: true } },
      },
    }),
    loadAgentFootprint({ instagramAccountId }),
    prisma.styleCorpusEntry.count({ where: { instagramAccountId } }),
  ]);

  const messages: MirroredMessage[] = rows.map((row) => ({
    id: row.id,
    mid: row.mid,
    conversationId: row.conversationId,
    participantId: row.conversation.participantId,
    direction: row.direction,
    source: row.source,
    text: row.text,
    sentAt: row.sentAt,
  }));
  const entries = buildCorpusEntries(messages, footprint);

  await prisma.$transaction([
    prisma.styleCorpusEntry.deleteMany({ where: { instagramAccountId } }),
    prisma.styleCorpusEntry.createMany({
      data: entries.map((entry) => ({
        instagramAccountId,
        conversationId: entry.conversationId,
        sourceMessageId: entry.sourceMessageId,
        text: entry.text,
        language: entry.language,
        sentAt: entry.sentAt,
      })),
    }),
    prisma.aiSetterConfig.upsert({
      where: { instagramAccountId },
      create: { instagramAccountId, styleCorpusBuiltAt: builtAt },
      update: { styleCorpusBuiltAt: builtAt },
    }),
  ]);

  const status = await getStyleCorpusStatus(instagramAccountId);
  return {
    status,
    summary: {
      previousEntryCount,
      entryCount: entries.length,
      scannedMessages: rows.length,
      durationMs: Date.now() - startedAt,
    },
  };
}

/** Retrieve rendered corpus examples for a draft prompt ("" when none). */
export async function fetchCorpusStyleExamples(params: {
  instagramAccountId: string;
  incomingText: string;
  language: ChatLanguage;
  limit?: number;
}): Promise<string> {
  const pool = await prisma.styleCorpusEntry.findMany({
    where: {
      instagramAccountId: params.instagramAccountId,
      ...(params.language !== "unknown" ? { language: params.language } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: RETRIEVAL_POOL,
    select: { text: true, language: true, sentAt: true },
  });
  return renderCorpusExamples(
    rankCorpusExamples(pool, params.incomingText, params.language, params.limit ?? DEFAULT_EXAMPLES)
  );
}
