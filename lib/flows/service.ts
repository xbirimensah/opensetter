/**
 * Flow runtime wiring: Prisma persistence, Meta sends, quota, analytics,
 * delayed resumes and per-conversation locking around FlowExecutor.
 *
 * Entry points (called by the DM worker):
 * - startFlowFromComment: a campaign with flowId matched a comment
 * - handleInboundForFlows: a DM arrived (input answers, first replies,
 *   quick-reply taps, DM keyword / story / welcome / default triggers)
 * - handlePostbackForFlows: a flow button was tapped
 * - handleReferralForFlows: someone opened an ig.me ref link
 * - resumeFlowRun: a delay step fired
 * - sweepFlowRuns: periodic expiry and self-healing of lost delay jobs
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/app/generated/prisma/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getUserFollowStatus, sendMessage } from "@/lib/meta/client";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { FLOW_RESUME_JOB_NAME, getDMQueue } from "@/lib/queue/client";
import { publicAssetUrl } from "@/lib/media/storage";
import { getBaseUrl } from "@/lib/env";
import { FlowExecutor, type EngineIO, type RunState, type RunStatus } from "./engine";
import { FlowLockBusyError, withConversationLock } from "./lock";
import { safeRequest } from "./safe-http";
import { pickTrigger, type InboundEvent } from "./trigger-match";
import {
  LIMITS,
  decodeFlowPayload,
  type FlowGraph,
  type FlowRunContext,
  type FlowTrigger,
  type FlowWaiting,
} from "./types";
import type { FlowContact } from "./variables";

export interface FlowAccount {
  id: string;
  instagramId: string;
  workspaceId: string;
  accessToken: string;
}

interface FlowRow {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  graph: FlowGraph;
}

const ACTIVE_STATUSES: RunStatus[] = ["RUNNING", "WAITING"];
const STALE_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function asGraph(value: unknown): FlowGraph {
  const graph = value as FlowGraph | null;
  return {
    startNodeId: graph?.startNodeId ?? null,
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
  };
}

function asTriggers(value: unknown): FlowTrigger[] {
  return Array.isArray(value) ? (value as FlowTrigger[]) : [];
}

function toRunState(row: {
  id: string;
  flowId: string;
  status: string;
  currentNodeId: string | null;
  waiting: unknown;
  retries: number;
  context: unknown;
  sends: number;
  lastError: string | null;
  completedAt: Date | null;
}): RunState {
  return {
    id: row.id,
    flowId: row.flowId,
    status: row.status as RunStatus,
    currentNodeId: row.currentNodeId,
    waiting: (row.waiting as FlowWaiting | null) ?? null,
    retries: row.retries,
    context: ((row.context as FlowRunContext | null) ?? { trigger: "manual" }) as FlowRunContext,
    sends: row.sends,
    lastError: row.lastError,
    completedAt: row.completedAt,
  };
}

async function loadFlow(flowId: string): Promise<FlowRow | null> {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, name: true, graph: true, status: true },
  });
  if (!flow) return null;
  return { id: flow.id, name: flow.name, status: flow.status, graph: asGraph(flow.graph) };
}

async function loadContact(conversationId: string): Promise<FlowContact | null> {
  const conversation = await prisma.dmConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participantId: true,
      participantUsername: true,
      email: true,
      phone: true,
      tags: true,
      customFields: true,
      lastInboundAt: true,
      aiEnabled: true,
    },
  });
  if (!conversation) return null;
  const lastInput = await prisma.dmMessage.findFirst({
    where: { conversationId, direction: "IN", kind: { in: ["text", "quick_reply", "story_reply"] } },
    orderBy: { sentAt: "desc" },
    select: { text: true },
  });
  const fields = conversation.customFields;
  return {
    conversationId: conversation.id,
    participantId: conversation.participantId,
    username: conversation.participantUsername,
    name: null,
    email: conversation.email,
    phone: conversation.phone,
    tags: conversation.tags,
    customFields:
      fields && typeof fields === "object" && !Array.isArray(fields)
        ? (fields as Record<string, string | number | boolean>)
        : {},
    lastInput: lastInput?.text ?? null,
    lastInboundAt: conversation.lastInboundAt,
    aiEnabled: conversation.aiEnabled,
  };
}

function newSlug(): string {
  return randomBytes(6).toString("base64url");
}

/** Pending "start another flow" requests, executed after the lock is released. */
interface Followups {
  flowIds: string[];
}

