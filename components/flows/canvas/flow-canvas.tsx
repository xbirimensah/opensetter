"use client";

/**
 * The flow canvas (React Flow v12). Pan by dragging the background, zoom
 * with the wheel, a pinch or the controls. Cards follow the pointer 1:1
 * and their positions are stored on the steps. Drag from any output
 * handle: drop on a card to connect, drop on empty canvas to pick the
 * next step's type and create it connected.
 */

import "@xyflow/react/dist/base.css";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionLineType,
  EdgeLabelRenderer,
  getBezierPath,
  ReactFlow,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FlowGraph } from "@/lib/flows/types";
import { Icon } from "../icons";
import { PRESS } from "../ui";
import { CanvasContext, type CanvasContextValue } from "./canvas-context";
import { NODE_TYPES, type StepCanvasNode, type TriggerCanvasNode } from "./canvas-nodes";
import { connectOutput, graphEdges, LAYOUT, moveNodes, parseEdgeId, TRIGGER_NODE_ID } from "./model";
import { StepTypeMenu, type StepPreset } from "./step-type-menu";
import { stepTitle } from "./summaries";

export interface ConnectionSource {
  source: string;
  handle: string;
}

type CanvasEdgeData = { waits: boolean };
type CanvasRFEdge = Edge<CanvasEdgeData, "flow">;

