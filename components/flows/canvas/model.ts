/**
 * Pure graph <-> canvas helpers for the flow canvas: the output handles of
 * every step, connecting a handle to a step, and the left-to-right
 * auto-layout for steps without a stored position. No React here, so the
 * rules are unit-tested (__tests__/flows-canvas-model.test.ts).
 */

import type { FlowButton, FlowGraph, FlowNode } from "@/lib/flows/types";

/** Canvas id of the "When..." trigger card. Never a step id (ids match [A-Za-z0-9_-]). */
export const TRIGGER_NODE_ID = "__trigger__";
export const TRIGGER_HANDLE = "then";

/** Column pitch and the gap between stacked cards. */
export const LAYOUT = {
  column: 380,
  rowGap: 48,
  cardWidth: 288,
  triggerHeight: 180,
} as const;

export interface NodeOutput {
  /** "next", "else", "fail", "btn:<id>", "qr:<id>", "branch:<id>". */
  handle: string;
  label: string;
  target: string | null;
  /** True when the engine waits for the person (tap, answer, delay). */
  waits: boolean;
}

function routedButtons(node: Extract<FlowNode, { type: "message" }>): FlowButton[] {
  return node.contents.flatMap((content) =>
    content.type === "text" ? content.buttons ?? [] : content.type === "cards" ? content.cards.flatMap((card) => card.buttons) : []
  );
}

/** Every output handle of a step, in the order the card shows them. */
export function nodeOutputs(node: FlowNode): NodeOutput[] {
  switch (node.type) {
    case "message": {
      const outputs: NodeOutput[] = routedButtons(node)
        .filter((button): button is Extract<FlowButton, { type: "next" }> => button.type === "next")
        .map((button) => ({ handle: `btn:${button.id}`, label: button.title || "Button", target: button.next, waits: true }));
      for (const reply of node.quickReplies ?? []) {
        outputs.push({ handle: `qr:${reply.id}`, label: reply.title || "Quick reply", target: reply.next, waits: true });
      }
      outputs.push({ handle: "next", label: "Next Step", target: node.next ?? null, waits: false });
      return outputs;
    }
    case "input":
      return [
        { handle: "next", label: "When answered", target: node.next ?? null, waits: true },
        { handle: "fail", label: "If it fails or they skip", target: node.onFail ?? null, waits: true },
      ];
    case "condition":
      return [
        { handle: "next", label: "Yes", target: node.next, waits: false },
        { handle: "else", label: "No", target: node.elseNext, waits: false },
      ];
    case "action":
      return [{ handle: "next", label: "Next Step", target: node.next ?? null, waits: false }];
    case "delay":
      return [{ handle: "next", label: "Next Step", target: node.next ?? null, waits: true }];
    case "randomizer":
      return node.branches.map((branch, i) => ({
        handle: `branch:${branch.id}`,
        label: `${String.fromCharCode(65 + i)} · ${branch.weight}%`,
        target: branch.next,
        waits: false,
      }));
    case "start_flow":
    case "ai_handoff":
      return [];
  }
}

function setButtonTarget(buttons: FlowButton[] | undefined, id: string, target: string | null): FlowButton[] | undefined {
  return buttons?.map((b) => (b.id === id && b.type === "next" ? { ...b, next: target } : b));
}