function buildIO(params: {
  account: FlowAccount;
  conversation: { id: string; participantId: string };
  flow: FlowRow;
  runId: () => string;
  followups: Followups;
}): EngineIO {
  const { account, conversation, flow, followups } = params;
  let token: string | null = null;
  const accessToken = () => (token ??= decryptToken(account.accessToken));

  return {
    now: () => new Date(),
    random: () => Math.random(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    async send(built, opts) {
      const reservation = opts.prepaid ? null : await reserveWorkspaceDMSend(account.workspaceId);
      if (reservation && !reservation.allowed) {
        throw new Error(`Monthly DM limit reached (${reservation.limit})`);
      }
      let result: { message_id: string };
      try {
        result = await sendMessage(
          accessToken(),
          account.instagramId,
          opts.viaComment ? { comment_id: opts.viaComment } : { id: conversation.participantId },
          built.body
        );
      } catch (error) {
        if (reservation) {
          await releaseWorkspaceDMReservation(account.workspaceId, reservation.periodStart).catch(() => {});
        }
        throw error;
      }
      const sentAt = new Date();
      try {
        await prisma.dmMessage.create({
          data: {
            conversationId: conversation.id,
            mid: result.message_id,
            direction: "OUT",
            source: "FLOW",
            kind: built.mirror.kind,
            text: built.mirror.text,
            attachments: built.mirror.attachments as unknown as Prisma.InputJsonValue,
            sentAt,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // The echo beat us to the mirror and was stored as a human message.
        await prisma.dmMessage.updateMany({
          where: { mid: result.message_id, source: "HUMAN" },
          data: {
            source: "FLOW",
            kind: built.mirror.kind,
            text: built.mirror.text,
            attachments: built.mirror.attachments as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await prisma.dmConversation.update({
        where: { id: conversation.id },
        data: { lastOutboundAt: sentAt },
      });
    },

    followsAccount: () => getUserFollowStatus(accessToken(), conversation.participantId),

    async updateContact(patch) {
      await prisma.dmConversation.update({
        where: { id: conversation.id },
        data: {
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.emailCapturedAt ? { emailCapturedAt: patch.emailCapturedAt } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.phoneCapturedAt ? { phoneCapturedAt: patch.phoneCapturedAt } : {}),
          ...(patch.tags ? { tags: patch.tags } : {}),
          ...(patch.customFields
            ? { customFields: patch.customFields as Prisma.InputJsonValue }
            : {}),
        },
      });
    },

    async setAiEnabled(enabled) {
      await prisma.dmConversation.update({
        where: { id: conversation.id },
        data: { aiEnabled: enabled },
      });
    },

    request: (action, body) =>
      safeRequest({ url: action.url, method: action.method ?? "POST", body, headers: action.headers }),

    async notify(message) {
      await prisma.operationalEvent.create({
        data: {
          workspaceId: account.workspaceId,
          source: "WORKER",
          level: "INFO",
          message: `Flow "${flow.name}": ${message}`.slice(0, 500),
          payload: { flowId: flow.id, conversationId: conversation.id },
        },
      });
    },

    async record(type, nodeId, detail) {
      await prisma.flowEvent.create({
        data: {
          flowId: flow.id,
          runId: params.runId(),
          nodeId,
          conversationId: conversation.id,
          type,
          ...(detail ? { detail: detail as Prisma.InputJsonValue } : {}),
        },
      });
    },

    async scheduleResume(nodeId, delayMs) {
      const runId = params.runId();
      await getDMQueue().add(
        FLOW_RESUME_JOB_NAME,
        { runId, nodeId },
        { delay: delayMs, jobId: `flow_${runId}_${nodeId}_${Date.now()}` }
      );
    },

    async startOtherFlow(flowId) {
      followups.flowIds.push(flowId);
    },

    async mediaUrl(mediaId) {
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: mediaId, workspaceId: account.workspaceId },
        select: { id: true, filename: true },
      });
      return asset ? publicAssetUrl(asset) : null;
    },

    async linkUrl(nodeId, buttonId, url) {
      const where = { flowId_nodeId_buttonId: { flowId: flow.id, nodeId, buttonId } };
      let link: { slug: string };
      try {
        link = await prisma.flowLink.upsert({
          where,
          create: { slug: newSlug(), flowId: flow.id, nodeId, buttonId, url },
          update: { url },
          select: { slug: true },
        });
      } catch (error) {
        // Two contacts hit a brand-new tracked button at once: the other
        // insert won, so read its row.
        if (!isUniqueViolation(error)) throw error;
        link = await prisma.flowLink.findUniqueOrThrow({ where, select: { slug: true } });
      }
      return `${getBaseUrl().replace(/\/$/, "")}/f/${link.slug}?c=${conversation.id}`;
    },
  };
}

async function persistRun(state: RunState): Promise<void> {
  await prisma.flowRun.update({
    where: { id: state.id },
    data: {
      status: state.status,
      currentNodeId: state.currentNodeId,
      waiting: state.waiting ? (state.waiting as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      retries: state.retries,
      context: state.context as unknown as Prisma.InputJsonValue,
      sends: state.sends,
      lastError: state.lastError,
      completedAt: state.completedAt,
    },
  });
}

async function cancelActiveRuns(conversationId: string, exceptRunId?: string): Promise<void> {
  const active = await prisma.flowRun.findMany({
    where: { conversationId, status: { in: ACTIVE_STATUSES }, ...(exceptRunId ? { id: { not: exceptRunId } } : {}) },
    select: { id: true, flowId: true, currentNodeId: true },
  });
  if (active.length === 0) return;
  await prisma.flowRun.updateMany({
    where: { id: { in: active.map((r) => r.id) } },
    data: { status: "CANCELLED", waiting: Prisma.DbNull, completedAt: new Date() },
  });
  await prisma.flowEvent.createMany({
    data: active.map((r) => ({
      flowId: r.flowId,
      runId: r.id,
      nodeId: r.currentNodeId ?? "end",
      conversationId,
      type: "CANCELLED" as const,
      detail: { reason: "Another flow started" },
    })),
  });
}

/** Run `op` on an executor for an existing or new run, then persist. */
async function withExecutor(params: {
  account: FlowAccount;
  conversationId: string;
  flow: FlowRow;
  run: RunState;
  op: (executor: FlowExecutor) => Promise<unknown>;
}): Promise<{ state: RunState; followups: Followups }> {
  const contact = await loadContact(params.conversationId);
  if (!contact) throw new Error(`Conversation ${params.conversationId} not found`);
  const followups: Followups = { flowIds: [] };
  const io = buildIO({
    account: params.account,
    conversation: { id: contact.conversationId, participantId: contact.participantId },
    flow: params.flow,
    runId: () => params.run.id,
    followups,
  });
  const executor = new FlowExecutor(params.flow, params.run, contact, io);
  try {
    await params.op(executor);
  } finally {
    await persistRun(executor.getState());
  }
  return { state: executor.getState(), followups };
}

async function createRun(flowId: string, conversationId: string, context: FlowRunContext, sends = 0): Promise<RunState> {
  const row = await prisma.flowRun.create({
    data: {
      flowId,
      conversationId,
      status: "RUNNING",
      context: context as unknown as Prisma.InputJsonValue,
      sends,
    },
  });
  return toRunState(row);
}

async function runFollowups(account: FlowAccount, conversationId: string, from: RunState, followups: Followups) {
  const depth = (from.context.depth ?? 0) + 1;
  for (const flowId of followups.flowIds) {
    if (depth > LIMITS.maxFlowDepth) {
      console.warn(`[Flows] Not starting ${flowId}: more than ${LIMITS.maxFlowDepth} chained flows`);
      continue;
    }
    const notInteracted = from.context.commentId && !from.context.interacted;
    await startFlowForConversation({
      account,
      conversationId,
      flowId,
      context: {
        trigger: "start_flow",
        interacted: Boolean(from.context.interacted),
        depth,
        ...(notInteracted ? { commentId: from.context.commentId } : {}),
      },
      initialSends: notInteracted ? from.sends : 0,
    });
  }
}

/** Start a flow for a contact (cancels the contact's other active runs). */
export async function startFlowForConversation(params: {
  account: FlowAccount;
  conversationId: string;
  flowId: string;
  context: FlowRunContext;
  startNodeId?: string | null;
  initialSends?: number;
}): Promise<RunState | null> {
  const flow = await loadFlow(params.flowId);
  if (!flow) return null;
  // Drafts and paused flows never start; runs already in flight finish.
  if (flow.status !== "ACTIVE") return null;
  const result = await withConversationLock(params.conversationId, async () => {
    await cancelActiveRuns(params.conversationId);
    const run = await createRun(flow.id, params.conversationId, params.context, params.initialSends ?? 0);
    return withExecutor({
      account: params.account,
      conversationId: params.conversationId,
      flow,
      run,
      op: (executor) => executor.start(params.startNodeId),
    });
  });
  await runFollowups(params.account, params.conversationId, result.state, result.followups);
  return result.state;
}

/**
 * Comment matched a campaign that runs a flow. Throws when the private
 * reply could not be sent so the campaign log records the failure and the
 * already reserved DM quota is released by the caller.
 */
export async function startFlowFromComment(params: {
  account: FlowAccount;
  flowId: string;
  automationId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string | null;
  matchedKeyword?: string | null;
}): Promise<RunState> {
  const conversation = await prisma.dmConversation.upsert({
    where: {
      instagramAccountId_participantId: {
        instagramAccountId: params.account.id,
        participantId: params.commenterId,
      },
    },
    create: {
      instagramAccountId: params.account.id,
      participantId: params.commenterId,
      participantUsername: params.commenterName ?? null,
    },
    update: params.commenterName ? { participantUsername: params.commenterName } : {},
  });

  // A retried comment job must not start a second run (Meta allows one
  // private reply per comment, and a second start would cancel the first).
  const existingRun = await prisma.flowRun.findFirst({
    where: {
      conversationId: conversation.id,
      flowId: params.flowId,
      context: { path: ["commentId"], equals: params.commentId },
    },
  });
  if (existingRun) return toRunState(existingRun);

  const flow = await loadFlow(params.flowId);
  if (!flow) throw new Error(`Flow ${params.flowId} not found`);
  if (flow.status !== "ACTIVE") throw new Error(`Flow "${flow.name}" is ${flow.status.toLowerCase()}, not active`);

  const state = await startFlowForConversation({
    account: params.account,
    conversationId: conversation.id,
    flowId: params.flowId,
    context: {
      trigger: "comment",
      commentId: params.commentId,
      commentText: params.commentText,
      automationId: params.automationId,
      keyword: params.matchedKeyword ?? undefined,
      interacted: false,
    },
  });
  if (!state) throw new Error(`Flow ${params.flowId} not found`);
  if (state.status === "FAILED" && state.sends === 0) {
    throw new Error(state.lastError ?? "Flow failed before its first message");
  }
  return state;
}

async function activeRunFor(conversationId: string, flowId?: string) {
  const row = await prisma.flowRun.findFirst({
    where: { conversationId, status: { in: ACTIVE_STATUSES }, ...(flowId ? { flowId } : {}) },
    orderBy: { startedAt: "desc" },
  });
  return row ? toRunState(row) : null;
}

async function tap(account: FlowAccount, conversationId: string, payload: string): Promise<boolean> {
  const decoded = decodeFlowPayload(payload);
  if (!decoded) return false;
  const flow = await loadFlow(decoded.flowId);
  if (!flow) return true; // our payload, but the flow is gone: swallow it

  const result = await withConversationLock(conversationId, async () => {
    let run = await activeRunFor(conversationId, flow.id);
    if (!run) {
      // Old buttons of a paused or draft flow do nothing.
      if (flow.status !== "ACTIVE") return null;
      // Tapping an old button restarts at the tapped step (ManyChat behaviour).
      await cancelActiveRuns(conversationId);
      run = await createRun(flow.id, conversationId, { trigger: "button", interacted: true });
    }
    return withExecutor({
      account,
      conversationId,
      flow,
      run,
      op: (executor) => executor.onTap(decoded.nodeId, decoded.buttonId),
    });
  });
  if (result) await runFollowups(account, conversationId, result.state, result.followups);
  return true;
}

/** A flow button (postback) was tapped. Returns true when it was a flow payload. */
export async function handlePostbackForFlows(params: {
  account: FlowAccount;
  conversationId: string;
  payload: string;
}): Promise<boolean> {
  return tap(params.account, params.conversationId, params.payload);
}

async function recentRun(flowId: string, conversationId: string): Promise<boolean> {
  const since = new Date(Date.now() - LIMITS.windowMs);
  const run = await prisma.flowRun.findFirst({
    where: { flowId, conversationId, startedAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(run);
}

async function startFromTrigger(
  account: FlowAccount,
  conversationId: string,
  event: InboundEvent
): Promise<boolean> {
  const flows = await prisma.flow.findMany({
    where: { instagramAccountId: account.id, status: "ACTIVE" },
    select: { id: true, createdAt: true, triggers: true },
  });
  const candidates = flows
    .map((f) => ({ flowId: f.id, createdAt: f.createdAt, triggers: asTriggers(f.triggers) }))
    .filter((c) => c.triggers.length > 0);
  if (candidates.length === 0) return false;

  const hit = pickTrigger(candidates, event);
  if (!hit) return false;
  const once =
    (hit.trigger.type === "story_mention" || hit.trigger.type === "default_reply") && hit.trigger.oncePer24h;
  if (once && (await recentRun(hit.flowId, conversationId))) return false;

  const state = await startFlowForConversation({
    account,
    conversationId,
    flowId: hit.flowId,
    context: {
      trigger: hit.trigger.type,
      keyword: hit.keyword,
      ref: event.type === "referral" ? event.ref : undefined,
      interacted: true,
    },
  });
  return Boolean(state);
}

export interface InboundFlowResult {
  /** A flow owns this DM: the AI setter must not answer it. */
  consumed: boolean;
  /** The conversation was busy; re-run this DM through flows shortly. */
  retry?: boolean;
}

function ownedFailure(error: unknown): InboundFlowResult {
  if (error instanceof FlowLockBusyError) return { consumed: true, retry: true };
  // The flow owned this message; failing loudly beats a second, AI reply.
  console.error("[Flows] Flow failed on a message it owned:", error);
  return { consumed: true };
}

/** Continue a waiting run with this DM, under the lock. */
async function continueRun(
  account: FlowAccount,
  conversationId: string,
  flow: FlowRow,
  kind: FlowWaiting["kind"],
  text: string
): Promise<boolean> {
  let consumed = false;
  const result = await withConversationLock(conversationId, async () => {
    const fresh = await activeRunFor(conversationId, flow.id);
    if (!fresh || fresh.waiting?.kind !== kind) return null;
    return withExecutor({
      account,
      conversationId,
      flow,
      run: fresh,
      op: async (executor) => {
        if (kind === "input") consumed = await executor.onInput(text);
        else if (kind === "interaction") consumed = await executor.onInteraction();
        else if (kind === "buttons") consumed = await executor.onFreeTextWhileWaitingForTap();
      },
    });
  });
  if (result) await runFollowups(account, conversationId, result.state, result.followups);
  return consumed;
}

/** Mark a waiting run as interacted (the contact wrote: window is open). */
async function markInteracted(conversationId: string, runId: string): Promise<void> {
  await withConversationLock(conversationId, async () => {
    const fresh = await prisma.flowRun.findUnique({ where: { id: runId } });
    if (!fresh) return;
    const state = toRunState(fresh);
    if (state.context.interacted || !ACTIVE_STATUSES.includes(state.status)) return;
    await prisma.flowRun.update({
      where: { id: runId },
      data: { context: { ...state.context, interacted: true } as unknown as Prisma.InputJsonValue },
    });
  });
}

/**
 * A DM arrived (already mirrored). Returns consumed=true when a flow used
 * it, so the AI setter must not also answer it.
 *
 * `text` must be what the contact typed (empty for media), not the
 * mirror's summary, so "[Photo]" never matches a keyword or an input.
 */
export async function handleInboundForFlows(params: {
  account: FlowAccount;
  conversationId: string;
  text: string;
  kind: string;
  quickReplyPayload?: string;
  referralRef?: string;
  isNewContact: boolean;
  aiActive: boolean;
  /** A human replied in this thread recently: mute keyword triggers. */
  humanActive: boolean;
}): Promise<InboundFlowResult> {
  const { account, conversationId } = params;

  if (params.quickReplyPayload && decodeFlowPayload(params.quickReplyPayload)) {
    try {
      await tap(account, conversationId, params.quickReplyPayload);
    } catch (error) {
      return ownedFailure(error);
    }
    return { consumed: true };
  }

  const active = await activeRunFor(conversationId);
  if (active) {
    const flow = await loadFlow(active.flowId);
    const kind = active.waiting?.kind;
    const owns =
      kind === "input" ||
      kind === "interaction" ||
      (kind === "buttons" && active.context.trigger === "comment");
    if (flow && kind && owns) {
      try {
        if (await continueRun(account, conversationId, flow, kind, params.text)) {
          return { consumed: true };
        }
      } catch (error) {
        return ownedFailure(error);
      }
    } else if (!active.context.interacted) {
      await markInteracted(conversationId, active.id).catch(() => {});
    }
  }

  // ManyChat mutes keywords while a human handles the thread.
  if (params.humanActive) return { consumed: false };

  try {
    if (params.referralRef) {
      const started = await startFromTrigger(account, conversationId, { type: "referral", ref: params.referralRef });
      if (started) return { consumed: true };
    }
    const started = await startFromTrigger(account, conversationId, {
      type: "message",
      text: params.text,
      isStoryReply: params.kind === "story_reply",
      isStoryMention: params.kind === "story_mention",
      isNewContact: params.isNewContact,
      // A default reply never talks over a running flow.
      aiActive: params.aiActive || Boolean(active),
    });
    return { consumed: started };
  } catch (error) {
    return ownedFailure(error);
  }
}

/** Someone opened an ig.me ref link without sending a message. */
export async function handleReferralForFlows(params: {
  account: FlowAccount;
  conversationId: string;
  ref: string;
}): Promise<boolean> {
  return startFromTrigger(params.account, params.conversationId, { type: "referral", ref: params.ref });
}

async function accountForRun(runId: string) {
  return prisma.flowRun.findUnique({
    where: { id: runId },
    include: {
      conversation: {
        select: {
          id: true,
          instagramAccount: { select: { id: true, instagramId: true, workspaceId: true, accessToken: true } },
        },
      },
    },
  });
}

/** A delay step fired. */
export async function resumeFlowRun(runId: string, nodeId: string): Promise<void> {
  const row = await accountForRun(runId);
  if (!row) return;
  const account = row.conversation.instagramAccount;
  const flow = await loadFlow(row.flowId);
  if (!flow) return;
  const conversationId = row.conversation.id;

  const result = await withConversationLock(conversationId, async () => {
    const fresh = await prisma.flowRun.findUnique({ where: { id: runId } });
    if (!fresh) return null;
    const state = toRunState(fresh);
    if (state.status !== "WAITING" || state.waiting?.kind !== "delay" || state.waiting.nodeId !== nodeId) {
      return null;
    }
    return withExecutor({ account, conversationId, flow, run: state, op: (executor) => executor.onResume(nodeId) });
  });
  if (result) await runFollowups(account, conversationId, result.state, result.followups);
}

/**
 * Periodic upkeep: expire input waits past their deadline and waits older
 * than a private reply's lifetime, and re-arm delay steps whose job was
 * lost (Redis flush, worker downtime).
 */
export async function sweepFlowRuns(): Promise<{ expired: number; rearmed: number }> {
  const now = Date.now();
  // Only rows that can need action: input and delay waits, plus taps or
  // first replies that never came. Oldest first, so nothing starves.
  const candidates = await prisma.flowRun.findMany({
    where: {
      status: "WAITING",
      OR: [
        { waiting: { path: ["kind"], equals: "input" } },
        { waiting: { path: ["kind"], equals: "delay" } },
        { updatedAt: { lt: new Date(now - STALE_WAIT_MS) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    select: { id: true, flowId: true, conversationId: true, waiting: true, updatedAt: true },
    take: 500,
  });
  let expired = 0;
  let rearmed = 0;

  for (const run of candidates) {
    const w = run.waiting as FlowWaiting | null;
    if (!w) continue;
    let reason: string | null = null;
    if (w.kind === "input" && new Date(w.expiresAt).getTime() < now) {
      reason = "No answer before the input step timed out";
    } else if ((w.kind === "interaction" || w.kind === "buttons") && now - run.updatedAt.getTime() > STALE_WAIT_MS) {
      reason = "No interaction within 7 days";
    } else if (w.kind === "delay" && new Date(w.resumeAt).getTime() < now - 5 * 60 * 1000) {
      await getDMQueue().add(
        FLOW_RESUME_JOB_NAME,
        { runId: run.id, nodeId: w.nodeId },
        { jobId: `flow_${run.id}_${w.nodeId}_rearm_${Math.floor(now / 3_600_000)}` }
      );
      rearmed += 1;
    }
    if (!reason) continue;

    // Only expire the exact snapshot we looked at: a run that advanced in
    // the meantime has a newer updatedAt and is left alone.
    const updated = await prisma.flowRun.updateMany({
      where: { id: run.id, status: "WAITING", updatedAt: run.updatedAt },
      data: { status: "EXPIRED", waiting: Prisma.DbNull, completedAt: new Date() },
    });
    if (updated.count === 0) continue;
    expired += 1;
    await prisma.flowEvent.create({
      data: {
        flowId: run.flowId,
        runId: run.id,
        nodeId: w.nodeId,
        conversationId: run.conversationId,
        type: "EXPIRED",
        detail: { reason },
      },
    });
  }
  return { expired, rearmed };
}

/**
 * True when a flow waits for this contact's next message: an input step,
 * the first reply after a private reply, or a comment flow's opener tap.
 */
export async function hasBlockingFlowRun(conversationId: string): Promise<boolean> {
  const run = await activeRunFor(conversationId);
  const kind = run?.waiting?.kind;
  return (
    kind === "input" ||
    kind === "interaction" ||
    (kind === "buttons" && run?.context.trigger === "comment")
  );
}
