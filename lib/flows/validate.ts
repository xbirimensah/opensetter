/**
 * Flow validation shared by the API and the editor.
 *
 * Three layers, from loose to strict:
 * - shape (`parseFlowGraphShape`, `parseFlowTriggersShape`): the JSON has
 *   the structure of types.ts. Drafts only need this to be saved.
 * - rules (`validateFlowGraph`, `validateFlowTriggers`): Meta's limits and
 *   graph integrity. A flow with rule errors can be saved as a draft but
 *   never activated. `parseFlowGraph` / `parseFlowTriggers` run shape and
 *   rules together.
 * - lint (`lintFlow`): warnings about things Instagram will not do the way
 *   the owner probably expects (24h window, private reply, dead ends).
 *
 * Pure and dependency-free apart from zod, so the editor runs it live.
 */

import { z } from "zod";
import {
  LIMITS,
  type FlowButton,
  type FlowContent,
  type FlowGraph,
  type FlowNode,
  type FlowNodeType,
  type FlowRuleOp,
  type FlowRuleSubject,
  type FlowTrigger,
  type FlowTriggerType,
} from "./types";

// ─── Public result types ──────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** One error or warning, attached to the node or trigger it is about. */
export interface FlowIssue {
  nodeId: string | null;
  triggerId?: string;
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Node, button and block ids travel inside postback payloads (FLOW|a|b|c). */
export const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Custom field names; also used as {{field.<name>}}. */
export const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
/** ig.me ref parameter. */
export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const FLOW_EDITOR_LIMITS = {
  nodesMax: 200,
  contentsPerMessageMax: 10,
  rulesMax: 20,
  actionsMax: 20,
  branchesMin: 2,
  branchesMax: 10,
  delayMinSeconds: 1,
  delayMaxSeconds: 86_400,
  /** Delays longer than this outlive the 24h messaging window in practice. */
  delayWarnSeconds: 23 * 60 * 60,
  typingMinSeconds: 1,
  inputMaxRetries: 5,
  inputTimeoutMaxMinutes: 1440,
  keywordsMax: 20,
  keywordMax: 50,
  tagMax: 50,
  fieldValueMax: 1000,
  notifyMax: 500,
  webhookHeadersMax: 20,
  webhookSaveMax: 10,
  triggersMax: 20,
  nameMax: 60,
} as const;

/** Hard caps for drafts so a client cannot store arbitrarily large JSON. */
const SHAPE_TEXT_MAX = 5000;
const SHAPE_LIST_MAX = 50;

export const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  message: "Message",
  input: "Collect input",
  condition: "Condition",
  action: "Action",
  delay: "Delay",
  randomizer: "Randomizer",
  start_flow: "Start another flow",
  ai_handoff: "Hand off to AI setter",
};

export const TRIGGER_TYPE_LABELS: Record<FlowTriggerType, string> = {
  dm_keyword: "DM keyword",
  story_reply: "Story reply",
  story_mention: "Story mention",
  ref_link: "Ref link",
  welcome: "Welcome message",
  default_reply: "Default reply",
  new_follower: "New follower",
};

/** Trigger types a flow may carry at most once. */
const SINGLETON_TRIGGERS: FlowTriggerType[] = [
  "welcome",
  "default_reply",
  "story_mention",
  "new_follower",
];

/** Variables the engine fills in (see lib/flows/variables.ts). */
export const FLOW_VARIABLES: { token: string; description: string }[] = [
  { token: "{{username}}", description: "Instagram handle" },
  { token: "{{name}}", description: "Display name, falls back to the handle" },
  { token: "{{first_name}}", description: "First word of the name" },
  { token: "{{email}}", description: "Saved email" },
  { token: "{{phone}}", description: "Saved phone number" },
  { token: "{{field.<name>}}", description: "A custom field" },
  { token: "{{last_input}}", description: "Their last text message" },
  { token: "{{comment}}", description: "The comment that started the flow" },
  { token: "{{keyword}}", description: "The keyword that matched" },
  { token: "{{ref}}", description: "The ref of the ig.me link" },
];

const KNOWN_VARIABLES = new Set([
  "username",
  "name",
  "first_name",
  "email",
  "phone",
  "last_input",
  "comment",
  "keyword",
  "ref",
]);

const VARIABLE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Which operators make sense for which rule subject. */
export const RULE_OPS: Record<FlowRuleSubject, FlowRuleOp[]> = {
  follows: ["is_true", "is_false"],
  tag: ["has", "has_not"],
  email: ["is_set", "is_not_set"],
  phone: ["is_set", "is_not_set"],
  field: ["is_set", "is_not_set", "equals", "not_equals", "contains"],
  last_input: ["equals", "not_equals", "contains"],
};

const OPS_WITH_VALUE: FlowRuleOp[] = ["has", "has_not", "equals", "not_equals", "contains"];

// ─── Media upload rules (Meta's attachment limits) ───────────────────────

export type MediaAssetKind = "IMAGE" | "VIDEO" | "AUDIO" | "FILE";

const MB = 1024 * 1024;

export const MEDIA_UPLOAD_RULES: Record<
  MediaAssetKind,
  { mimeTypes: string[]; extensions: string[]; maxBytes: number; label: string }
> = {
  IMAGE: {
    mimeTypes: ["image/png", "image/jpeg"],
    extensions: ["png", "jpg", "jpeg"],
    maxBytes: 8 * MB,
    label: "PNG or JPEG, up to 8 MB",
  },
  VIDEO: {
    mimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/ogg", "video/avi", "video/x-msvideo"],
    extensions: ["mp4", "mov", "webm", "ogv", "avi"],
    maxBytes: 25 * MB,
    label: "MP4, MOV, WebM, OGG or AVI, up to 25 MB",
  },
  AUDIO: {
    mimeTypes: ["audio/aac", "audio/m4a", "audio/x-m4a", "audio/mp4", "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg"],
    extensions: ["aac", "m4a", "wav", "mp3"],
    maxBytes: 25 * MB,
    label: "AAC, M4A, WAV or MP3, up to 25 MB",
  },
  FILE: {
    mimeTypes: ["application/pdf"],
    extensions: ["pdf"],
    maxBytes: 25 * MB,
    label: "PDF, up to 25 MB",
  },
};

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  aac: "audio/aac",
  m4a: "audio/x-m4a",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

