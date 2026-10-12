/**
 * Comment triggers: the "Comment on your post or reel" trigger of a flow.
 *
 * Each one is stored as an Automation row with flowId = the flow, so the
 * comment pipeline (lib/queue/dm-worker processComment: keyword match,
 * dedupe, quota, rate limit, public replies, DmLog stats, share reports)
 * runs exactly as it does for campaigns. This module is the pure half:
 * the shape (zod), the activation rules, row <-> trigger mapping and the
 * create / update / delete plan the flow API applies in one transaction.
 *
 * Shared by the API and the editor; no database access here.
 */

import { z } from "zod";
import type { CommentTrigger, EditorTrigger, FlowTrigger } from "./types";
import {
  FLOW_EDITOR_LIMITS,
  FLOW_ID_PATTERN,
  parseFlowTriggersShape,
  type FlowIssue,
  type ParseResult,
} from "./validate";

/** Same limits as the campaign API (app/api/automations). */
export const COMMENT_TRIGGER_LIMITS = {
  keywordsMax: 10,
  keywordMax: 50,
  publicRepliesMax: 10,
  publicReplyMax: 1000,
  /** Comment triggers per flow. */
  perFlowMax: 10,
  /** Automation.name, as the campaign API caps it. */
  nameMax: 100,
} as const;

export const COMMENT_TRIGGER_LABEL = "Comment on a post or reel";

/** Instagram media ids are numeric strings; allow the usual id alphabet. */
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Post links are shown as links, so only https Instagram URLs are stored. */
export function isInstagramPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "instagram.com" || host.endsWith(".instagram.com"));
  } catch {
    return false;
  }
}

const idSchema = z.string().regex(FLOW_ID_PATTERN, "Invalid id");

export const commentTriggerSchema = z.object({
  id: idSchema,
  type: z.literal("comment"),
  automationId: idSchema.optional(),
  version: z.string().max(64).optional(),
  postId: z.string().regex(MEDIA_ID_PATTERN, "Invalid post id").nullable(),
  postUrl: z
    .string()
    .max(500)
    .refine(isInstagramPostUrl, "Use the post's Instagram link")
    .nullable(),
  matchAnyPost: z.boolean(),
  pendingNextReel: z.boolean(),
  keywords: z
    .array(z.string().trim().min(1, "Keywords cannot be empty").max(COMMENT_TRIGGER_LIMITS.keywordMax))
    .max(COMMENT_TRIGGER_LIMITS.keywordsMax),
  matchAnyWord: z.boolean(),
  wholeWordMatch: z.boolean(),
  publicReplyEnabled: z.boolean(),
  publicReplyMessages: z.array(z.string().max(COMMENT_TRIGGER_LIMITS.publicReplyMax)).max(COMMENT_TRIGGER_LIMITS.publicRepliesMax),
});

export function isCommentTrigger(trigger: EditorTrigger): trigger is CommentTrigger {
  return trigger.type === "comment";
}

export interface SplitTriggers {
  flowTriggers: FlowTrigger[];
  commentTriggers: CommentTrigger[];
}

/**
 * Shape-parse an editor trigger list: comment triggers through
 * commentTriggerSchema, everything else through the Flow.triggers schema.
 */
export function parseEditorTriggersShape(input: unknown): ParseResult<SplitTriggers> {
  if (!Array.isArray(input)) return { ok: false, errors: ["Triggers: expected a list."] };
  if (input.length > FLOW_EDITOR_LIMITS.triggersMax) {
    return { ok: false, errors: [`A flow can have up to ${FLOW_EDITOR_LIMITS.triggersMax} triggers.`] };
  }
  const commentRaw: unknown[] = [];
  const flowRaw: unknown[] = [];
  for (const item of input) {
    const type = item && typeof item === "object" ? (item as { type?: unknown }).type : undefined;
    if (type === "comment") commentRaw.push(item);
    else flowRaw.push(item);
  }
  if (commentRaw.length > COMMENT_TRIGGER_LIMITS.perFlowMax) {
    return { ok: false, errors: [`A flow can have up to ${COMMENT_TRIGGER_LIMITS.perFlowMax} comment triggers.`] };
  }

  const errors: string[] = [];
  const commentTriggers: CommentTrigger[] = [];
  commentRaw.forEach((raw, index) => {
    const parsed = commentTriggerSchema.safeParse(raw);
    if (parsed.success) {
      commentTriggers.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues.slice(0, 5)) {
      const where = issue.path.length ? `, ${issue.path.join(" ")}` : "";
      errors.push(`Comment trigger ${index + 1}${where}: ${issue.message}`);
    }
  });

  const flow = parseFlowTriggersShape(flowRaw);
  if (!flow.ok) errors.push(...flow.errors);
  if (errors.length > 0 || !flow.ok) return { ok: false, errors };

  const ids = new Set<string>();
  for (const trigger of [...commentTriggers, ...flow.value]) {
    if (ids.has(trigger.id)) return { ok: false, errors: ["Two triggers share the same id."] };
    ids.add(trigger.id);
  }
  return { ok: true, value: { flowTriggers: flow.value, commentTriggers } };
}

