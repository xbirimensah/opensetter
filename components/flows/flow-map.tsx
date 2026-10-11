"use client";

/**
 * Read-only overview of the flow: steps laid out by distance from the
 * start, edges as curves. Tapping a step scrolls the editor to it.
 */

import type { FlowGraph, FlowNodeType } from "@/lib/flows/types";
import { nodeEdges } from "@/lib/flows/validate";

const WIDTH = 300;
const NODE_HEIGHT = 30;
const ROW_GAP = 34;
const COL_GAP = 8;
const MAX_NODE_WIDTH = 96;
const PAD = 8;

const TYPE_STROKE: Record<FlowNodeType, string> = {
  message: "var(--color-accent)",
  input: "var(--color-success)",
  condition: "var(--color-warning)",
  action: "var(--color-accent)",
  delay: "var(--color-muted)",
  randomizer: "var(--color-warning)",
  start_flow: "var(--color-accent)",
  ai_handoff: "var(--color-success)",
};

function layers(graph: FlowGraph): string[][] {
  const depth = new Map<string, number>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  if (graph.startNodeId && byId.has(graph.startNodeId)) {
    depth.set(graph.startNodeId, 0);
    const queue = [graph.startNodeId];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const node = byId.get(id);
      if (!node) continue;
      for (const edge of nodeEdges(node)) {
        if (edge.to && byId.has(edge.to) && !depth.has(edge.to)) {
          depth.set(edge.to, (depth.get(id) ?? 0) + 1);
          queue.push(edge.to);
        }
      }
    }
  }
  const maxDepth = Math.max(-1, ...depth.values());
  const rows: string[][] = [];
  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? maxDepth + 1;
    (rows[d] ??= []).push(node.id);
  }
  return rows.filter(Boolean);
}

export function FlowMap({
  graph,
  selectedId,
  errorIds,
  onSelect,
}: {
  graph: FlowGraph;
  selectedId: string | null;
  errorIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  if (graph.nodes.length === 0) {
    return <p className="py-8 text-center text-xs text-muted">No steps yet.</p>;
  }

  const rows = layers(graph);
  const indexOf = new Map(graph.nodes.map((n, i) => [n.id, i] as const));
  const positions = new Map<string, { x: number; y: number; w: number }>();
  rows.forEach((row, r) => {
    const w = Math.min(MAX_NODE_WIDTH, (WIDTH - PAD * 2 - COL_GAP * (row.length - 1)) / row.length);
    const total = w * row.length + COL_GAP * (row.length - 1);
    const startX = (WIDTH - total) / 2;
    row.forEach((id, c) => positions.set(id, { x: startX + c * (w + COL_GAP), y: PAD + r * (NODE_HEIGHT + ROW_GAP), w }));
  });
  const height = PAD * 2 + rows.length * NODE_HEIGHT + (rows.length - 1) * ROW_GAP;

  const edges = graph.nodes.flatMap((node) =>
    nodeEdges(node)
      .filter((edge) => edge.to && positions.has(edge.to))
      .map((edge, i) => ({ ...edge, key: `${node.id}-${i}` }))
  );

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label="Flow overview">
      {edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to as string);
        if (!from || !to) return null;
        const x1 = from.x + from.w / 2;
        const y1 = from.y + NODE_HEIGHT;
        const x2 = to.x + to.w / 2;
        const y2 = to.y;
        const backwards = y2 <= from.y;
        const d = backwards
          ? `M ${from.x + from.w} ${from.y + NODE_HEIGHT / 2} C ${WIDTH - 2} ${from.y}, ${WIDTH - 2} ${to.y + NODE_HEIGHT}, ${to.x + to.w} ${to.y + NODE_HEIGHT / 2}`
          : `M ${x1} ${y1} C ${x1} ${y1 + ROW_GAP / 2}, ${x2} ${y2 - ROW_GAP / 2}, ${x2} ${y2}`;
        return (
          <path
            key={edge.key}
            d={d}
            fill="none"
            stroke="var(--color-border-hover)"
            strokeWidth={1.25}
            strokeDasharray={edge.immediate ? undefined : "3 3"}
          />
        );
      })}
      {graph.nodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const index = indexOf.get(node.id) ?? 0;
        const selected = node.id === selectedId;
        const hasError = errorIds.has(node.id);
        const label = `${index + 1}. ${node.name?.trim() || node.type.replace("_", " ")}`;
        const maxChars = Math.max(4, Math.floor((pos.w - 12) / 6));
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`Go to ${label}`}
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(node.id);
              }
            }}
            className="cursor-pointer outline-none"
          >
            <rect
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={NODE_HEIGHT}
              rx={8}
              fill={selected ? "color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))" : "var(--color-surface)"}
              stroke={hasError ? "var(--color-error)" : selected ? "var(--color-accent)" : "var(--color-border)"}
              strokeWidth={selected || hasError ? 1.5 : 1}
            />
            <rect x={pos.x} y={pos.y + 8} width={3} height={NODE_HEIGHT - 16} rx={1.5} fill={TYPE_STROKE[node.type]} />
            {node.id === graph.startNodeId && <circle cx={pos.x + pos.w - 6} cy={pos.y + 6} r={2.5} fill="var(--color-accent)" />}
            <text
              x={pos.x + 9}
              y={pos.y + NODE_HEIGHT / 2 + 3.5}
              fontSize={10}
              fill="var(--color-foreground)"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