/** Content block type that plays a media kind. */
export const MEDIA_KIND_FOR_CONTENT = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  file: "FILE",
} as const satisfies Record<string, MediaAssetKind>;

/**
 * Resolve the MIME type and kind of an upload. Browsers send an empty or
 * generic type for some audio files, so the extension is the fallback.
 */
export function mediaRuleFor(
  mimeType: string | null | undefined,
  filename: string
): { kind: MediaAssetKind; mimeType: string; maxBytes: number } | null {
  const declared = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const candidates = [declared, EXTENSION_MIME[ext] ?? ""];
  for (const candidate of candidates) {
    if (!candidate || candidate === "application/octet-stream") continue;
    for (const [kind, rule] of Object.entries(MEDIA_UPLOAD_RULES) as [
      MediaAssetKind,
      (typeof MEDIA_UPLOAD_RULES)[MediaAssetKind],
    ][]) {
      if (rule.mimeTypes.includes(candidate)) {
        return { kind, mimeType: candidate, maxBytes: rule.maxBytes };
      }
    }
  }
  return null;
}

// ─── Shape schemas (mirror types.ts) ──────────────────────────────────────

const idSchema = z.string().regex(FLOW_ID_PATTERN, "Invalid id");
const refSchema = idSchema.nullable();
const textSchema = z.string().max(SHAPE_TEXT_MAX);
const externalIdSchema = z.string().max(64);

const buttonSchema = z.discriminatedUnion("type", [
  z.object({
    id: idSchema,
    type: z.literal("url"),
    title: textSchema,
    url: textSchema,
    track: z.boolean().optional(),
  }),
  z.object({ id: idSchema, type: z.literal("next"), title: textSchema, next: refSchema }),
  z.object({ id: idSchema, type: z.literal("flow"), title: textSchema, flowId: externalIdSchema }),
]);

const quickReplySchema = z.object({ id: idSchema, title: textSchema, next: refSchema });

const cardSchema = z.object({
  id: idSchema,
  title: textSchema,
  subtitle: textSchema.optional(),
  imageMediaId: externalIdSchema.optional(),
  imageUrl: textSchema.optional(),
  buttons: z.array(buttonSchema).max(SHAPE_LIST_MAX),
});

function mediaContent<T extends "image" | "video" | "audio" | "file">(type: T) {
  return z.object({
    id: idSchema,
    type: z.literal(type),
    mediaId: externalIdSchema.optional(),
    url: textSchema.optional(),
  });
}

const contentSchema = z.discriminatedUnion("type", [
  z.object({
    id: idSchema,
    type: z.literal("text"),
    text: textSchema,
    buttons: z.array(buttonSchema).max(SHAPE_LIST_MAX).optional(),
  }),
  mediaContent("image"),
  mediaContent("video"),
  mediaContent("audio"),
  mediaContent("file"),
  z.object({ id: idSchema, type: z.literal("cards"), cards: z.array(cardSchema).max(SHAPE_LIST_MAX) }),
  z.object({ id: idSchema, type: z.literal("typing"), seconds: z.number() }),
]);

const ruleSchema = z.object({
  id: idSchema,
  subject: z.enum(["follows", "tag", "email", "phone", "field", "last_input"]),
  key: textSchema.optional(),
  op: z.enum(["is_true", "is_false", "has", "has_not", "is_set", "is_not_set", "equals", "not_equals", "contains"]),
  value: textSchema.optional(),
});

const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: idSchema, type: z.literal("add_tag"), tag: textSchema }),
  z.object({ id: idSchema, type: z.literal("remove_tag"), tag: textSchema }),
  z.object({ id: idSchema, type: z.literal("set_field"), key: textSchema, value: textSchema }),
  z.object({ id: idSchema, type: z.literal("clear_field"), key: textSchema }),
  z.object({
    id: idSchema,
    type: z.literal("webhook"),
    url: textSchema,
    method: z.enum(["POST", "GET"]).optional(),
    body: textSchema.optional(),
    headers: z.record(z.string().max(200), textSchema).optional(),
    saveResponse: z
      .array(z.object({ path: textSchema, key: textSchema }))
      .max(SHAPE_LIST_MAX)
      .optional(),
  }),
  z.object({ id: idSchema, type: z.literal("notify"), message: textSchema }),
  z.object({ id: idSchema, type: z.literal("pause_ai") }),
  z.object({ id: idSchema, type: z.literal("resume_ai") }),
]);

const nodeBase = {
  id: idSchema,
  name: z.string().max(200).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
};

const nodeSchema = z.discriminatedUnion("type", [
  z.object({
    ...nodeBase,
    type: z.literal("message"),
    contents: z.array(contentSchema).max(SHAPE_LIST_MAX),
    quickReplies: z.array(quickReplySchema).max(SHAPE_LIST_MAX).optional(),
    next: refSchema.optional(),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("input"),
    prompt: textSchema,
    inputType: z.enum(["email", "phone", "number", "text", "url"]),
    saveTo: z.string().max(200),
    retryMessage: textSchema.optional(),
    maxRetries: z.number().optional(),
    skipLabel: textSchema.optional(),
    timeoutMinutes: z.number().optional(),
    next: refSchema.optional(),
    onFail: refSchema.optional(),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("condition"),
    match: z.enum(["all", "any"]),
    rules: z.array(ruleSchema).max(SHAPE_LIST_MAX),
    next: refSchema,
    elseNext: refSchema,
  }),
  z.object({
    ...nodeBase,
    type: z.literal("action"),
    actions: z.array(actionSchema).max(SHAPE_LIST_MAX),
    next: refSchema.optional(),
  }),
  z.object({ ...nodeBase, type: z.literal("delay"), seconds: z.number(), next: refSchema.optional() }),
  z.object({
    ...nodeBase,
    type: z.literal("randomizer"),
    branches: z
      .array(z.object({ id: idSchema, weight: z.number(), next: refSchema }))
      .max(SHAPE_LIST_MAX),
  }),
  z.object({ ...nodeBase, type: z.literal("start_flow"), flowId: externalIdSchema }),
  z.object({ ...nodeBase, type: z.literal("ai_handoff") }),
]);