/** Points one output handle of a step at `target` (null = end the flow there). */
export function connectNodeOutput(node: FlowNode, handle: string, target: string | null): FlowNode {
  if (handle.startsWith("btn:") && node.type === "message") {
    const id = handle.slice(4);
    return {
      ...node,
      contents: node.contents.map((content) => {
        if (content.type === "text") return { ...content, buttons: setButtonTarget(content.buttons, id, target) };
        if (content.type === "cards") {
          return { ...content, cards: content.cards.map((card) => ({ ...card, buttons: setButtonTarget(card.buttons, id, target) ?? [] })) };
        }
        return content;
      }),
    };
  }
  if (handle.startsWith("qr:") && node.type === "message") {
    const id = handle.slice(3);
    return { ...node, quickReplies: node.quickReplies?.map((q) => (q.id === id ? { ...q, next: target } : q)) };
  }
  if (handle.startsWith("branch:") && node.type === "randomizer") {
    const id = handle.slice(7);
    return { ...node, branches: node.branches.map((b) => (b.id === id ? { ...b, next: target } : b)) };
  }
  if (handle === "else" && node.type === "condition") return { ...node, elseNext: target };
  if (handle === "fail" && node.type === "input") return { ...node, onFail: target };
  if (handle === "next") {
    switch (node.type) {
      case "message":
      case "input":
      case "action":
      case "delay":
        return { ...node, next: target };
      case "condition":
        return { ...node, next: target };
      default:
        return node;
    }
  }
  return node;
}

/** Connects a canvas handle (a step's output, or the trigger card) to a step. */
export function connectOutput(graph: FlowGraph, source: string, handle: string, target: string | null): FlowGraph {
  if (source === TRIGGER_NODE_ID) return { ...graph, startNodeId: target };
  if (target !== null && !graph.nodes.some((n) => n.id === target)) return graph;
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === source ? connectNodeOutput(n, handle, target) : n)) };
}

/** The step an output currently points at. */
export function outputTarget(graph: FlowGraph, source: string, handle: string): string | null {
  if (source === TRIGGER_NODE_ID) return graph.startNodeId;
  const node = graph.nodes.find((n) => n.id === source);
  return node ? nodeOutputs(node).find((o) => o.handle === handle)?.target ?? null : null;
}

export interface CanvasEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  waits: boolean;
}

/** Edges to draw: the trigger card to the start step, then every routed output. */
export function graphEdges(graph: FlowGraph): CanvasEdge[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edges: CanvasEdge[] = [];
  if (graph.startNodeId && ids.has(graph.startNodeId)) {
    edges.push({
      id: `${TRIGGER_NODE_ID}:${TRIGGER_HANDLE}`,
      source: TRIGGER_NODE_ID,
      sourceHandle: TRIGGER_HANDLE,
      target: graph.startNodeId,
      waits: false,
    });
  }
  for (const node of graph.nodes) {
    for (const output of nodeOutputs(node)) {
      if (!output.target || !ids.has(output.target)) continue;
      edges.push({ id: `${node.id}:${output.handle}`, source: node.id, sourceHandle: output.handle, target: output.target, waits: output.waits });
    }
  }
  return edges;
}

/** Splits a canvas edge id back into its source and handle. */
export function parseEdgeId(id: string): { source: string; handle: string } | null {
  const at = id.indexOf(":");
  if (at <= 0) return null;
  return { source: id.slice(0, at), handle: id.slice(at + 1) };
}

// ─── Layout ───────────────────────────────────────────────────────────────

/** Rough card height before the browser measures it (only used for stacking). */
export function estimateHeight(node: FlowNode): number {
  const base = 96;
  switch (node.type) {
    case "message": {
      let h = base;
      for (const content of node.contents) {
        if (content.type === "text") h += 64 + (content.buttons?.length ?? 0) * 40;
        else if (content.type === "cards") h += 150 + Math.max(0, ...content.cards.map((c) => c.buttons.length)) * 36;
        else if (content.type === "typing") h += 32;
        else h += 96;
      }
      return h + (node.quickReplies?.length ?? 0) * 36;
    }
    case "input":
      return base + 120;
    case "randomizer":
      return base + node.branches.length * 36;
    case "condition":
      return base + 100;
    case "action":
      return base + 24 + node.actions.length * 28;
    default:
      return base + 40;
  }
}

/** Depth of every step reachable from the start (start = 1, the trigger card is 0). */
function depths(graph: FlowGraph): Map<string, number> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const depth = new Map<string, number>();
  if (graph.startNodeId && byId.has(graph.startNodeId)) {
    depth.set(graph.startNodeId, 1);
    const queue = [graph.startNodeId];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const node = byId.get(id) as FlowNode;
      for (const output of nodeOutputs(node)) {
        if (output.target && byId.has(output.target) && !depth.has(output.target)) {
          depth.set(output.target, (depth.get(id) as number) + 1);
          queue.push(output.target);
        }
      }
    }
  }
  return depth;
}

