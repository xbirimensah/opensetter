/**
 * Pure graph edits for the flow editor. Every function returns a new graph
 * or node; nothing is mutated in place.
 */

import type {
  FlowAction,
  FlowButton,
  FlowCard,
  FlowContent,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowRule,
  FlowRuleSubject,
  FlowTrigger,
  FlowTriggerType,
} from "@/lib/flows/types";
import { nodeDisplayName, parseSaveTo, RULE_OPS } from "@/lib/flows/validate";

/** Short random id; getRandomValues also works on plain-http self-hosted setups. */
export function newId(prefix = "n"): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ─── Factories ────────────────────────────────────────────────────────────

export function createContent(type: FlowContent["type"]): FlowContent {
  const id = newId("c");
  switch (type) {
    case "text":
      return { id, type, text: "" };
    case "cards":
      return { id, type, cards: [createCard()] };
    case "typing":
      return { id, type, seconds: 2 };
    default:
      return { id, type };
  }
}

export function createCard(): FlowCard {
  return { id: newId("k"), title: "", subtitle: "", buttons: [] };
}

export function createButton(type: FlowButton["type"]): FlowButton {
  const id = newId("b");
  if (type === "url") return { id, type, title: "Open link", url: "", track: true };
  if (type === "flow") return { id, type, title: "", flowId: "" };
  return { id, type, title: "", next: null };
}

export function createRule(subject: FlowRuleSubject = "tag"): FlowRule {
  const op = RULE_OPS[subject][0];
  return { id: newId("r"), subject, op, ...(subject === "field" ? { key: "" } : {}), value: "" };
}

export function createAction(type: FlowAction["type"]): FlowAction {
  const id = newId("a");
  switch (type) {
    case "add_tag":
    case "remove_tag":
      return { id, type, tag: "" };
    case "set_field":
      return { id, type, key: "", value: "" };
    case "clear_field":
      return { id, type, key: "" };
    case "webhook":
      return { id, type, url: "", method: "POST" };
    case "notify":
      return { id, type, message: "" };
    case "pause_ai":
    case "resume_ai":
      return { id, type };
  }
}

export function createNode(type: FlowNodeType): FlowNode {
  const id = newId("n");
  switch (type) {
    case "message":
      return { id, type, contents: [createContent("text")] };
    case "input":
      return {
        id,
        type,
        prompt: "",
        inputType: "email",
        saveTo: "email",
        retryMessage: "That does not look right. Could you send it again?",
        maxRetries: 2,
        timeoutMinutes: 1440,
        next: null,
        onFail: null,
      };
    case "condition":
      return { id, type, match: "all", rules: [createRule("tag")], next: null, elseNext: null };
    case "action":
      return { id, type, actions: [createAction("add_tag")], next: null };
    case "delay":
      return { id, type, seconds: 3600, next: null };
    case "randomizer":
      return {
        id,
        type,
        branches: [
          { id: newId("r"), weight: 50, next: null },
          { id: newId("r"), weight: 50, next: null },
        ],
      };
    case "start_flow":
      return { id, type, flowId: "" };
    case "ai_handoff":
      return { id, type };
  }
}

export function createTrigger(type: FlowTriggerType): FlowTrigger {
  const id = newId("t");
  switch (type) {
    case "dm_keyword":
      return { id, type, keywords: [], match: "whole_word" };
    case "story_reply":
      // Empty means any story reply; keywords are opt-in in the editor.
      return { id, type };
    case "story_mention":
      return { id, type, oncePer24h: true };
    case "ref_link":
      return { id, type, ref: newId("ref").replace("_", "-") };
    case "default_reply":
      return { id, type, oncePer24h: true };
    case "welcome":
    case "new_follower":
      return { id, type };
  }
}

// ─── Graph edits ──────────────────────────────────────────────────────────

export function replaceNode(graph: FlowGraph, id: string, node: FlowNode): FlowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? node : n)) };
}

/** Appends a node (after `afterId` when given). The first node becomes the start. */
export function addNode(graph: FlowGraph, node: FlowNode, afterId?: string): FlowGraph {
  const index = afterId ? graph.nodes.findIndex((n) => n.id === afterId) : -1;
  const nodes =
    index >= 0
      ? [...graph.nodes.slice(0, index + 1), node, ...graph.nodes.slice(index + 1)]
      : [...graph.nodes, node];
  return { startNodeId: graph.startNodeId ?? node.id, nodes };
}

function mapButtons(buttons: FlowButton[], fn: (ref: string | null) => string | null): FlowButton[] {
  return buttons.map((b) => (b.type === "next" ? { ...b, next: fn(b.next) } : b));
}