export const flowGraphShapeSchema = z.object({
  startNodeId: refSchema,
  nodes: z.array(nodeSchema).max(FLOW_EDITOR_LIMITS.nodesMax),
  triggerPosition: z.object({ x: z.number(), y: z.number() }).optional(),
});

const keywordListSchema = z.array(z.string().max(200)).max(SHAPE_LIST_MAX);
const keywordMatchSchema = z.enum(["contains", "is", "whole_word", "begins_with"]);

const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    id: idSchema,
    type: z.literal("dm_keyword"),
    keywords: keywordListSchema,
    match: keywordMatchSchema,
    excludeKeywords: keywordListSchema.optional(),
  }),
  z.object({
    id: idSchema,
    type: z.literal("story_reply"),
    keywords: keywordListSchema.optional(),
    match: keywordMatchSchema.optional(),
  }),
  z.object({ id: idSchema, type: z.literal("story_mention"), oncePer24h: z.boolean().optional() }),
  z.object({ id: idSchema, type: z.literal("ref_link"), ref: z.string().max(200) }),
  z.object({ id: idSchema, type: z.literal("welcome") }),
  z.object({ id: idSchema, type: z.literal("default_reply"), oncePer24h: z.boolean().optional() }),
  z.object({ id: idSchema, type: z.literal("new_follower") }),
]);

export const flowTriggersShapeSchema = z.array(triggerSchema).max(FLOW_EDITOR_LIMITS.triggersMax);

// ─── Labels and helpers ───────────────────────────────────────────────────

/** Name shown for a node in messages and pickers: its name, or "Step 3 (Message)". */
export function nodeDisplayName(node: Pick<FlowNode, "name" | "type">, index: number): string {
  const name = node.name?.trim();
  if (name) return `"${name}"`;
  return `Step ${index + 1} (${NODE_TYPE_LABELS[node.type] ?? "Step"})`;
}

/** First text the flow sends from its start step (list previews, campaign preview). */
export function flowFirstText(graph: FlowGraph): string | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  let node = graph.startNodeId ? byId.get(graph.startNodeId) : undefined;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (node.type === "message") {
      for (const content of node.contents) {
        if (content.type === "text" && content.text.trim()) return content.text;
        if (content.type === "cards" && content.cards[0]?.title.trim()) return content.cards[0].title;
      }
      return null;
    }
    if (node.type === "input") return node.prompt || null;
    const next = nodeEdges(node).find((edge) => edge.to)?.to;
    node = next ? byId.get(next) : undefined;
  }
  return null;
}

/**
 * Text usage against Meta's limit. The engine clips by string length, so
 * this counts the same way.
 */
export function textUsage(text: string, withButtons: boolean): { used: number; max: number } {
  return {
    used: text.length,
    max: withButtons ? LIMITS.textWithButtonsMax : LIMITS.textMax,
  };
}

export interface FlowEdge {
  from: string;
  to: string | null;
  /** "next", "else", "on fail", "button 1", "quick reply 2", "branch 1". */
  label: string;
  /** True when the engine follows the edge without waiting for the person. */
  immediate: boolean;
}

/** Every outgoing edge of a node, in a stable order. */
export function nodeEdges(node: FlowNode): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const push = (to: string | null | undefined, label: string, immediate: boolean) => {
    edges.push({ from: node.id, to: to ?? null, label, immediate });
  };
  switch (node.type) {
    case "message": {
      let buttonNo = 0;
      for (const content of node.contents) {
        const buttons =
          content.type === "text"
            ? content.buttons ?? []
            : content.type === "cards"
              ? content.cards.flatMap((card) => card.buttons)
              : [];
        for (const button of buttons) {
          buttonNo += 1;
          if (button.type === "next") push(button.next, `button "${button.title || buttonNo}"`, false);
        }
      }
      (node.quickReplies ?? []).forEach((reply, i) =>
        push(reply.next, `quick reply "${reply.title || i + 1}"`, false)
      );
      if (node.next !== undefined) push(node.next, "next", true);
      break;
    }
    case "input":
      push(node.next, "next", false);
      push(node.onFail, "on fail", false);
      break;
    case "condition":
      push(node.next, "yes", true);
      push(node.elseNext, "no", true);
      break;
    case "action":
      push(node.next, "next", true);
      break;
    case "delay":
      push(node.next, "next", false);
      break;
    case "randomizer":
      node.branches.forEach((branch, i) => push(branch.next, `branch ${i + 1}`, true));
      break;
    case "start_flow":
    case "ai_handoff":
      break;
  }
  return edges;
}

/** All {{variables}} used in a string. */
export function extractVariables(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) found.push(match[1]);
  return found;
}

function isKnownVariable(name: string): boolean {
  if (KNOWN_VARIABLES.has(name)) return true;
  if (name.startsWith("field.")) return FIELD_NAME_PATTERN.test(name.slice("field.".length));
  return false;
}