/**
 * Gives every step without a position one, left to right by depth from the
 * start (unreachable steps go one column past the deepest), stacked under
 * whatever already sits in that column. Positioned steps never move. The
 * trigger card defaults to the column before the start step. Returns the
 * same graph object when nothing was missing.
 */
export function autoLayout(graph: FlowGraph): FlowGraph {
  const missing = graph.nodes.filter((n) => !n.position);
  if (missing.length === 0 && graph.triggerPosition) return graph;

  const depth = depths(graph);
  const maxDepth = Math.max(1, ...depth.values());
  const start = graph.nodes.find((n) => n.id === graph.startNodeId);
  const origin = graph.triggerPosition ?? (start?.position ? { x: start.position.x - LAYOUT.column, y: start.position.y } : { x: 0, y: 0 });

  // Bottom edge of each column, seeded with the trigger card and positioned steps.
  const columnOf = (x: number) => Math.round((x - origin.x) / LAYOUT.column);
  const bottoms = new Map<number, number>([[0, origin.y + LAYOUT.triggerHeight]]);
  for (const node of graph.nodes) {
    if (!node.position) continue;
    const col = columnOf(node.position.x);
    bottoms.set(col, Math.max(bottoms.get(col) ?? -Infinity, node.position.y + estimateHeight(node)));
  }

  const placed = new Map<string, { x: number; y: number }>();
  const ordered = [...missing].sort((a, b) => (depth.get(a.id) ?? maxDepth + 1) - (depth.get(b.id) ?? maxDepth + 1));
  for (const node of ordered) {
    const col = depth.get(node.id) ?? maxDepth + 1;
    const bottom = bottoms.get(col);
    const y = bottom === undefined ? origin.y : bottom + LAYOUT.rowGap;
    const position = { x: origin.x + col * LAYOUT.column, y };
    placed.set(node.id, position);
    bottoms.set(col, y + estimateHeight(node));
  }

  return {
    ...graph,
    triggerPosition: graph.triggerPosition ?? origin,
    nodes: graph.nodes.map((n) => (n.position ? n : { ...n, position: placed.get(n.id) as { x: number; y: number } })),
  };
}

/** Where a new step goes when it is created from `sourceId` (one column right, below what is there). */
export function positionAfter(graph: FlowGraph, sourceId: string | null): { x: number; y: number } {
  const source =
    sourceId === TRIGGER_NODE_ID
      ? { position: graph.triggerPosition ?? { x: 0, y: 0 } }
      : graph.nodes.find((n) => n.id === sourceId);
  const from = source?.position ?? { x: 0, y: 0 };
  const x = from.x + LAYOUT.column;
  const inColumn = graph.nodes.filter((n) => n.position && Math.abs(n.position.x - x) < LAYOUT.column / 2);
  const overlap = inColumn.some((n) => Math.abs((n.position as { y: number }).y - from.y) < 120);
  if (!overlap) return { x, y: from.y };
  const bottom = Math.max(...inColumn.map((n) => (n.position as { y: number }).y + estimateHeight(n)));
  return { x, y: bottom + LAYOUT.rowGap };
}

/** Moves steps (and the trigger card) to new positions. */
export function moveNodes(graph: FlowGraph, positions: Map<string, { x: number; y: number }>): FlowGraph {
  const trigger = positions.get(TRIGGER_NODE_ID);
  return {
    ...graph,
    ...(trigger ? { triggerPosition: { x: Math.round(trigger.x), y: Math.round(trigger.y) } } : {}),
    nodes: graph.nodes.map((n) => {
      const next = positions.get(n.id);
      return next ? { ...n, position: { x: Math.round(next.x), y: Math.round(next.y) } } : n;
    }),
  };
}