// ─── Scope helpers ────────────────────────────────────────────────────────

export type CommentPostScope = "specific" | "any" | "next_reel";

export function commentPostScope(trigger: Pick<CommentTrigger, "matchAnyPost" | "pendingNextReel">): CommentPostScope {
  if (trigger.matchAnyPost) return "any";
  if (trigger.pendingNextReel) return "next_reel";
  return "specific";
}

/** Switches the post scope and keeps the dependent fields consistent. */
export function withPostScope(trigger: CommentTrigger, scope: CommentPostScope): CommentTrigger {
  return {
    ...trigger,
    matchAnyPost: scope === "any",
    pendingNextReel: scope === "next_reel",
    postId: scope === "specific" ? trigger.postId : null,
    postUrl: scope === "specific" ? trigger.postUrl : null,
  };
}

export function createCommentTrigger(id: string, defaults: Partial<CommentTrigger> = {}): CommentTrigger {
  return {
    id,
    type: "comment",
    postId: null,
    postUrl: null,
    matchAnyPost: false,
    pendingNextReel: false,
    keywords: [],
    matchAnyWord: false,
    wholeWordMatch: true,
    publicReplyEnabled: false,
    publicReplyMessages: [],
    ...defaults,
  };
}

// ─── Rules (block activation, never block a draft save) ───────────────────

export function commentTriggerLabel(index: number): string {
  return `Comment trigger ${index + 1}`;
}