/** URL check that tolerates {{variables}} anywhere in the URL. */
export function isHttpUrl(value: string, { httpsOnly = false } = {}): boolean {
  const filled = value.trim().replace(VARIABLE_PATTERN, "x");
  if (!/^https?:\/\//i.test(filled)) return false;
  if (httpsOnly && !/^https:\/\//i.test(filled)) return false;
  try {
    const url = new URL(filled);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** A JSON body template is valid when it parses with every variable filled in. */
export function isJsonTemplate(body: string): boolean {
  try {
    JSON.parse(body.replace(VARIABLE_PATTERN, "0"));
    return true;
  } catch {
    return false;
  }
}

export function parseSaveTo(saveTo: string): { kind: "email" | "phone" } | { kind: "field"; key: string } | null {
  if (saveTo === "email" || saveTo === "phone") return { kind: saveTo };
  if (saveTo.startsWith("field:")) {
    const key = saveTo.slice("field:".length);
    return FIELD_NAME_PATTERN.test(key) ? { kind: "field", key } : null;
  }
  return null;
}

function shapeErrors(error: z.ZodError, input: unknown, root: "graph" | "triggers"): string[] {
  const rawNodes =
    root === "graph" && input && typeof input === "object" && Array.isArray((input as { nodes?: unknown }).nodes)
      ? ((input as { nodes: unknown[] }).nodes as unknown[])
      : [];
  const SEGMENT_LABELS: Record<string, string> = {
    contents: "block",
    buttons: "button",
    cards: "card",
    quickReplies: "quick reply",
    rules: "rule",
    actions: "action",
    branches: "branch",
    saveResponse: "saved value",
    keywords: "keyword",
    excludeKeywords: "excluded keyword",
  };
  return error.issues.slice(0, 20).map((issue) => {
    const path = [...issue.path];
    let prefix = root === "graph" ? "Flow" : "Triggers";
    if (root === "graph" && path[0] === "nodes" && typeof path[1] === "number") {
      const raw = rawNodes[path[1]] as { name?: unknown; type?: unknown } | undefined;
      const type = typeof raw?.type === "string" && raw.type in NODE_TYPE_LABELS ? (raw.type as FlowNodeType) : null;
      const name = typeof raw?.name === "string" ? raw.name : undefined;
      prefix = type ? nodeDisplayName({ name, type }, path[1]) : `Step ${path[1] + 1}`;
      path.splice(0, 2);
    } else if (root === "triggers" && typeof path[0] === "number") {
      prefix = `Trigger ${path[0] + 1}`;
      path.splice(0, 1);
    }
    const parts: string[] = [];
    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      const following = path[i + 1];
      if (typeof segment === "string" && SEGMENT_LABELS[segment] && typeof following === "number") {
        parts.push(`${SEGMENT_LABELS[segment]} ${following + 1}`);
        i += 1;
      } else {
        parts.push(String(segment));
      }
    }
    return `${prefix}${parts.length ? `, ${parts.join(", ")}` : ""}: ${issue.message}`;
  });
}

// ─── Graph rules ──────────────────────────────────────────────────────────

/** Meta limits and graph integrity. Assumes the shape already parsed. */
export function validateFlowGraph(graph: FlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const ids = new Set<string>();
  const L = FLOW_EDITOR_LIMITS;

  if (graph.nodes.length === 0) {
    issues.push({ nodeId: null, message: "Add at least one step." });
  }

  graph.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      issues.push({ nodeId: node.id, message: `${nodeDisplayName(node, index)}: another step has the same id.` });
    }
    ids.add(node.id);
  });

  if (graph.nodes.length > 0) {
    if (!graph.startNodeId) {
      issues.push({ nodeId: null, message: "Choose which step the flow starts with." });
    } else if (!ids.has(graph.startNodeId)) {
      issues.push({ nodeId: null, message: "The start step no longer exists. Choose a new start step." });
    }
  }

  graph.nodes.forEach((node, index) => {
    const label = nodeDisplayName(node, index);
    const add = (message: string) => issues.push({ nodeId: node.id, message: `${label}: ${message}` });

    if (node.name && node.name.length > L.nameMax) add(`the name is longer than ${L.nameMax} characters.`);

    for (const edge of nodeEdges(node)) {
      if (edge.to !== null && !ids.has(edge.to)) {
        add(`${edge.label} points to a step that no longer exists.`);
      }
    }

    switch (node.type) {
      case "message":
        validateMessage(node, add);
        break;
      case "input":
        validateInput(node, add);
        break;
      case "condition":
        validateCondition(node, add);
        break;
      case "action":
        validateActions(node, add);
        break;
      case "delay":
        if (!Number.isInteger(node.seconds) || node.seconds < L.delayMinSeconds || node.seconds > L.delayMaxSeconds) {
          add("the delay must be between 1 second and 24 hours.");
        }
        break;
      case "randomizer":
        validateRandomizer(node, add);
        break;
      case "start_flow":
        if (!node.flowId) add("choose the flow to start.");
        break;
      case "ai_handoff":
        break;
    }
  });

  return issues;
}

type Add = (message: string) => void;

function validateButtons(buttons: FlowButton[], where: string, add: Add) {
  if (buttons.length > LIMITS.buttonsMax) {
    add(`${where} has ${buttons.length} buttons, Instagram allows ${LIMITS.buttonsMax}.`);
  }
  buttons.forEach((button, i) => {
    const name = `${where}, button ${i + 1}`;
    const title = button.title.trim();
    if (!title) add(`${name} needs a title.`);
    else if (button.title.length > LIMITS.buttonTitleMax) {
      add(`${name} title is ${button.title.length} characters, the limit is ${LIMITS.buttonTitleMax}.`);
    }
    if (button.type === "url") {
      if (!button.url.trim()) add(`${name} needs a URL.`);
      else if (!isHttpUrl(button.url)) add(`${name} URL must start with https://`);
    }
    if (button.type === "flow" && !button.flowId) add(`${name} needs a flow to start.`);
  });
}