/** Rewrites every routing reference of a node. */
export function mapNodeRefs(node: FlowNode, fn: (ref: string | null) => string | null): FlowNode {
  const opt = (ref: string | null | undefined) => (ref === undefined ? undefined : fn(ref));
  switch (node.type) {
    case "message":
      return {
        ...node,
        contents: node.contents.map((content) => {
          if (content.type === "text" && content.buttons) return { ...content, buttons: mapButtons(content.buttons, fn) };
          if (content.type === "cards") {
            return { ...content, cards: content.cards.map((card) => ({ ...card, buttons: mapButtons(card.buttons, fn) })) };
          }
          return content;
        }),
        quickReplies: node.quickReplies?.map((q) => ({ ...q, next: fn(q.next) })),
        next: opt(node.next),
      };
    case "input":
      return { ...node, next: opt(node.next), onFail: opt(node.onFail) };
    case "condition":
      return { ...node, next: fn(node.next), elseNext: fn(node.elseNext) };
    case "action":
    case "delay":
      return { ...node, next: opt(node.next) };
    case "randomizer":
      return { ...node, branches: node.branches.map((b) => ({ ...b, next: fn(b.next) })) };
    default:
      return node;
  }
}

/** Deletes a node and sets every reference to it to "end flow". */
export function removeNode(graph: FlowGraph, id: string): FlowGraph {
  const nodes = graph.nodes
    .filter((n) => n.id !== id)
    .map((n) => mapNodeRefs(n, (ref) => (ref === id ? null : ref)));
  const startNodeId = graph.startNodeId === id ? nodes[0]?.id ?? null : graph.startNodeId;
  return { startNodeId, nodes };
}

function reidButtons(buttons: FlowButton[]): FlowButton[] {
  return buttons.map((b) => ({ ...b, id: newId("b") }));
}

/** A copy of a node with fresh ids for it and everything inside it. */
export function cloneNodeWithNewIds(node: FlowNode): FlowNode {
  const base = { ...node, id: newId("n"), name: node.name ? `${node.name} copy` : undefined };
  switch (base.type) {
    case "message":
      return {
        ...base,
        contents: base.contents.map((content): FlowContent => {
          if (content.type === "text") {
            return { ...content, id: newId("c"), buttons: content.buttons ? reidButtons(content.buttons) : undefined };
          }
          if (content.type === "cards") {
            return {
              ...content,
              id: newId("c"),
              cards: content.cards.map((card) => ({ ...card, id: newId("k"), buttons: reidButtons(card.buttons) })),
            };
          }
          return { ...content, id: newId("c") };
        }),
        quickReplies: base.quickReplies?.map((q) => ({ ...q, id: newId("q") })),
      };
    case "condition":
      return { ...base, rules: base.rules.map((r) => ({ ...r, id: newId("r") })) };
    case "action":
      return { ...base, actions: base.actions.map((a) => ({ ...a, id: newId("a") })) };
    case "randomizer":
      return { ...base, branches: base.branches.map((b) => ({ ...b, id: newId("r") })) };
    default:
      return base;
  }
}

/** Moves item `index` of a list one place up or down (new array). */
export function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ─── Read helpers ─────────────────────────────────────────────────────────

export function stepOptions(graph: FlowGraph): { id: string; label: string }[] {
  return graph.nodes.map((node, index) => ({ id: node.id, label: stepLabel(node, index) }));
}

/** "3. Welcome" or "3. Message". */
export function stepLabel(node: FlowNode, index: number): string {
  const name = node.name?.trim();
  return name ? `${index + 1}. ${name}` : nodeDisplayName(node, index).replace(/^Step (\d+) \((.*)\)$/, "$1. $2");
}

/** Custom field names the flow already mentions, for suggestions. */
export function collectFieldNames(graph: FlowGraph): string[] {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === "input") {
      const target = parseSaveTo(node.saveTo);
      if (target?.kind === "field") names.add(target.key);
    }
    if (node.type === "action") {
      for (const action of node.actions) {
        if ((action.type === "set_field" || action.type === "clear_field") && action.key) names.add(action.key);
        if (action.type === "webhook") for (const save of action.saveResponse ?? []) if (save.key) names.add(save.key);
      }
    }
    if (node.type === "condition") {
      for (const rule of node.rules) if (rule.subject === "field" && rule.key) names.add(rule.key);
    }
  }
  return [...names].sort();
}

export function collectTags(graph: FlowGraph): string[] {
  const tags = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === "action") {
      for (const action of node.actions) {
        if ((action.type === "add_tag" || action.type === "remove_tag") && action.tag.trim()) tags.add(action.tag.trim());
      }
    }
    if (node.type === "condition") {
      for (const rule of node.rules) if (rule.subject === "tag" && rule.value?.trim()) tags.add(rule.value.trim());
    }
  }
  return [...tags].sort();
}

const DURATION_UNITS: [number, string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
];

export function formatDuration(seconds: number): string {
  for (const [size, unit] of DURATION_UNITS) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
