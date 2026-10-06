/**
 * Load everything the account's automation sent, so human-vs-agent
 * authorship can be decided for mirrored outbound messages. Scoped to
 * one conversation for drafting, or the whole account for corpus builds.
 */

import { prisma } from "@/lib/db/client";
import {
  buildTemplateFingerprints,
  normalizeForMatch,
  type AgentFootprint,
  type CampaignWindow,
} from "./authorship";

/** Campaign DMs go out shortly after the DmLog row is created. */
const CAMPAIGN_WINDOW_BEFORE_MS = 60 * 1000;
const CAMPAIGN_WINDOW_AFTER_MS = 5 * 60 * 1000;

export async function loadAgentFootprint(scope: {
  instagramAccountId: string;
  conversationId?: string;
  participantId?: string;
}): Promise<AgentFootprint> {
  const [aiReplies, dmLogs, automations] = await Promise.all([
    prisma.aiReplyLog.findMany({
      where: {
        instagramAccountId: scope.instagramAccountId,
        status: "SENT",
        ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
      },
      select: { sentMid: true, draftText: true, conversationId: true },
    }),
    prisma.dmLog.findMany({
      where: {
        instagramAccountId: scope.instagramAccountId,
        ...(scope.participantId ? { commenterId: scope.participantId } : {}),
      },
      select: { commenterId: true, createdAt: true, dmSentAt: true },
    }),
    prisma.automation.findMany({
      where: { instagramAccountId: scope.instagramAccountId },
      select: {
        dmMessage: true,
        openingDmMessage: true,
        followPromptMessage: true,
        followUpMessage: true,
      },
    }),
  ]);

  const aiSentMids = new Set<string>();
  const aiSentTextsByConversation = new Map<string, Set<string>>();
  for (const reply of aiReplies) {
    if (reply.sentMid) aiSentMids.add(reply.sentMid);
    const texts = aiSentTextsByConversation.get(reply.conversationId) ?? new Set<string>();
    texts.add(normalizeForMatch(reply.draftText));
    aiSentTextsByConversation.set(reply.conversationId, texts);
  }

  const campaignWindowsByParticipant = new Map<string, CampaignWindow[]>();
  for (const log of dmLogs) {
    const windows = campaignWindowsByParticipant.get(log.commenterId) ?? [];
    const end = (log.dmSentAt ?? log.createdAt).getTime() + CAMPAIGN_WINDOW_AFTER_MS;
    windows.push({
      start: new Date(log.createdAt.getTime() - CAMPAIGN_WINDOW_BEFORE_MS),
      end: new Date(end),
    });
    campaignWindowsByParticipant.set(log.commenterId, windows);
  }

  return {
    aiSentMids,
    aiSentTextsByConversation,
    campaignWindowsByParticipant,
    templateFingerprints: buildTemplateFingerprints(
      automations.flatMap((automation) => [
        automation.dmMessage,
        automation.openingDmMessage,
        automation.followPromptMessage,
        automation.followUpMessage,
      ])
    ),
  };
}