function validateMessage(node: Extract<FlowNode, { type: "message" }>, add: Add) {
  const L = FLOW_EDITOR_LIMITS;
  if (node.contents.length === 0) add("add at least one block to send.");
  if (node.contents.length > L.contentsPerMessageMax) {
    add(`a message can hold up to ${L.contentsPerMessageMax} blocks.`);
  }

  // Button and quick reply ids share one namespace per node (postback payload).
  const tapIds = new Set<string>();
  const blockIds = new Set<string>();
  const claim = (id: string, what: string) => {
    if (tapIds.has(id)) add(`${what} shares its id with another button. Delete it and add it again.`);
    tapIds.add(id);
  };

  node.contents.forEach((content: FlowContent, i) => {
    const where = `block ${i + 1}`;
    if (blockIds.has(content.id)) add(`${where} shares its id with another block.`);
    blockIds.add(content.id);

    switch (content.type) {
      case "text": {
        const buttons = content.buttons ?? [];
        const usage = textUsage(content.text, buttons.length > 0);
        if (!content.text.trim()) add(`${where} text is empty.`);
        else if (usage.used > usage.max) {
          add(
            buttons.length > 0
              ? `${where} text is ${usage.used} characters. With buttons Instagram allows ${usage.max}.`
              : `${where} text is ${usage.used} characters, the limit is ${usage.max}.`
          );
        }
        validateButtons(buttons, where, add);
        buttons.forEach((b, j) => claim(b.id, `${where}, button ${j + 1}`));
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "file": {
        if (!content.mediaId && !content.url?.trim()) add(`${where} needs a file or a URL.`);
        else if (!content.mediaId && content.url && !isHttpUrl(content.url, { httpsOnly: true })) {
          add(`${where} URL must start with https://`);
        }
        break;
      }
      case "cards": {
        if (content.cards.length === 0) add(`${where} needs at least one card.`);
        if (content.cards.length > LIMITS.cardsMax) {
          add(`${where} has ${content.cards.length} cards, Instagram allows ${LIMITS.cardsMax}.`);
        }
        content.cards.forEach((card, j) => {
          const cardWhere = `${where}, card ${j + 1}`;
          if (!card.title.trim()) add(`${cardWhere} needs a title.`);
          else if (card.title.length > LIMITS.cardTitleMax) {
            add(`${cardWhere} title is ${card.title.length} characters, the limit is ${LIMITS.cardTitleMax}.`);
          }
          if (card.subtitle && card.subtitle.length > LIMITS.cardSubtitleMax) {
            add(`${cardWhere} subtitle is ${card.subtitle.length} characters, the limit is ${LIMITS.cardSubtitleMax}.`);
          }
          if (!card.imageMediaId && card.imageUrl && !isHttpUrl(card.imageUrl, { httpsOnly: true })) {
            add(`${cardWhere} image URL must start with https://`);
          }
          validateButtons(card.buttons, cardWhere, add);
          card.buttons.forEach((b, k) => claim(b.id, `${cardWhere}, button ${k + 1}`));
        });
        break;
      }
      case "typing":
        if (
          !Number.isInteger(content.seconds) ||
          content.seconds < FLOW_EDITOR_LIMITS.typingMinSeconds ||
          content.seconds > LIMITS.typingMaxSeconds
        ) {
          add(`${where} pause must be 1 to ${LIMITS.typingMaxSeconds} seconds.`);
        }
        break;
    }
  });

  const replies = node.quickReplies ?? [];
  if (replies.length > LIMITS.quickRepliesMax) {
    add(`has ${replies.length} quick replies, Instagram allows ${LIMITS.quickRepliesMax}.`);
  }
  replies.forEach((reply, i) => {
    const where = `quick reply ${i + 1}`;
    if (!reply.title.trim()) add(`${where} needs a title.`);
    else if (reply.title.length > LIMITS.quickReplyTitleMax) {
      add(`${where} title is ${reply.title.length} characters, the limit is ${LIMITS.quickReplyTitleMax}.`);
    }
    claim(reply.id, where);
  });
}

function validateInput(node: Extract<FlowNode, { type: "input" }>, add: Add) {
  const L = FLOW_EDITOR_LIMITS;
  if (!node.prompt.trim()) add("the question is empty.");
  else if (node.prompt.length > LIMITS.textMax) {
    add(`the question is ${node.prompt.length} characters, the limit is ${LIMITS.textMax}.`);
  }
  if (node.retryMessage && node.retryMessage.length > LIMITS.textMax) {
    add(`the retry message is longer than ${LIMITS.textMax} characters.`);
  }
  if (!parseSaveTo(node.saveTo)) {
    add("choose where to save the answer (custom field names use letters, numbers and underscores).");
  }
  if (
    node.maxRetries !== undefined &&
    (!Number.isInteger(node.maxRetries) || node.maxRetries < 0 || node.maxRetries > L.inputMaxRetries)
  ) {
    add(`retries must be 0 to ${L.inputMaxRetries}.`);
  }
  if (node.skipLabel !== undefined && node.skipLabel.length > LIMITS.quickReplyTitleMax) {
    add(`the Skip label is longer than ${LIMITS.quickReplyTitleMax} characters.`);
  }
  if (
    node.timeoutMinutes !== undefined &&
    (!Number.isInteger(node.timeoutMinutes) || node.timeoutMinutes < 1 || node.timeoutMinutes > L.inputTimeoutMaxMinutes)
  ) {
    add(`the answer timeout must be 1 to ${L.inputTimeoutMaxMinutes} minutes.`);
  }
}

function validateCondition(node: Extract<FlowNode, { type: "condition" }>, add: Add) {
  if (node.rules.length === 0) add("add at least one rule.");
  if (node.rules.length > FLOW_EDITOR_LIMITS.rulesMax) add(`a condition can hold up to ${FLOW_EDITOR_LIMITS.rulesMax} rules.`);
  const seen = new Set<string>();
  node.rules.forEach((rule, i) => {
    const where = `rule ${i + 1}`;
    if (seen.has(rule.id)) add(`${where} shares its id with another rule.`);
    seen.add(rule.id);
    if (!RULE_OPS[rule.subject].includes(rule.op)) {
      add(`${where} uses an operator that does not fit its subject.`);
      return;
    }
    if (rule.subject === "field" && !(rule.key && FIELD_NAME_PATTERN.test(rule.key))) {
      add(`${where} needs a custom field name.`);
    }
    if (OPS_WITH_VALUE.includes(rule.op) && !rule.value?.trim()) {
      add(rule.subject === "tag" ? `${where} needs a tag.` : `${where} needs a value to compare.`);
    }
  });
}

function validateActions(node: Extract<FlowNode, { type: "action" }>, add: Add) {
  const L = FLOW_EDITOR_LIMITS;
  if (node.actions.length === 0) add("add at least one action.");
  if (node.actions.length > L.actionsMax) add(`a step can hold up to ${L.actionsMax} actions.`);
  const seen = new Set<string>();
  node.actions.forEach((action, i) => {
    const where = `action ${i + 1}`;
    if (seen.has(action.id)) add(`${where} shares its id with another action.`);
    seen.add(action.id);
    switch (action.type) {
      case "add_tag":
      case "remove_tag":
        if (!action.tag.trim()) add(`${where} needs a tag.`);
        else if (action.tag.length > L.tagMax) add(`${where} tag is longer than ${L.tagMax} characters.`);
        break;
      case "set_field":
        if (!FIELD_NAME_PATTERN.test(action.key)) add(`${where} needs a custom field name (letters, numbers, underscores).`);
        if (action.value.length > L.fieldValueMax) add(`${where} value is longer than ${L.fieldValueMax} characters.`);
        break;
      case "clear_field":
        if (!FIELD_NAME_PATTERN.test(action.key)) add(`${where} needs a custom field name (letters, numbers, underscores).`);
        break;
      case "webhook": {
        // The engine only calls https URLs on public hosts (lib/flows/safe-http).
        if (!action.url.trim()) add(`${where} needs a URL.`);
        else if (!isHttpUrl(action.url, { httpsOnly: true })) add(`${where} URL must start with https://`);
        if (action.body?.trim() && !isJsonTemplate(action.body)) {
          add(`${where} body is not valid JSON.`);
        }
        const headers = Object.entries(action.headers ?? {});
        if (headers.length > L.webhookHeadersMax) add(`${where} can send up to ${L.webhookHeadersMax} headers.`);
        for (const [key] of headers) {
          if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) add(`${where} header "${key}" is not a valid header name.`);
        }
        const saves = action.saveResponse ?? [];
        if (saves.length > L.webhookSaveMax) add(`${where} can save up to ${L.webhookSaveMax} values.`);
        saves.forEach((save, j) => {
          if (!save.path.trim()) add(`${where}, saved value ${j + 1} needs a response path.`);
          if (!FIELD_NAME_PATTERN.test(save.key)) add(`${where}, saved value ${j + 1} needs a custom field name.`);
        });
        break;
      }
      case "notify":
        if (!action.message.trim()) add(`${where} needs a message.`);
        else if (action.message.length > L.notifyMax) add(`${where} message is longer than ${L.notifyMax} characters.`);
        break;
      case "pause_ai":
      case "resume_ai":
        break;
    }
  });
}

