/**
 * AI setter processor for the DM worker.
 *
 * Every Instagram DM message event lands here: it is mirrored into the
 * local conversation store first (the setter's memory), then, for
 * inbound messages, run through the gate chain and, when allowed, the
 * draft-and-send pipeline ported from wa-bridge.
 */

import type { Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/app/generated/prisma/client";
import type {
  AiReplyStatus,
  AiSetterConfig,
  DmConversation,
} from "@/app/generated/prisma/client";
import type { ProcessInboundDmJob, ProcessWindowNudgeJob } from "./client";
import { INBOUND_DM_JOB_NAME, getDMQueue } from "./client";
import { generateSetterDraft, generateWindowNudge } from "@/lib/ai-setter/generate";
import { scheduleWindowNudge } from "@/lib/ai-setter/send";
import {
  evaluateAutoSendSafety,
  isTrivialAcknowledgement,
  type VoiceEvidence,
} from "@/lib/ai-setter/safety";
import { sendAiReply } from "@/lib/ai-setter/send";
import type { DraftReply } from "@/lib/ai-setter/types";
import { loadVoiceContext, type VoiceContext } from "@/lib/ai-setter/voice-context";
import {
  languageFromSetting,
  resolveChatLanguage,
  type ChatLanguage,
} from "@/lib/ai-setter/language";
import { captureMessageMedia } from "@/lib/media/inbound";
import { handleInboundForFlows } from "@/lib/flows/service";

// The setter reads the whole thread with this user; each message is
// truncated when rendered, so even long threads stay prompt-sized. The
// ceiling only guards against pathological threads.
const HISTORY_LIMIT = 400;
/** After a human replies manually, the setter stays out this long. */
const HUMAN_TAKEOVER_PAUSE_MS = 6 * 60 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Re-runs of one DM through flows while the conversation is busy. */
const FLOW_RETRY_LIMIT = 3;
const FLOW_RETRY_DELAY_MS = 5_000;
/** Never nudge closer than this to the window actually closing. */
const WINDOW_CLOSE_MARGIN_MS = 30 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function recordSkip(
  conversation: DmConversation,
  accountRecordId: string,
  mid: string,
  text: string,
  reasons: string[]
): Promise<void> {
  await prisma.aiReplyLog
    .create({
      data: {
        conversationId: conversation.id,
        instagramAccountId: accountRecordId,
        inboundMid: mid,
        inboundText: text,
        draftText: "",
        confidence: 0,
        shouldSend: false,
        needsReview: false,
        reasons,
        status: "SKIPPED",
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
}

/**
 * A brand-new contact for "welcome" flows: nothing mirrored before this
 * message, nothing ever sent to them (legacy campaign sends are not
 * mirrored, so DmLog and lastOutboundAt count too), and no earlier flow.
 */
async function isFirstContact(
  conversation: DmConversation,
  accountRecordId: string,
  mirroredId: string
): Promise<boolean> {
  if (conversation.lastOutboundAt) return false;
  const [earlierMessages, campaignLog, flowRun] = await Promise.all([
    prisma.dmMessage.count({ where: { conversationId: conversation.id, id: { not: mirroredId } } }),
    prisma.dmLog.findFirst({
      where: { instagramAccountId: accountRecordId, commenterId: conversation.participantId },
      select: { id: true },
    }),
    prisma.flowRun.findFirst({ where: { conversationId: conversation.id }, select: { id: true } }),
  ]);
  return earlierMessages === 0 && !campaignLog && !flowRun;
}

async function loadHistory(conversationId: string) {
  const recent = await prisma.dmMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return [...recent].reverse().map((message) => ({
    direction: message.direction,
    source: message.source,
    text: message.text,
    sentAt: message.sentAt,
  }));
}

/** Voice inputs plus the language this chat runs in. */
async function loadVoice(
  conversation: Pick<DmConversation, "id" | "participantId" | "instagramAccountId">,
  config: AiSetterConfig,
  incomingText: string
): Promise<{ voice: VoiceContext; chatLanguage: ChatLanguage }> {
  const voice = await loadVoiceContext({
    id: conversation.id,
    participantId: conversation.participantId,
    instagramAccountId: conversation.instagramAccountId,
  });
  const chatLanguage =
    languageFromSetting(config.language) ??
    resolveChatLanguage(incomingText, voice.humanStyleAnchor);
  return { voice, chatLanguage };
}

/** Draft-generation config shared by replies and nudges. */
function draftConfig(config: AiSetterConfig, workspaceId: string) {
  return {
    persona: config.persona,
    goal: config.goal,
    bookingLink: config.bookingLink,
    language: config.language,
    knowledgeEnabled: config.knowledgeEnabled,
    styleExamplesEnabled: config.styleExamplesEnabled,
    minConfidence: config.minConfidence,
    voiceRules: config.voiceRules,
    styleCorpusEnabled: config.styleCorpusEnabled ?? true,
    instagramAccountId: config.instagramAccountId,
    llmSelection: {
      workspaceId,
      provider: config.llmProvider ?? null,
      model: config.llmModel ?? null,
    },
  };
}

interface SafetyContext {
  chatLanguage: ChatLanguage;
  recentAiReplies: string[];
  voiceEvidence: VoiceEvidence;
  allowedLinkHosts: string[];
}

function safetyContextFor(
  voice: VoiceContext,
  chatLanguage: ChatLanguage,
  config: AiSetterConfig
): SafetyContext {
  return {
    chatLanguage,
    recentAiReplies: voice.recentAiReplies,
    voiceEvidence: {
      sameChatHumanMessages: voice.humanStyleAnchor.length,
      corpusEntries: voice.corpusEntryCount,
      strict: config.strictVoiceEvidence ?? false,
    },
    allowedLinkHosts: [config.bookingLink, ...(config.allowedLinkDomains ?? [])].filter(
      (entry): entry is string => Boolean(entry)
    ),
  };
}

/**
 * The draft was produced (this run or a crashed earlier attempt); decide
 * whether to auto-send or hold, then act. Returns the final status.
 */
async function deliverDraft(params: {
  job: Job<ProcessInboundDmJob> | Job<ProcessWindowNudgeJob>;
  config: AiSetterConfig;
  /** Effective mode for this thread (per-thread override or account mode). */
  mode: "DRAFT" | "AUTO";
  replyLogId: string;
  incomingText: string;
  draft: DraftReply;
  /** Thread and anchor for the late-supersede re-check before sending. */
  conversationId: string;
  supersededAfter: Date;
  /** Language, repetition and voice-evidence inputs for the send gate. */
  safetyContext: SafetyContext;
}): Promise<void> {
  const {
    job,
    config,
    mode,
    replyLogId,
    incomingText,
    draft,
    conversationId,
    supersededAfter,
    safetyContext,
  } = params;

  const safety = evaluateAutoSendSafety({
    incomingText,
    draft,
    minConfidence: config.minConfidence,
    ...safetyContext,
  });

  const shouldAutoSend = mode === "AUTO" && safety.allowed;
  if (!shouldAutoSend) {
    const reasons =
      mode === "AUTO"
        ? safety.reasons
        : ["draft mode: every reply is held for review"];
    await prisma.aiReplyLog.update({
      where: { id: replyLogId },
      data: { status: "HELD", reasons: [...draft.reasons, ...reasons] },
    });
    return;
  }

  // Late supersede: the prospect may have written again while the model
  // was generating. The newer message's own job owns the reply; sending
  // this one now would answer a stale conversation state.
  const newerInbound = await prisma.dmMessage.findFirst({
    where: {
      conversationId,
      direction: "IN",
      sentAt: { gt: supersededAfter },
    },
    select: { id: true },
  });
  if (newerInbound) {
    await prisma.aiReplyLog.update({
      where: { id: replyLogId },
      data: {
        status: "SKIPPED",
        reasons: [...draft.reasons, "superseded while the reply was generating"],
      },
    });
    return;
  }

  const result = await sendAiReply({ replyLogId });
  if (result.ok) return;

  // conflict: someone else claimed it; ambiguous: quarantined as HELD by
  // the send path. Neither may be retried from here.
  if (result.error === "conflict" || result.error === "ambiguous") return;

  if (result.error === "quota" || result.error === "rate_limit") {
    // Not retryable within this job; hold so a human can send it later.
    await prisma.aiReplyLog.update({
      where: { id: replyLogId },
      data: {
        status: "HELD",
        reasons: [...draft.reasons, result.message ?? result.error],
      },
    });
    return;
  }

  // Transient send failure: let BullMQ retry; mark FAILED on the last try.
  const maxAttempts = job.opts.attempts ?? 3;
  const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
  if (isFinalAttempt) {
    await prisma.aiReplyLog.update({
      where: { id: replyLogId },
      data: { status: "FAILED" },
    });
  }
  throw new Error(result.message ?? "AI reply send failed");
}

/**
 * Delayed quiet-prospect check. Fires windowNudgeHours after the
 * prospect's last message; if they are still silent, we spoke last, and
 * the 24h window is still open, the setter drafts one gentle follow-up
 * (held for review in draft mode, gated like any reply in auto mode).
 */
export async function processWindowNudge(
  job: Job<ProcessWindowNudgeJob>
): Promise<void> {
  const { conversationId, windowAnchorTs } = job.data;

  const conversation = await prisma.dmConversation.findUnique({
    where: { id: conversationId },
    include: { instagramAccount: { include: { aiSetterConfig: true } } },
  });
  if (!conversation) return;

  const config = conversation.instagramAccount.aiSetterConfig;
  if (!config || !config.windowNudgeEnabled) return;
  const effectiveMode = conversation.modeOverride ?? config.mode;
  if (effectiveMode === "OFF") return;
  if (!conversation.aiEnabled) return;
  // A flow is mid-conversation (waiting for an answer, a tap or a delay):
  // a setter nudge would talk over it.
  const activeFlow = await prisma.flowRun.findFirst({
    where: { conversationId, status: { in: ["RUNNING", "WAITING"] } },
    select: { id: true },
  });
  if (activeFlow) return;

  // The prospect replied since this was scheduled: the newer window has
  // its own job, this one is stale.
  if (
    !conversation.lastInboundAt ||
    conversation.lastInboundAt.getTime() !== windowAnchorTs
  ) {
    return;
  }
  // One nudge per window, even across worker restarts.
  if (
    conversation.lastNudgeAt &&
    conversation.lastNudgeAt.getTime() >= windowAnchorTs
  ) {
    return;
  }
  if (
    config.pauseOnHumanReply &&
    conversation.humanTakeoverAt &&
    conversation.humanTakeoverAt.getTime() >= windowAnchorTs
  ) {
    return;
  }
  if (Date.now() > windowAnchorTs + WINDOW_MS - WINDOW_CLOSE_MARGIN_MS) return;

  // Only nudge when the ball is in their court: our message must be last.
  const lastMessage = await prisma.dmMessage.findFirst({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    select: { direction: true },
  });
  if (!lastMessage || lastMessage.direction !== "OUT") return;

  const workspaceId = conversation.instagramAccount.workspaceId;
  const existing = await prisma.aiReplyLog.findUnique({
    where: { inboundMid: `nudge:${conversationId}:${windowAnchorTs}` },
  });
  if (existing) {
    if (existing.status !== ("PENDING" satisfies AiReplyStatus)) return;
    const resumed = await loadVoice(conversation, config, existing.inboundText);
    await deliverDraft({
      job,
      config,
      mode: effectiveMode,
      replyLogId: existing.id,
      incomingText: existing.inboundText,
      draft: {
        reply: existing.draftText,
        confidence: existing.confidence,
        shouldSend: existing.shouldSend,
        needsReview: existing.needsReview,
        reasons: existing.reasons,
      },
      conversationId,
      supersededAfter: new Date(windowAnchorTs),
      safetyContext: safetyContextFor(resumed.voice, resumed.chatLanguage, config),
    });
    return;
  }

  const history = await loadHistory(conversationId);
  const lastInboundText =
    [...history].reverse().find((message) => message.direction === "IN")
      ?.text ?? "(quiet prospect)";
  const { voice, chatLanguage } = await loadVoice(conversation, config, lastInboundText);
  const quietHours = Math.round((Date.now() - windowAnchorTs) / 3_600_000);
  const draft = await generateWindowNudge({
    participantUsername: conversation.participantUsername,
    history,
    humanStyleAnchor: voice.humanStyleAnchor,
    voiceCorrections: voice.voiceCorrections,
    chatLanguage,
    quietHours,
    config: draftConfig(config, workspaceId),
  });

  let replyLogId: string;
  try {
    const created = await prisma.aiReplyLog.create({
      data: {
        conversationId,
        instagramAccountId: conversation.instagramAccountId,
        inboundMid: `nudge:${conversationId}:${windowAnchorTs}`,
        inboundText: lastInboundText,
        draftText: draft.reply,
        confidence: draft.confidence,
        shouldSend: draft.shouldSend,
        needsReview: draft.needsReview,
        reasons: [...draft.reasons, "window nudge: prospect went quiet"],
        status: "PENDING",
      },
    });
    replyLogId = created.id;
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return;
    throw error;
  }

  await deliverDraft({
    job,
    config,
    mode: effectiveMode,
    replyLogId,
    incomingText: lastInboundText,
    draft,
    conversationId,
    supersededAfter: new Date(windowAnchorTs),
    safetyContext: safetyContextFor(voice, chatLanguage, config),
  });
}

export async function processInboundDm(
  job: Job<ProcessInboundDmJob>
): Promise<void> {
  const { instagramAccountId, participantId, mid, text, isEcho, timestamp } =
    job.data;
  const kind = job.data.kind ?? "text";
  const attachments = job.data.attachments ?? [];

  const account = await prisma.instagramAccount.findUnique({
    where: { instagramId: instagramAccountId },
    include: { aiSetterConfig: true },
  });
  if (!account) return;

  const sentAt = timestamp ? new Date(timestamp) : new Date();

  const conversation = await prisma.dmConversation.upsert({
    where: {
      instagramAccountId_participantId: {
        instagramAccountId: account.id,
        participantId,
      },
    },
    create: {
      instagramAccountId: account.id,
      participantId,
      ...(isEcho ? { lastOutboundAt: sentAt } : { lastInboundAt: sentAt }),
    },
    update: isEcho ? { lastOutboundAt: sentAt } : { lastInboundAt: sentAt },
  });

  // Mirror the message. The unique mid makes webhook redelivery and
  // echoes of our own API sends (already recorded at send time) no-ops.
  async function mirrorMessage(): Promise<string | null> {
    try {
      const created = await prisma.dmMessage.create({
        data: {
          conversationId: conversation.id,
          mid,
          direction: isEcho ? "OUT" : "IN",
          source: isEcho ? "HUMAN" : "PARTICIPANT",
          text,
          kind,
          ...(attachments.length > 0
            ? { attachments: attachments as unknown as Prisma.InputJsonValue }
            : {}),
          replyToMid: job.data.replyToMid ?? null,
          sentAt,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  const alreadyMirrored = job.data.mirrored
    ? await prisma.dmMessage.findUnique({ where: { mid }, select: { id: true } })
    : null;
  const mirroredId = alreadyMirrored?.id ?? (await mirrorMessage());
  if (!mirroredId) return;

  // Keep our own copy of voice notes, photos and videos: Meta's CDN links
  // expire. Best effort; a failed download leaves the CDN URL in place.
  if (attachments.length > 0 && !alreadyMirrored) {
    await captureMessageMedia({
      id: mirroredId,
      conversationId: conversation.id,
      attachments,
    }).catch((error: unknown) => {
      console.error("[AI Setter] Media capture failed:", error);
    });
  }

  const config = account.aiSetterConfig;

  if (isEcho) {
    // A stored echo means the message was NOT one of our API sends: a
    // human replied from the IG app or dashboard.
    if (config?.pauseOnHumanReply) {
      await prisma.dmConversation.update({
        where: { id: conversation.id },
        data: { humanTakeoverAt: sentAt },
      });
    }
    return;
  }

  // Arm the quiet-prospect nudge for this window as soon as the message
  // lands, independent of whether (or how) the setter ends up replying.
  // The processor later verifies that we actually spoke last.
  await scheduleWindowNudge(
    { ...conversation, lastInboundAt: sentAt },
    config ?? null
  ).catch(() => {});

  // ── Flows ───────────────────────────────────────────────────────────────
  // Flows go first: an answer to an input step, a first reply after a
  // comment flow's private reply, a quick-reply tap or a DM keyword belongs
  // to the flow, and the setter must not answer it a second time.
  const effectiveMode = conversation.modeOverride ?? config?.mode ?? "OFF";
  const aiActive = Boolean(config && effectiveMode !== "OFF" && conversation.aiEnabled);
  const humanActive = Boolean(
    config?.pauseOnHumanReply &&
      conversation.humanTakeoverAt &&
      Date.now() - conversation.humanTakeoverAt.getTime() < HUMAN_TAKEOVER_PAUSE_MS
  );
  const flowResult = await handleInboundForFlows({
    account: {
      id: account.id,
      instagramId: account.instagramId,
      workspaceId: account.workspaceId,
      accessToken: account.accessToken,
    },
    conversationId: conversation.id,
    // Flows match what the person typed, never the "[Photo]" style summary.
    text: job.data.rawText ?? (kind === "text" || kind === "quick_reply" ? text : ""),
    kind,
    quickReplyPayload: job.data.quickReplyPayload,
    referralRef: job.data.referralRef,
    isNewContact: await isFirstContact(conversation, account.id, mirroredId),
    aiActive,
    humanActive,
  }).catch((error: unknown) => {
    // Unexpected failure before any flow claimed the message: the setter
    // may still answer it.
    console.error("[Flows] Inbound handling failed:", error);
    return { consumed: false, retry: false };
  });
  if (flowResult.retry) {
    // The flow is mid-pass for this contact. Re-run this DM through flows
    // shortly instead of letting the setter answer it.
    const attempt = (job.data.flowRetry ?? 0) + 1;
    if (attempt <= FLOW_RETRY_LIMIT) {
      await getDMQueue().add(
        INBOUND_DM_JOB_NAME,
        { ...job.data, mirrored: true, flowRetry: attempt },
        { delay: FLOW_RETRY_DELAY_MS * attempt, jobId: `dm_${mid.replace(/[^a-zA-Z0-9_-]/g, "_")}_flow${attempt}` }
      );
    } else {
      console.error(`[Flows] Gave up on ${mid} after ${FLOW_RETRY_LIMIT} busy retries`);
    }
    return;
  }
  if (flowResult.consumed) {
    if (config) {
      await recordSkip(conversation, account.id, mid, text, ["handled by a flow"]);
    }
    return;
  }

  // ── Gate chain ──────────────────────────────────────────────────────────
  if (!config || effectiveMode === "OFF") return;
  if (!conversation.aiEnabled) return;
  if (config.blockedUserIds.includes(participantId)) return;

  if (
    config.pauseOnHumanReply &&
    conversation.humanTakeoverAt &&
    Date.now() - conversation.humanTakeoverAt.getTime() < HUMAN_TAKEOVER_PAUSE_MS
  ) {
    await recordSkip(conversation, account.id, mid, text, [
      "human recently replied in this thread",
    ]);
    return;
  }

  if (isTrivialAcknowledgement(text)) {
    await recordSkip(conversation, account.id, mid, text, [
      "trivial acknowledgement needs no reply",
    ]);
    return;
  }

  // Debounce: if the prospect sent something newer while this job waited,
  // skip; the newest message's job replies with full context.
  const newerInbound = await prisma.dmMessage.findFirst({
    where: {
      conversationId: conversation.id,
      direction: "IN",
      sentAt: { gt: sentAt },
    },
    select: { id: true },
  });
  if (newerInbound) {
    await recordSkip(conversation, account.id, mid, text, [
      "superseded by a newer message",
    ]);
    return;
  }

  // ── Draft ───────────────────────────────────────────────────────────────
  const existing = await prisma.aiReplyLog.findUnique({
    where: { inboundMid: mid },
  });
  if (existing) {
    // A previous attempt crashed after drafting; resume delivery only if
    // it never reached a terminal state.
    if (existing.status !== ("PENDING" satisfies AiReplyStatus)) return;
    const resumed = await loadVoice(conversation, config, text);
    await deliverDraft({
      job,
      config,
      mode: effectiveMode,
      replyLogId: existing.id,
      incomingText: text,
      conversationId: conversation.id,
      supersededAfter: sentAt,
      safetyContext: safetyContextFor(resumed.voice, resumed.chatLanguage, config),
      draft: {
        reply: existing.draftText,
        confidence: existing.confidence,
        shouldSend: existing.shouldSend,
        needsReview: existing.needsReview,
        reasons: existing.reasons,
      },
    });
    return;
  }

  const [history, { voice, chatLanguage }] = await Promise.all([
    loadHistory(conversation.id),
    loadVoice(conversation, config, text),
  ]);
  const draft = await generateSetterDraft({
    incomingText: text,
    participantUsername: conversation.participantUsername,
    history,
    humanStyleAnchor: voice.humanStyleAnchor,
    voiceCorrections: voice.voiceCorrections,
    chatLanguage,
    config: draftConfig(config, account.workspaceId),
  });

  let replyLogId: string;
  try {
    const created = await prisma.aiReplyLog.create({
      data: {
        conversationId: conversation.id,
        instagramAccountId: account.id,
        inboundMid: mid,
        inboundText: text,
        draftText: draft.reply,
        confidence: draft.confidence,
        shouldSend: draft.shouldSend,
        needsReview: draft.needsReview,
        reasons: draft.reasons,
        status: "PENDING",
      },
    });
    replyLogId = created.id;
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return;
    throw error;
  }

  await deliverDraft({
    job,
    config,
    mode: effectiveMode,
    replyLogId,
    incomingText: text,
    draft,
    conversationId: conversation.id,
    supersededAfter: sentAt,
    safetyContext: safetyContextFor(voice, chatLanguage, config),
  });
}