const EdgeActions = createContext<{ remove: (id: string) => void }>({ remove: () => undefined });

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps<CanvasRFEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const { remove } = useContext(EdgeActions);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: selected ? "var(--color-accent)" : "var(--color-border-hover)",
          strokeWidth: selected ? 2.25 : 1.75,
          strokeDasharray: data?.waits ? "6 5" : undefined,
          transition: "stroke 150ms ease-out",
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Remove connection"
            title="Remove connection"
            onClick={() => remove(id)}
            className={`nodrag nopan pointer-events-auto absolute grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted shadow-lg hover:text-error ${PRESS}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Icon.close className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES = { flow: FlowEdgeView };

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const duration = reducedMotion() ? 0 : 220;
  const button = `grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground sm:h-9 sm:w-9 ${PRESS}`;
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-surface/85 p-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 [@media(prefers-reduced-transparency:reduce)]:bg-surface">
      <button type="button" aria-label="Zoom out" title="Zoom out" className={`${button} max-md:hidden`} onClick={() => void zoomOut({ duration })}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
      <span className="w-11 text-center text-[11px] font-medium tabular-nums text-muted max-md:hidden" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="Zoom in" title="Zoom in" className={`${button} max-md:hidden`} onClick={() => void zoomIn({ duration })}>
        <Icon.plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Fit to view"
        title="Fit to view"
        className={button}
        onClick={() => void fitView({ duration, padding: 0.2, maxZoom: 1 })}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" />
        </svg>
      </button>
    </div>
  );
}

interface MenuRequest {
  /** Container-relative anchor. */
  x: number;
  y: number;
  flowPosition: { x: number; y: number };
  from: ConnectionSource | null;
  align: "point" | "above";
}

export interface FlowCanvasProps {
  graph: FlowGraph;
  selectedId: string | null;
  errorCounts: Map<string, number>;
  warningCounts: Map<string, number>;
  context: CanvasContextValue;
  /** Space covered by floating panels, so selecting a card scrolls it clear. */
  insets: { top: number; left: number; bottom: number; right: number };
  /** Hide the floating canvas controls (phone sheet open). */
  chromeHidden: boolean;
  onSelect: (id: string | null) => void;
  onGraphChange: (update: (graph: FlowGraph) => FlowGraph, key: string | null) => void;
  onDeleteNodes: (ids: string[]) => void;
  onAddStep: (preset: StepPreset, from: ConnectionSource | null, position: { x: number; y: number }) => void;
}

export function FlowCanvas(props: FlowCanvasProps) {
  const { graph, selectedId, errorCounts, warningCounts, context, insets, chromeHidden, onSelect, onGraphChange, onDeleteNodes, onAddStep } =
    props;
  const flow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);

  const nodes = useMemo(() => {
    const trigger: TriggerCanvasNode = {
      id: TRIGGER_NODE_ID,
      type: "trigger",
      position: graph.triggerPosition ?? { x: 0, y: 0 },
      data: {},
      deletable: false,
      selected: selectedId === TRIGGER_NODE_ID,
      measured: measured[TRIGGER_NODE_ID],
      ariaLabel: "Trigger: When...",
    };
    const steps: StepCanvasNode[] = graph.nodes.map((node) => ({
      id: node.id,
      type: "step",
      position: node.position ?? { x: 0, y: 0 },
      data: {
        node,
        isStart: graph.startNodeId === node.id,
        errorCount: errorCounts.get(node.id) ?? 0,
        warningCount: warningCounts.get(node.id) ?? 0,
      },
      selected: selectedId === node.id,
      measured: measured[node.id],
      ariaLabel: `Step ${stepTitle(node)}`,
    }));
    return [trigger, ...steps];
  }, [graph, selectedId, errorCounts, warningCounts, measured]);

  const edges = useMemo<CanvasRFEdge[]>(
    () =>
      graphEdges(graph).map((edge) => ({
        id: edge.id,
        type: "flow",
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        data: { waits: edge.waits },
        selected: edge.id === selectedEdge,
      })),
    [graph, selectedEdge]
  );

  function removeEdge(id: string) {
    const parsed = parseEdgeId(id);
    if (!parsed) return;
    setSelectedEdge(null);
    onGraphChange((g) => connectOutput(g, parsed.source, parsed.handle, null), null);
  }

  function onNodesChange(changes: NodeChange[]) {
    const positions = new Map<string, { x: number; y: number }>();
    const removed: string[] = [];
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const change of changes) {
      if (change.type === "position" && change.position) positions.set(change.id, change.position);
      else if (change.type === "dimensions" && change.dimensions) sizes[change.id] = change.dimensions;
      else if (change.type === "remove" && change.id !== TRIGGER_NODE_ID) removed.push(change.id);
    }
    if (Object.keys(sizes).length > 0) {
      setMeasured((current) => {
        const changed = Object.entries(sizes).some(
          ([id, size]) => current[id]?.width !== size.width || current[id]?.height !== size.height
        );
        return changed ? { ...current, ...sizes } : current;
      });
    }
    if (positions.size > 0) {
      onGraphChange((g) => moveNodes(g, positions), `move:${[...positions.keys()].sort().join(",")}`);
    }
    if (removed.length > 0) onDeleteNodes(removed);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    for (const change of changes) {
      if (change.type === "select") setSelectedEdge(change.selected ? change.id : null);
      if (change.type === "remove") removeEdge(change.id);
    }
  }

  function onConnect(connection: Connection) {
    if (!connection.sourceHandle || connection.target === TRIGGER_NODE_ID) return;
    const { source, sourceHandle, target } = connection;
    onGraphChange((g) => connectOutput(g, source, sourceHandle, target), null);
  }

  const onConnectEnd: OnConnectEnd = (event, state) => {
    if (state.isValid || !state.fromNode || !state.fromHandle || state.fromHandle.type !== "source") return;
    const from = { source: state.fromNode.id, handle: state.fromHandle.id ?? "next" };
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    // Dropped on a card body (not exactly on its handle): connect to it.
    const element = document.elementFromPoint(point.clientX, point.clientY);
    const card = element?.closest<HTMLElement>(".react-flow__node");
    const targetId = card?.dataset.id;
    if (targetId && targetId !== TRIGGER_NODE_ID) {
      onGraphChange((g) => connectOutput(g, from.source, from.handle, targetId), null);
      return;
    }
    if (!element?.closest(".react-flow__pane")) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const flowPosition = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    setMenu({
      x: point.clientX - box.left,
      y: point.clientY - box.top,
      flowPosition: { x: flowPosition.x, y: flowPosition.y - 26 },
      from,
      align: "point",
    });
  };

  function openAddMenu(anchor: HTMLElement) {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const rect = anchor.getBoundingClientRect();
    // New cards land in the middle of the visible canvas (clear of the panels).
    const centre = flow.screenToFlowPosition({
      x: box.left + insets.left + (box.width - insets.left - insets.right) / 2,
      y: box.top + insets.top + (box.height - insets.top - insets.bottom) / 2,
    });
    setMenu({
      x: rect.left + rect.width / 2 - box.left,
      y: rect.top - box.top,
      flowPosition: { x: centre.x - LAYOUT.cardWidth / 2, y: centre.y - 80 },
      from: null,
      align: "above",
    });
  }

  const insetsRef = useRef(insets);
  useEffect(() => {
    insetsRef.current = insets;
  });

  // Fit everything once every card has been measured (React Flow's own
  // fitView can run before controlled nodes report their size).
  const fittedRef = useRef(false);
  const measuredCount = Object.keys(measured).length;
  useEffect(() => {
    if (fittedRef.current || measuredCount < nodes.length) return;
    fittedRef.current = true;
    const box = containerRef.current?.getBoundingClientRect();
    // On a phone the whole flow would be unreadably small: start with the
    // trigger card and the first step instead.
    const narrow = (box?.width ?? 1024) < 768;
    const start = graph.startNodeId;
    const focus = narrow ? [{ id: TRIGGER_NODE_ID }, ...(start ? [{ id: start }] : [])] : undefined;
    void flow.fitView({ padding: 0.2, maxZoom: narrow ? 0.85 : 1, duration: 0, nodes: focus }).then(() => {
      // Keep the cards clear of the floating top bar.
      if (!box) return;
      const viewport = flow.getViewport();
      void flow.setViewport({ ...viewport, y: viewport.y + insetsRef.current.top / 2 });
    });
    // Runs once; graph.startNodeId is read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuredCount, nodes.length, flow]);

  // Selecting a card that sits under a floating panel scrolls it clear.
  // Runs once per selection: `flow` changes identity between renders, and a
  // re-run during the pan animation would add the offset again.
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
  });
  useEffect(() => {
    if (!selectedId) return;
    const flow = flowRef.current;
    const timer = window.setTimeout(() => {
      const box = containerRef.current?.getBoundingClientRect();
      const internal = flow.getInternalNode(selectedId);
      if (!box || !internal?.measured.width || !internal.measured.height) return;
      const { left, top, right, bottom } = insetsRef.current;
      const viewport = flow.getViewport();
      const pos = internal.internals.positionAbsolute;
      const x0 = pos.x * viewport.zoom + viewport.x;
      const y0 = pos.y * viewport.zoom + viewport.y;
      const x1 = x0 + internal.measured.width * viewport.zoom;
      const y1 = y0 + Math.min(internal.measured.height, 240) * viewport.zoom;
      const margin = 24;
      let dx = 0;
      let dy = 0;
      if (x0 < left + margin) dx = left + margin - x0;
      else if (x1 > box.width - right - margin) dx = Math.max(left + margin - x0, box.width - right - margin - x1);
      if (y1 > box.height - bottom - margin) dy = box.height - bottom - margin - y1;
      if (y0 + dy < top + margin) dy = top + margin - y0;
      if (dx === 0 && dy === 0) return;
      void flow.setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, { duration: reducedMotion() ? 0 : 320 });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  const edgeActions = { remove: removeEdge };

  return (
    <CanvasContext.Provider value={context}>
      <EdgeActions.Provider value={edgeActions}>
        <div ref={containerRef} className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodeClick={(_, node) => {
              setSelectedEdge(null);
              onSelect(node.id);
            }}
            onPaneClick={() => {
              setSelectedEdge(null);
              setMenu(null);
              onSelect(null);
            }}
            isValidConnection={(connection) => connection.target !== TRIGGER_NODE_ID && Boolean(connection.sourceHandle)}
            minZoom={0.2}
            maxZoom={1.75}
            nodeDragThreshold={3}
            connectionRadius={28}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineStyle={{ stroke: "var(--color-accent)", strokeWidth: 2 }}
            deleteKeyCode={["Backspace", "Delete"]}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            selectNodesOnDrag={false}
            elevateEdgesOnSelect
            zoomOnDoubleClick={false}
            attributionPosition="bottom-center"
            className="flow-canvas"
            style={
              {
                background: "var(--color-background)",
                "--xy-edge-stroke-default": "var(--color-border-hover)",
                "--xy-edge-stroke-selected-default": "var(--color-accent)",
                "--xy-connectionline-stroke-default": "var(--color-accent)",
                "--xy-attribution-background-color-default": "transparent",
              } as React.CSSProperties
            }
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} color="var(--color-border-hover)" />
            {!chromeHidden && (
              <div
                className="pointer-events-none absolute z-10 flex items-center gap-2"
                style={{ right: insets.right + 12, bottom: 12 }}
              >
                <ZoomControls />
                <button
                  type="button"
                  aria-label="Add a step"
                  title="Add a step"
                  onClick={(event) => openAddMenu(event.currentTarget)}
                  className={`pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-[0_10px_28px_-8px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] hover:bg-accent-hover ${PRESS}`}
                >
                  <Icon.plus className="h-5 w-5" />
                </button>
              </div>
            )}
          </ReactFlow>
          {menu && (
            <StepTypeMenu
              x={menu.x}
              y={menu.y}
              align={menu.align}
              connected={Boolean(menu.from)}
              onClose={() => setMenu(null)}
              onPick={(preset) => {
                const request = menu;
                setMenu(null);
                onAddStep(preset, request.from, request.flowPosition);
              }}
            />
          )}
        </div>
      </EdgeActions.Provider>
    </CanvasContext.Provider>
  );
}