function validateRandomizer(node: Extract<FlowNode, { type: "randomizer" }>, add: Add) {
  const L = FLOW_EDITOR_LIMITS;
  if (node.branches.length < L.branchesMin) add(`add at least ${L.branchesMin} branches.`);
  if (node.branches.length > L.branchesMax) add(`a randomizer can hold up to ${L.branchesMax} branches.`);
  const seen = new Set<string>();
  node.branches.forEach((branch, i) => {
    if (seen.has(branch.id)) add(`branch ${i + 1} shares its id with another branch.`);
    seen.add(branch.id);
    if (!(branch.weight > 0)) add(`branch ${i + 1} weight must be greater than 0.`);
  });
}

// ─── Trigger rules ────────────────────────────────────────────────────────

export function triggerDisplayName(trigger: Pick<FlowTrigger, "type">, index: number): string {
  return `Trigger ${index + 1} (${TRIGGER_TYPE_LABELS[trigger.type] ?? "Trigger"})`;
}

export function validateFlowTriggers(triggers: FlowTrigger[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const L = FLOW_EDITOR_LIMITS;
  const ids = new Set<string>();
  const refs = new Set<string>();
  const singletons = new Set<FlowTriggerType>();

  const checkKeywords = (list: string[] | undefined, what: string, add: Add) => {
    const keywords = list ?? [];
    if (keywords.length > L.keywordsMax) add(`up to ${L.keywordsMax} ${what} are allowed.`);
    keywords.forEach((keyword) => {
      if (!keyword.trim()) add(`remove the empty ${what.replace(/s$/, "")}.`);
      else if (keyword.length > L.keywordMax) add(`"${keyword.slice(0, 20)}" is longer than ${L.keywordMax} characters.`);
    });
  };

  if (triggers.length > L.triggersMax) {
    issues.push({ nodeId: null, message: `A flow can have up to ${L.triggersMax} triggers.` });
  }

  triggers.forEach((trigger, index) => {
    const label = triggerDisplayName(trigger, index);
    const add: Add = (message) => issues.push({ nodeId: null, triggerId: trigger.id, message: `${label}: ${message}` });

    if (ids.has(trigger.id)) add("another trigger has the same id.");
    ids.add(trigger.id);

    if (SINGLETON_TRIGGERS.includes(trigger.type)) {
      if (singletons.has(trigger.type)) add("a flow can have this trigger only once.");
      singletons.add(trigger.type);
    }

    switch (trigger.type) {
      case "dm_keyword":
        if (trigger.keywords.filter((k) => k.trim()).length === 0) add("add at least one keyword.");
        checkKeywords(trigger.keywords, "keywords", add);
        checkKeywords(trigger.excludeKeywords, "excluded keywords", add);
        break;
      case "story_reply":
        checkKeywords(trigger.keywords, "keywords", add);
        break;
      case "ref_link":
        if (!REF_PATTERN.test(trigger.ref)) {
          add("the ref uses letters, numbers, dashes and underscores (up to 64).");
        } else if (refs.has(trigger.ref.toLowerCase())) {
          add(`the ref "${trigger.ref}" is used twice.`);
        }
        refs.add(trigger.ref.toLowerCase());
        break;
      default:
        break;
    }
  });

  return issues;
}

// ─── Parse entry points ───────────────────────────────────────────────────

/** Structure only: what a draft needs to be stored. */
export function parseFlowGraphShape(input: unknown): ParseResult<FlowGraph> {
  const result = flowGraphShapeSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: shapeErrors(result.error, input, "graph") };
  return { ok: true, value: result.data };
}