export function validateCommentTriggers(triggers: CommentTrigger[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  triggers.forEach((trigger, index) => {
    const add = (message: string) =>
      issues.push({ nodeId: null, triggerId: trigger.id, message: `${commentTriggerLabel(index)}: ${message}` });
    if (commentPostScope(trigger) === "specific" && !trigger.postId) {
      add("choose a post or reel, any post, or your next reel.");
    }
    if (!trigger.matchAnyWord && trigger.keywords.filter((k) => k.trim()).length === 0) {
      add("add at least one keyword, or reply to every comment.");
    }
    if (trigger.publicReplyEnabled && trigger.publicReplyMessages.filter((m) => m.trim()).length === 0) {
      add("write at least one public reply, or turn public replies off.");
    }
  });
  return issues;
}

// ─── Row mapping ──────────────────────────────────────────────────────────

/** The Automation columns a comment trigger owns (everything else is left alone). */
export interface CommentAutomationRow {
  id: string;
  name: string;
  isActive: boolean;
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  updatedAt: Date | string;
}

/** Prisma select for CommentAutomationRow. */
export const COMMENT_AUTOMATION_SELECT = {
  id: true,
  name: true,
  isActive: true,
  postId: true,
  postUrl: true,
  matchAnyPost: true,
  pendingNextReel: true,
  keywords: true,
  matchAnyWord: true,
  wholeWordMatch: true,
  publicReplyEnabled: true,
  publicReplyMessage: true,
  publicReplyMessages: true,
  updatedAt: true,
} as const;

export function rowVersion(row: Pick<CommentAutomationRow, "updatedAt">): string {
  return new Date(row.updatedAt).toISOString();
}

export function commentTriggerFromRow(row: CommentAutomationRow): CommentTrigger {
  const replies =
    row.publicReplyMessages.length > 0 ? row.publicReplyMessages : row.publicReplyMessage ? [row.publicReplyMessage] : [];
  return {
    id: row.id,
    type: "comment",
    automationId: row.id,
    version: rowVersion(row),
    postId: row.postId,
    postUrl: row.postUrl,
    matchAnyPost: row.matchAnyPost,
    pendingNextReel: row.pendingNextReel,
    keywords: row.keywords,
    matchAnyWord: row.matchAnyWord,
    wholeWordMatch: row.wholeWordMatch,
    publicReplyEnabled: row.publicReplyEnabled,
    publicReplyMessages: replies,
  };
}

export interface CommentTriggerData {
  postId: string | null;
  postUrl: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  wholeWordMatch: boolean;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  publicReplyMessage: string | null;
}

/** Normalized columns for a trigger, with the same consistency rules as the campaign API. */
export function commentTriggerData(trigger: CommentTrigger): CommentTriggerData {
  const scope = commentPostScope(trigger);
  const replies = trigger.publicReplyEnabled
    ? trigger.publicReplyMessages.map((m) => m.trim()).filter(Boolean)
    : [];
  return {
    postId: scope === "specific" ? trigger.postId : null,
    postUrl: scope === "specific" ? trigger.postUrl : null,
    matchAnyPost: scope === "any",
    pendingNextReel: scope === "next_reel",
    keywords: trigger.matchAnyWord ? [] : trigger.keywords.map((k) => k.trim()).filter(Boolean),
    matchAnyWord: trigger.matchAnyWord,
    wholeWordMatch: trigger.wholeWordMatch,
    publicReplyEnabled: trigger.publicReplyEnabled,
    publicReplyMessages: replies,
    publicReplyMessage: replies[0] ?? null,
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Only the columns that actually change, so an untouched row keeps its
 * values (and the legacy single public reply) exactly as they are.
 */
export function changedCommentData(row: CommentAutomationRow, data: CommentTriggerData): Partial<CommentTriggerData> {
  const changed: Partial<CommentTriggerData> = {};
  if (row.postId !== data.postId) changed.postId = data.postId;
  if (row.postUrl !== data.postUrl) changed.postUrl = data.postUrl;
  if (row.matchAnyPost !== data.matchAnyPost) changed.matchAnyPost = data.matchAnyPost;
  if (row.pendingNextReel !== data.pendingNextReel) changed.pendingNextReel = data.pendingNextReel;
  if (!sameList(row.keywords, data.keywords)) changed.keywords = data.keywords;
  if (row.matchAnyWord !== data.matchAnyWord) changed.matchAnyWord = data.matchAnyWord;
  if (row.wholeWordMatch !== data.wholeWordMatch) changed.wholeWordMatch = data.wholeWordMatch;
  if (row.publicReplyEnabled !== data.publicReplyEnabled) changed.publicReplyEnabled = data.publicReplyEnabled;
  const storedReplies = commentTriggerFromRow(row).publicReplyMessages;
  if (row.publicReplyEnabled !== data.publicReplyEnabled || !sameList(storedReplies, data.publicReplyMessages)) {
    if (!sameList(row.publicReplyMessages, data.publicReplyMessages)) changed.publicReplyMessages = data.publicReplyMessages;
    if (row.publicReplyMessage !== data.publicReplyMessage) changed.publicReplyMessage = data.publicReplyMessage;
  }
  return changed;
}

/** Automation.name for a flow-backed row: the flow's name, numbered when there are several. */
export function commentTriggerName(flowName: string, index: number, total: number): string {
  const base = flowName.trim() || "Untitled flow";
  const name = total > 1 ? `${base} (comment ${index + 1})` : base;
  return name.slice(0, COMMENT_TRIGGER_LIMITS.nameMax);
}

/** Flow status -> Automation.isActive. Only a live flow answers comments. */
export function automationActiveFor(status: "DRAFT" | "ACTIVE" | "PAUSED"): boolean {
  return status === "ACTIVE";
}

// ─── Sync plan ────────────────────────────────────────────────────────────

export interface CommentSyncPlan {
  creates: { clientId: string; name: string; data: CommentTriggerData }[];
  updates: { id: string; clientId: string; data: Partial<CommentTriggerData> & { name?: string } }[];
  deletes: string[];
  /** Every submitted trigger that kept its row: client id -> automation id. */
  matches: { clientId: string; id: string }[];
  /** Rows changed elsewhere since the editor loaded them (e.g. a next reel got bound). */
  conflicts: { id: string; clientId: string }[];
}

/**
 * Diff the submitted comment triggers against the rows linked to the flow.
 *
 * - A trigger whose automationId belongs to this flow updates that row;
 *   any other automationId (deleted meanwhile, another flow's, another
 *   workspace's) is ignored and the trigger is created fresh.
 * - Rows no trigger points at are deleted.
 * - `versions` (automationId -> version the editor last saw) guards rows
 *   that changed elsewhere: a stale version plus a real change is a conflict.
 * - Names follow the flow name on create, and on every row when the flow
 *   is renamed (`renamed`), so untouched rows keep their names.
 */
export function planCommentTriggerSync(params: {
  existing: CommentAutomationRow[];
  submitted: CommentTrigger[];
  flowName: string;
  renamed: boolean;
  versions?: Record<string, string>;
}): CommentSyncPlan {
  const { existing, submitted, flowName, renamed, versions = {} } = params;
  const byId = new Map(existing.map((row) => [row.id, row] as const));
  const claimed = new Set<string>();
  const plan: CommentSyncPlan = { creates: [], updates: [], deletes: [], matches: [], conflicts: [] };

  submitted.forEach((trigger, index) => {
    const name = commentTriggerName(flowName, index, submitted.length);
    const data = commentTriggerData(trigger);
    const row = trigger.automationId ? byId.get(trigger.automationId) : undefined;
    if (!row || claimed.has(row.id)) {
      plan.creates.push({ clientId: trigger.id, name, data });
      return;
    }
    claimed.add(row.id);
    const changed = changedCommentData(row, data);
    const seen = versions[row.id] ?? trigger.version;
    if (Object.keys(changed).length > 0 && seen && seen !== rowVersion(row)) {
      plan.conflicts.push({ id: row.id, clientId: trigger.id });
      return;
    }
    plan.matches.push({ clientId: trigger.id, id: row.id });
    const update: Partial<CommentTriggerData> & { name?: string } = { ...changed };
    if (renamed && row.name !== name) update.name = name;
    if (Object.keys(update).length > 0) plan.updates.push({ id: row.id, clientId: trigger.id, data: update });
  });

  for (const row of existing) {
    if (!claimed.has(row.id)) plan.deletes.push(row.id);
  }
  return plan;
}

// ─── Overlap warnings ─────────────────────────────────────────────────────

/** Minimal view of another live comment automation on the same account. */
export interface LiveCommentAutomation {
  id: string;
  name: string;
  postId: string | null;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  flow?: { name: string } | null;
}

function scopesOverlap(a: { postId: string | null; matchAnyPost: boolean }, b: { postId: string | null; matchAnyPost: boolean }): boolean {
  if (a.matchAnyPost || b.matchAnyPost) return true;
  return Boolean(a.postId && b.postId && a.postId === b.postId);
}

function keywordsOverlap(a: { keywords: string[]; matchAnyWord: boolean }, b: { keywords: string[]; matchAnyWord: boolean }): boolean {
  if (a.matchAnyWord || b.matchAnyWord) return true;
  const theirs = new Set(b.keywords.map((k) => k.trim().toLowerCase()));
  return a.keywords.some((k) => theirs.has(k.trim().toLowerCase()));
}

/**
 * Instagram allows one private reply per comment, so two live automations
 * answering the same comment means one of them fails. Warn, never block.
 */
export function commentOverlapWarnings(triggers: CommentTrigger[], others: LiveCommentAutomation[]): FlowIssue[] {
  const warnings: FlowIssue[] = [];
  triggers.forEach((trigger, index) => {
    const data = commentTriggerData(trigger);
    if (data.pendingNextReel) return;
    const clash = others.find((other) => scopesOverlap(data, other) && keywordsOverlap(data, other));
    if (!clash) return;
    const owner = clash.flow ? `the live flow "${clash.flow.name}"` : `the live campaign "${clash.name}"`;
    warnings.push({
      nodeId: null,
      triggerId: trigger.id,
      message: `${commentTriggerLabel(index)}: ${owner} also answers some of these comments. Instagram allows one private reply per comment, so only one of them gets through.`,
    });
  });
  return warnings;
}

/**
 * Triggers for a copy of a flow: comment triggers lose their Automation id
 * and version (the copy gets its own rows) and get fresh ids.
 */
export function triggersForCopy(triggers: EditorTrigger[], newTriggerId: () => string): EditorTrigger[] {
  return triggers.map((trigger) => {
    if (trigger.type !== "comment") return trigger;
    const copy: CommentTrigger = { ...trigger, id: newTriggerId() };
    delete copy.automationId;
    delete copy.version;
    return copy;
  });
}
