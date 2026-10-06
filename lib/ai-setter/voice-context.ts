/**
 * Per-thread voice inputs for a draft: the owner's verbatim human-typed
 * messages in this chat (agent echoes filtered out), the setter's own
 * recent replies for repetition protection, the contact-scoped
 * corrections, and how much corpus evidence exists.
 */

import { prisma } from "@/lib/db/client";
import { loadAgentFootprint } from "./agent-footprint";
import { isAgentAuthored } from "./authorship";
import { formatVoiceCorrections, MAX_CORRECTIONS_PER_PROMPT } from "./voice-corrections";

const STYLE_ANCHOR_LIMIT = 50;
/** Over-fetch so filtering out agent echoes still leaves a full anchor. */
const STYLE_ANCHOR_SCAN = 120;
const RECENT_AI_REPLY_LIMIT = 12;

export interface VoiceContext {
  /** Verbatim human-typed owner messages in this chat, oldest first. */
  humanStyleAnchor: string[];
  /** The setter's own sent replies in this chat, oldest first. */
  recentAiReplies: string[];
  /** Rendered contact-scoped corrections, oldest first. */
  voiceCorrections: string[];
  corpusEntryCount: number;
}

export async function loadVoiceContext(conversation: {
  id: string;
  participantId: string;
  instagramAccountId: string;
}): Promise<VoiceContext> {
  const [humanRows, footprint, recentAi, corrections, corpusEntryCount] =
    await Promise.all([
      prisma.dmMessage.findMany({
        where: { conversationId: conversation.id, direction: "OUT", source: "HUMAN" },
        orderBy: { sentAt: "desc" },
        take: STYLE_ANCHOR_SCAN,
        select: { mid: true, text: true, sentAt: true, source: true },
      }),
      loadAgentFootprint({
        instagramAccountId: conversation.instagramAccountId,
        conversationId: conversation.id,
        participantId: conversation.participantId,
      }),
      prisma.aiReplyLog.findMany({
        where: { conversationId: conversation.id, status: "SENT" },
        orderBy: { sentAt: "desc" },
        take: RECENT_AI_REPLY_LIMIT,
        select: { draftText: true },
      }),
      prisma.voiceCorrection.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: MAX_CORRECTIONS_PER_PROMPT,
        select: { avoidText: true, preferText: true, note: true },
      }),
      prisma.styleCorpusEntry.count({
        where: { instagramAccountId: conversation.instagramAccountId },
      }),
    ]);

  const humanStyleAnchor = humanRows
    .filter(
      (row) =>
        row.text !== "[media]" &&
        !isAgentAuthored(
          {
            ...row,
            conversationId: conversation.id,
            participantId: conversation.participantId,
          },
          footprint
        )
    )
    .slice(0, STYLE_ANCHOR_LIMIT)
    .reverse()
    .map((row) => row.text);

  return {
    humanStyleAnchor,
    recentAiReplies: [...recentAi].reverse().map((row) => row.draftText),
    voiceCorrections: formatVoiceCorrections([...corrections].reverse()),
    corpusEntryCount,
  };
}