/** Structure plus every rule: what an active flow needs. */
export function parseFlowGraph(input: unknown): ParseResult<FlowGraph> {
  const shape = parseFlowGraphShape(input);
  if (!shape.ok) return shape;
  const issues = validateFlowGraph(shape.value);
  if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) };
  return shape;
}

export function parseFlowTriggersShape(input: unknown): ParseResult<FlowTrigger[]> {
  const result = flowTriggersShapeSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: shapeErrors(result.error, input, "triggers") };
  return { ok: true, value: result.data };
}

export function parseFlowTriggers(input: unknown): ParseResult<FlowTrigger[]> {
  const shape = parseFlowTriggersShape(input);
  if (!shape.ok) return shape;
  const issues = validateFlowTriggers(shape.value);
  if (issues.length > 0) return { ok: false, errors: issues.map((issue) => issue.message) };
  return shape;
}

// ─── Lint ─────────────────────────────────────────────────────────────────

export const FIRST_MESSAGE_WARNING =
  "First message of a comment-triggered flow should be one text or card with a button, because Instagram allows only one private reply until the person taps or replies.";

/** Warnings about behaviour the owner probably does not expect. Never blocks saving. */
export function lintFlow(graph: FlowGraph, options: { commentTriggered: boolean }): FlowIssue[] {
  const warnings: FlowIssue[] = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const indexOf = new Map(graph.nodes.map((node, i) => [node.id, i] as const));
  const label = (node: FlowNode) => nodeDisplayName(node, indexOf.get(node.id) ?? 0);
  const warn = (node: FlowNode | null, message: string) =>
    warnings.push({ nodeId: node?.id ?? null, message: node ? `${label(node)}: ${message}` : message });

  const start = graph.startNodeId ? byId.get(graph.startNodeId) : undefined;

  // Unreachable steps.
  if (start) {
    const reached = new Set<string>([start.id]);
    const queue: FlowNode[] = [start];
    while (queue.length > 0) {
      const node = queue.shift() as FlowNode;
      for (const edge of nodeEdges(node)) {
        const target = edge.to ? byId.get(edge.to) : undefined;
        if (target && !reached.has(target.id)) {
          reached.add(target.id);
          queue.push(target);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!reached.has(node.id)) warn(node, "no step leads here, so it never runs.");
    }
  }

  // Comment-triggered flows: only one private reply until the person interacts.
  if (options.commentTriggered && start) {
    for (const node of firstSendNodes(start, byId)) {
      if (node.type === "message") {
        const first = node.contents[0];
        const firstOk =
          (first?.type === "text" && (first.buttons?.length ?? 0) > 0) ||
          (first?.type === "cards" && first.cards.length === 1 && first.cards[0].buttons.length > 0);
        if (!firstOk) warn(node, FIRST_MESSAGE_WARNING);
        else if (node.contents.length > 1) {
          warn(node, "only the first block goes out as the private reply. The rest is sent once the person taps or replies.");
        }
        for (const follower of immediateFollowers(node, byId)) {
          if (follower.type === "input") {
            warn(follower, "input step inside the first message. Instagram allows only one private reply, so this question waits until the person taps or replies.");
          }
        }
      } else if (node.type === "input") {
        warn(node, "input step inside the first message. Open with a text and a button, then ask, because Instagram allows only one private reply until the person taps or replies.");
      }
    }
  }

  // Loops the engine runs without waiting for the person.
  for (const node of nodesOnImmediateCycles(graph)) {
    warn(node, `loops back without waiting for the person. The engine stops after ${LIMITS.maxStepsPerPass} steps.`);
  }

  for (const node of graph.nodes) {
    lintNode(node, options, (message) => warn(node, message));
  }

  return warnings;
}

function lintNode(node: FlowNode, options: { commentTriggered: boolean }, warn: (message: string) => void) {
  const texts: string[] = [];

  switch (node.type) {
    case "message": {
      node.contents.forEach((content, i) => {
        if (content.type === "text") {
          texts.push(content.text);
          const withButtons = (content.buttons?.length ?? 0) > 0;
          const usage = textUsage(content.text, withButtons);
          if (extractVariables(content.text).length > 0 && usage.used <= usage.max && usage.used > usage.max - 60) {
            warn(`block ${i + 1} is close to the limit. Filled-in variables can push it over, and Instagram cuts the end.`);
          }
          for (const b of content.buttons ?? []) if (b.type === "url") texts.push(b.url);
        }
        if (content.type === "cards") {
          content.cards.forEach((card, j) => {
            texts.push(card.title, card.subtitle ?? "");
            if (!card.subtitle?.trim() && !card.imageMediaId && !card.imageUrl && card.buttons.length === 0) {
              warn(`block ${i + 1}, card ${j + 1} has only a title. Add a subtitle, an image or a button.`);
            }
            for (const b of card.buttons) if (b.type === "url") texts.push(b.url);
          });
        }
      });
      const last = node.contents[node.contents.length - 1];
      if ((node.quickReplies?.length ?? 0) > 0 && last && last.type !== "text") {
        warn("quick replies show under the last block. Instagram shows them reliably only under a text.");
      }
      break;
    }
    case "input": {
      texts.push(node.prompt, node.retryMessage ?? "");
      const target = parseSaveTo(node.saveTo);
      if (target && target.kind !== "field" && target.kind !== node.inputType) {
        warn(`asks for ${node.inputType} but saves it as ${target.kind}.`);
      }
      break;
    }
    case "action":
      for (const action of node.actions) {
        if (action.type === "set_field") texts.push(action.value);
        if (action.type === "notify") texts.push(action.message);
        if (action.type === "webhook") {
          texts.push(action.url, action.body ?? "", ...Object.values(action.headers ?? {}));
          if (action.method === "GET" && action.body?.trim()) warn("GET requests send no body. Switch to POST to send it.");
        }
      }
      break;
    case "delay":
      if (node.seconds > FLOW_EDITOR_LIMITS.delayWarnSeconds) {
        warn("waits longer than 23 hours. The 24h window will close unless the person writes again, and the run expires.");
      }
      break;
    default:
      break;
  }

  const unknown = new Set<string>();
  let usesComment = false;
  for (const text of texts) {
    for (const name of extractVariables(text)) {
      if (!isKnownVariable(name)) unknown.add(name);
      if (name === "comment") usesComment = true;
    }
  }
  for (const name of unknown) warn(`{{${name}}} is not a known variable and will be empty.`);
  if (usesComment && !options.commentTriggered) {
    warn("{{comment}} stays empty unless a comment campaign starts the flow.");
  }
}

/** Nodes that send first when walking from `start` through steps that send nothing. */
function firstSendNodes(start: FlowNode, byId: Map<string, FlowNode>): FlowNode[] {
  const found: FlowNode[] = [];
  const seen = new Set<string>();
  const stack: FlowNode[] = [start];
  while (stack.length > 0) {
    const node = stack.pop() as FlowNode;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if (node.type === "message" || node.type === "input") {
      found.push(node);
      continue;
    }
    for (const edge of nodeEdges(node)) {
      const target = edge.to ? byId.get(edge.to) : undefined;
      if (target) stack.push(target);
    }
  }
  return found;
}

/** Steps the engine reaches from `node` without a wait (via next chains). */
function immediateFollowers(node: FlowNode, byId: Map<string, FlowNode>): FlowNode[] {
  const out: FlowNode[] = [];
  const seen = new Set<string>([node.id]);
  const stack = nodeEdges(node).filter((e) => e.immediate && e.to).map((e) => e.to as string);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const target = byId.get(id);
    if (!target) continue;
    out.push(target);
    if (target.type === "input") continue;
    for (const edge of nodeEdges(target)) if (edge.immediate && edge.to) stack.push(edge.to);
  }
  return out;
}

/** Nodes on a cycle made only of edges the engine follows without waiting. */
function nodesOnImmediateCycles(graph: FlowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(
      node.id,
      nodeEdges(node)
        .filter((edge) => edge.immediate && edge.to && byId.has(edge.to))
        .map((edge) => edge.to as string)
    );
  }

  // Tarjan's strongly connected components.
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic: FlowNode[] = [];

  const visit = (id: string) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) as number, index.get(next) as number));
      }
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      const selfLoop = component.length === 1 && (adjacency.get(id) ?? []).includes(id);
      if (component.length > 1 || selfLoop) {
        // Report once per loop, on the step that appears first in the list.
        const first = graph.nodes.find((node) => component.includes(node.id));
        if (first) cyclic.push(first);
      }
    }
  };

  for (const node of graph.nodes) if (!index.has(node.id)) visit(node.id);
  return cyclic;
}

// ─── Reference collection (for server-side cross checks) ─────────────────

/** Flow ids a graph starts (start_flow steps and "start flow" buttons). */
export function referencedFlowIds(graph: FlowGraph): { nodeId: string; flowId: string }[] {
  const refs: { nodeId: string; flowId: string }[] = [];
  for (const node of graph.nodes) {
    if (node.type === "start_flow" && node.flowId) refs.push({ nodeId: node.id, flowId: node.flowId });
    if (node.type !== "message") continue;
    for (const content of node.contents) {
      const buttons =
        content.type === "text"
          ? content.buttons ?? []
          : content.type === "cards"
            ? content.cards.flatMap((card) => card.buttons)
            : [];
      for (const button of buttons) {
        if (button.type === "flow" && button.flowId) refs.push({ nodeId: node.id, flowId: button.flowId });
      }
    }
  }
  return refs;
}

/** Uploaded media a graph uses, with the kind each use needs. */
export function referencedMedia(
  graph: FlowGraph
): { nodeId: string; mediaId: string; kind: MediaAssetKind; where: string }[] {
  const refs: { nodeId: string; mediaId: string; kind: MediaAssetKind; where: string }[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "message") continue;
    node.contents.forEach((content, i) => {
      if (
        (content.type === "image" || content.type === "video" || content.type === "audio" || content.type === "file") &&
        content.mediaId
      ) {
        refs.push({ nodeId: node.id, mediaId: content.mediaId, kind: MEDIA_KIND_FOR_CONTENT[content.type], where: `block ${i + 1}` });
      }
      if (content.type === "cards") {
        content.cards.forEach((card, j) => {
          if (card.imageMediaId) {
            refs.push({ nodeId: node.id, mediaId: card.imageMediaId, kind: "IMAGE", where: `block ${i + 1}, card ${j + 1}` });
          }
        });
      }
    });
  }
  return refs;
}
