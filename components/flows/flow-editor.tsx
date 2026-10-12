"use client";

/**
 * Flow Editor (ManyChat-style canvas)
 *
 * A canvas of cards (components/flows/canvas): the "When..." trigger card
 * on the left, one card per step, curved connections between their
 * handles. The selected card is edited in a floating sidebar (a bottom
 * sheet on phones) that reuses the step editors. A translucent top bar
 * holds the name, status, save state, undo / redo, Preview and Set Live.
 *
 * The whole draft (graph, triggers, name) is one undoable document
 * (canvas/use-flow-document). Drafts autosave; a live flow publishes on
 * demand. Comment triggers are the flow's Automation rows, synced by the
 * flow API.
 */

import { ReactFlowProvider } from "@xyflow/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "@/components/inbox/use-media-query";
import { createCommentTrigger, isCommentTrigger, triggersForCopy } from "@/lib/flows/comment-triggers";
import type { EditorTrigger, FlowGraph, FlowNode } from "@/lib/flows/types";
import { FLOW_VARIABLES } from "@/lib/flows/validate";
import { FlowEditorContext, type FlowEditorContextValue } from "./editor-context";
import {
  addNode,
  cloneNodeWithNewIds,
  collectFieldNames,
  collectTags,
  createNode,
  newId,
  removeNode,
  replaceNode,
  stepOptions,
} from "./graph-utils";
import { Icon } from "./icons";
import type { CanvasContextValue } from "./canvas/canvas-context";
import { EditorTopBar, type SaveIndicator } from "./canvas/editor-top-bar";
import { FlowCanvas, type ConnectionSource } from "./canvas/flow-canvas";
import { buildEditorIssues } from "./canvas/issues";
import { IssuesPanel, type IssueTarget } from "./canvas/issues-panel";
import { connectNodeOutput, connectOutput, outputTarget, positionAfter, TRIGGER_NODE_ID } from "./canvas/model";
import { PreviewPanel } from "./canvas/preview-panel";
import { BottomSheet, FloatingPanel, SNAP_HALF } from "./canvas/side-panel";
import { StepInspector } from "./canvas/step-inspector";
import type { StepPreset } from "./canvas/step-type-menu";
import { stepTitle } from "./canvas/summaries";
import { TriggerInspector } from "./canvas/trigger-inspector";
import { useFlowDocument, type SaveMode } from "./canvas/use-flow-document";
import { IssueList, PRESS } from "./ui";

type Panel = { kind: "node"; id: string } | { kind: "trigger" } | { kind: "issues" } | null;
type Notice = { tone: "error" | "success" | "info"; text: string; undo?: boolean };

/** Floating top bar height plus its margins. */
const TOP_CHROME = { desktop: 80, phone: 72 };
const PANEL_WIDTH = 400;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/** The editor covers the dashboard content area, below the app's top bar. */
function useEditorFrame(anchor: React.RefObject<HTMLDivElement | null>) {
  const [frame, setFrame] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    const main = el?.closest("main");
    if (!el || !main) return;
    const header = main.querySelector<HTMLElement>(":scope > header");
    const measure = () => {
      const box = main.getBoundingClientRect();
      const top = header ? header.getBoundingClientRect().bottom : el.getBoundingClientRect().top;
      setFrame({ top, left: box.left, width: box.width, height: window.innerHeight - top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);
  return frame;
}

function UndoGlyph({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${flip ? "-scale-x-100" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  );
}

function nodeFromPreset(preset: StepPreset): FlowNode {
  const node = createNode(preset.type);
  if (node.type === "input" && preset.type === "input") {
    const saveTo =
      preset.inputType === "email" || preset.inputType === "phone"
        ? preset.inputType
        : `field:${preset.inputType === "number" ? "number" : preset.inputType === "url" ? "link" : "answer"}`;
    return { ...node, inputType: preset.inputType, saveTo };
  }
  return node;
}

export default function FlowEditor({ flowId }: { flowId: string }) {
  const router = useRouter();
  const doc = useFlowDocument(flowId);
  const anchorRef = useRef<HTMLDivElement>(null);
  const frame = useEditorFrame(anchorRef);
  const phone = useMediaQuery("(max-width: 767px)");

  const [panel, setPanel] = useState<Panel>(null);
  const [expandedTrigger, setExpandedTrigger] = useState<string | null>(null);
  const [triggerMenuOpen, setTriggerMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<SaveMode | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const noticeTimer = useRef<number | null>(null);
  const appliedParams = useRef(false);

  const { draft, commit, meta, status } = doc;
  const graph = draft.graph;
  const triggers = draft.triggers;
  const commentTriggered = triggers.some(isCommentTrigger);

  function showNotice(next: Notice | null, autoHideMs = 0) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && autoHideMs > 0) noticeTimer.current = window.setTimeout(() => setNotice(null), autoHideMs);
  }

  const issues = useMemo(
    () => buildEditorIssues({ graph, triggers, serverErrors: doc.serverErrors, serverWarnings: doc.serverWarnings }),
    [graph, triggers, doc.serverErrors, doc.serverWarnings]
  );

  // ─── Editing ────────────────────────────────────────────────────────────

  const updateGraph = (update: (g: FlowGraph) => FlowGraph, key: string | null) =>
    commit((d) => {
      const next = update(d.graph);
      return next === d.graph ? d : { ...d, graph: next };
    }, key);

  function select(id: string | null) {
    if (id === null) setPanel(null);
    else if (id === TRIGGER_NODE_ID) {
      setPanel({ kind: "trigger" });
      // A single trigger opens expanded.
      setExpandedTrigger((current) => current ?? (triggers.length === 1 ? triggers[0].id : null));
    }
    else {
      setPanel({ kind: "node", id });
      setPreviewId(id);
    }
  }

  function addStep(preset: StepPreset, from: ConnectionSource | null, position: { x: number; y: number }) {
    const node = { ...nodeFromPreset(preset), position: { x: Math.round(position.x), y: Math.round(position.y) } };
    updateGraph((g) => {
      const added = addNode(g, node);
      return from ? connectOutput(added, from.source, from.handle, node.id) : added;
    }, null);
    select(node.id);
  }

  /** Palette "Data Collection" / "More": a new step right after this one, keeping what came next. */
  function addAfter(sourceId: string, preset: StepPreset) {
    const base = nodeFromPreset(preset);
    updateGraph((g) => {
      const previous = outputTarget(g, sourceId, "next");
      const node = { ...connectNodeOutput(base, "next", previous), position: positionAfter(g, sourceId) };
      return connectOutput(addNode(g, node), sourceId, "next", node.id);
    }, null);
    select(base.id);
  }

  function deleteNodes(ids: string[]) {
    if (ids.length === 0) return;
    updateGraph((g) => ids.reduce((acc, id) => removeNode(acc, id), g), null);
    if (panel?.kind === "node" && ids.includes(panel.id)) setPanel(null);
    showNotice({ tone: "info", text: ids.length === 1 ? "Step deleted" : `${ids.length} steps deleted`, undo: true }, 6000);
  }

  function duplicateStep(id: string) {
    const original = graph.nodes.find((n) => n.id === id);
    if (!original) return;
    const copy = cloneNodeWithNewIds(original);
    const at = original.position ?? { x: 0, y: 0 };
    updateGraph((g) => addNode(g, { ...copy, position: { x: at.x + 40, y: at.y + 40 } }, id), null);
    select(copy.id);
  }

  const createStep = (type: FlowNode["type"], afterId?: string): string => {
    const node = createNode(type);
    updateGraph((g) => addNode(g, { ...node, position: positionAfter(g, afterId ?? null) }, afterId), null);
    return node.id;
  };

  function updateTriggers(next: EditorTrigger[], key: string | null) {
    commit((d) => ({ ...d, triggers: next }), key);
  }

  function openTrigger(id: string | null, withMenu = false) {
    setPanel({ kind: "trigger" });
    if (id) setExpandedTrigger(id);
    setTriggerMenuOpen(withMenu);
  }

  function openIssue(target: IssueTarget) {
    if (!target) return;
    if (target.kind === "trigger") openTrigger(target.id);
    else select(target.id);
  }

  // ─── Saving and status ──────────────────────────────────────────────────

  async function goLive(mode: "live" | "publish") {
    if (issues.localErrors.length > 0 || issues.errors.length > 0) {
      setPanel({ kind: "issues" });
      return;
    }
    setBusy(mode);
    const result = await doc.save(mode);
    setBusy(null);
    if (result.ok) {
      showNotice({ tone: "success", text: mode === "live" ? "Flow is live" : "Changes published" }, 2600);
      if (panel?.kind === "issues") setPanel(null);
    } else {
      if (result.validation?.errors?.length) setPanel({ kind: "issues" });
      showNotice({ tone: "error", text: result.error ?? "Could not save the flow" });
    }
  }

  async function pause() {
    setBusy("pause");
    const result = await doc.save("pause");
    setBusy(null);
    showNotice(result.ok ? { tone: "info", text: "Flow paused. Comment triggers are off." } : { tone: "error", text: result.error ?? "Could not pause" }, 3000);
  }

  async function duplicateFlow() {
    if (!meta) return;
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${draft.name.trim() || "Untitled flow"} copy`.slice(0, 100),
          instagramAccountId: meta.instagramAccountId,
          graph,
          triggers: triggersForCopy(triggers, () => newId("t")),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "Could not duplicate the flow");
      router.push(`/flows/${payload.data.id}`);
    } catch (error) {
      showNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not duplicate the flow" });
    }
  }

  async function deleteFlow() {
    const comments = triggers.filter(isCommentTrigger).length;
    const extra =
      comments > 0
        ? ` Its ${comments === 1 ? "comment trigger and its" : `${comments} comment triggers and their`} send history are deleted too.`
        : "";
    if (!window.confirm(`Delete "${draft.name || "Untitled flow"}"?${extra} Runs in progress stop. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/flows/${flowId}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "Could not delete the flow");
      router.push("/flows");
      router.refresh();
    } catch (error) {
      showNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not delete the flow" });
    }
  }

  // ─── Keyboard and URL ───────────────────────────────────────────────────

  const keysRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keysRef.current = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") {
        event.preventDefault();
        if (status === "ACTIVE") void goLive("publish");
        else void doc.save("auto");
        return;
      }
      if (isEditable(event.target)) return;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) doc.redo();
        else doc.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        doc.redo();
      } else if (key === "escape" && panel) {
        setPanel(null);
      }
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keysRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const ready = !doc.loading && !doc.loadError && doc.shapeErrors.length === 0 && meta !== null;
  // ?trigger=<automationId> (campaign stats, old edit links), ?add=comment
  // ("use in a campaign"), ?select=trigger (new flow from a template).
  useEffect(() => {
    if (!ready || appliedParams.current) return;
    appliedParams.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.size === 0) return;
    window.history.replaceState(null, "", window.location.pathname);
    // Not cleared on re-render: this effect runs once per page load.
    window.setTimeout(() => {
      const trigger = params.get("trigger");
      if (params.get("add") === "comment") {
        const fresh = createCommentTrigger(newId("t"));
        updateTriggers([...triggers.filter(isCommentTrigger), fresh, ...triggers.filter((t) => !isCommentTrigger(t))], null);
        openTrigger(fresh.id);
      } else if (trigger) openTrigger(trigger);
      else if (params.get("select") === "trigger") openTrigger(triggers.find(isCommentTrigger)?.id ?? null);
    }, 0);
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  const top = phone ? TOP_CHROME.phone : TOP_CHROME.desktop;
  const panelOpen = panel !== null;
  const insets = phone
    ? // Before the sheet reports its height, assume the half-height snap.
      { top, left: 0, right: 0, bottom: panelOpen ? Math.max(sheetHeight, (frame?.height ?? 0) * SNAP_HALF) : 0 }
    : { top, left: panelOpen ? PANEL_WIDTH + 24 : 0, right: previewOpen ? 376 : 0, bottom: 72 };

  const selectedNode = panel?.kind === "node" ? graph.nodes.find((n) => n.id === panel.id) : undefined;
  const selectedId = panel?.kind === "node" ? panel.id : panel?.kind === "trigger" ? TRIGGER_NODE_ID : null;
  const mediaById = useMemo(() => new Map(doc.media.map((m) => [m.id, m] as const)), [doc.media]);
  const fieldNames = useMemo(() => collectFieldNames(graph), [graph]);
  const tags = useMemo(() => collectTags(graph), [graph]);
  const username = meta?.instagramAccount.username ?? "yourbrand";
  const startNode = graph.nodes.find((n) => n.id === graph.startNodeId);

  const editorContext: FlowEditorContextValue = {
    flowId,
    steps: stepOptions(graph),
    createStep,
    flows: doc.flows,
    media: doc.media,
    mediaById,
    uploadMedia: doc.uploadMedia,
    variables: [
      ...FLOW_VARIABLES.filter((v) => v.token !== "{{field.<name>}}").map((v) => v.token),
      ...fieldNames.map((field) => `{{field.${field}}}`),
      "{{field.}}",
    ],
    fieldNames,
    tags,
    stats: doc.stats,
    username,
  };

  const canvasContext: CanvasContextValue = {
    triggers,
    triggerErrorIds: issues.triggerErrorIds,
    mediaById,
    flowNames: new Map(doc.flows.map((f) => [f.id, f.name] as const)),
    nodeStats: doc.stats?.nodes ?? null,
    onAddTrigger: () => openTrigger(null, true),
  };

  const saveIndicator: SaveIndicator =
    doc.saveState === "saving"
      ? { kind: "saving" }
      : doc.saveState === "error" && doc.dirty
        ? { kind: "error", text: doc.saveError ?? "Not saved" }
        : doc.dirty
          ? status === "ACTIVE"
            ? { kind: "pending", text: "Unpublished changes" }
            : { kind: "saving" }
          : { kind: "saved", text: status === "ACTIVE" ? "Published" : "Saved" };

  const errorCount = issues.errors.length;
  const primary =
    status === "ACTIVE"
      ? {
          label: "Publish",
          busyLabel: "Publishing…",
          busy: busy === "publish",
          disabled: !doc.dirty || doc.saveState === "saving",
          onClick: () => void goLive("publish"),
        }
      : {
          label: "Set Live",
          busyLabel: "Going live…",
          busy: busy === "live",
          disabled: doc.saveState === "saving",
          onClick: () => void goLive("live"),
        };

  let panelContent: React.ReactNode = null;
  if (panel?.kind === "node" && selectedNode) {
    const nodeIssues = issues.byNode.get(selectedNode.id);
    panelContent = (
      <StepInspector
        key={selectedNode.id}
        node={selectedNode}
        isStart={graph.startNodeId === selectedNode.id}
        privateReply={commentTriggered && graph.startNodeId === selectedNode.id}
        errors={nodeIssues?.errors ?? []}
        warnings={nodeIssues?.warnings ?? []}
        counts={doc.stats?.nodes[selectedNode.id]}
        onChange={(next) => updateGraph((g) => replaceNode(g, selectedNode.id, next), `node:${selectedNode.id}`)}
        onClose={() => setPanel(null)}
        onDuplicate={() => duplicateStep(selectedNode.id)}
        onDelete={() => deleteNodes([selectedNode.id])}
        onSetStart={() => updateGraph((g) => ({ ...g, startNodeId: selectedNode.id }), null)}
        onAddAfter={(preset) => addAfter(selectedNode.id, preset)}
      />
    );
  } else if (panel?.kind === "trigger" && meta) {
    panelContent = (
      <TriggerInspector
        triggers={triggers}
        username={username}
        instagramAccountId={meta.instagramAccountId}
        startLabel={startNode ? stepTitle(startNode) : null}
        issuesByTrigger={issues.byTrigger}
        expandedId={expandedTrigger}
        addMenuOpen={triggerMenuOpen}
        onAddMenuOpenChange={setTriggerMenuOpen}
        onExpand={setExpandedTrigger}
        onChange={updateTriggers}
        automationIdOf={doc.automationIdOf}
        onClose={() => setPanel(null)}
      />
    );
  } else if (panel?.kind === "issues") {
    panelContent = (
      <IssuesPanel
        groups={issues.groups}
        live={status === "ACTIVE"}
        dirty={doc.dirty}
        busy={busy !== null}
        onOpen={openIssue}
        onGoLive={() => void goLive(status === "ACTIVE" ? "publish" : "live")}
        onClose={() => setPanel(null)}
      />
    );
  }
  const panelLabel = panel?.kind === "trigger" ? "Triggers" : panel?.kind === "issues" ? "Problems" : "Edit step";

  let body: React.ReactNode;
  if (doc.loading || !frame) {
    body = (
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden="true" />
          Loading flow…
        </div>
      </div>
    );
  } else if (doc.loadError || !meta) {
    body = (
      <div className="absolute inset-0 grid place-items-center p-6">
        <div className="panel max-w-sm rounded-2xl p-8 text-center">
          <p className="text-sm text-muted">{doc.loadError ?? "Flow not found."}</p>
          <Link href="/flows" className={`mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-muted hover:text-foreground sm:min-h-9 ${PRESS}`}>
            Back to flows
          </Link>
        </div>
      </div>
    );
  } else if (doc.shapeErrors.length > 0) {
    body = (
      <div className="absolute inset-0 overflow-y-auto p-6">
        <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-error/30 bg-error/5 p-5">
          <h1 className="text-base font-semibold tracking-tight text-foreground">This flow&apos;s data could not be read</h1>
          <p className="text-sm text-muted">The editor stays read-only so nothing gets overwritten.</p>
          <IssueList errors={doc.shapeErrors} />
          <Link href="/flows" className="text-sm text-accent hover:underline">
            Back to flows
          </Link>
        </div>
      </div>
    );
  } else {
    body = (
      <FlowEditorContext.Provider value={editorContext}>
        <FlowCanvas
          graph={graph}
          selectedId={selectedId}
          errorCounts={issues.errorCounts}
          warningCounts={issues.warningCounts}
          context={canvasContext}
          insets={insets}
          chromeHidden={phone && panelOpen}
          onSelect={select}
          onGraphChange={updateGraph}
          onDeleteNodes={deleteNodes}
          onAddStep={addStep}
        />

        {!panelOpen && graph.nodes.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4" style={{ top: top + 4 }}>
            <span className="rounded-full border border-border bg-surface/80 px-3 py-1 text-[11px] font-medium text-muted shadow-sm backdrop-blur-xl">
              Click a card to edit the step in the sidebar
            </span>
          </div>
        )}

        <EditorTopBar
          name={draft.name}
          onRename={(name) => commit((d) => ({ ...d, name }), "name")}
          status={status}
          save={saveIndicator}
          onRetry={() => void doc.save("auto")}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          onUndo={doc.undo}
          onRedo={doc.redo}
          errorCount={errorCount}
          onShowIssues={() => setPanel({ kind: "issues" })}
          previewOpen={previewOpen}
          onTogglePreview={() => setPreviewOpen((open) => !open)}
          primary={primary}
          menuItems={[
            { label: "Duplicate flow", onSelect: () => void duplicateFlow(), icon: <Icon.copy className="h-4 w-4" /> },
            ...(status === "ACTIVE"
              ? [{ label: busy === "pause" ? "Pausing…" : "Pause flow", hint: "Stops new runs and comment replies.", onSelect: () => void pause() }]
              : []),
            {
              label: "Delete flow",
              tone: "danger" as const,
              hint: "Asks before deleting.",
              onSelect: () => void deleteFlow(),
              icon: <Icon.trash className="h-4 w-4" />,
            },
          ]}
        />

        {phone && !panelOpen && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 pb-[env(safe-area-inset-bottom)]">
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-surface/85 p-1 shadow-lg backdrop-blur-xl">
              <button type="button" aria-label="Undo" disabled={!doc.canUndo} onClick={doc.undo} className={`grid h-11 w-11 place-items-center rounded-full text-muted disabled:opacity-40 ${PRESS}`}>
                <UndoGlyph />
              </button>
              <button type="button" aria-label="Redo" disabled={!doc.canRedo} onClick={doc.redo} className={`grid h-11 w-11 place-items-center rounded-full text-muted disabled:opacity-40 ${PRESS}`}>
                <UndoGlyph flip />
              </button>
            </div>
          </div>
        )}

        {phone ? (
          <BottomSheet open={panelOpen && panelContent !== null} onClose={() => setPanel(null)} label={panelLabel} onHeightChange={setSheetHeight}>
            {panelContent}
          </BottomSheet>
        ) : (
          <FloatingPanel open={panelOpen && panelContent !== null} top={top} label={panelLabel}>
            {panelContent}
          </FloatingPanel>
        )}

        <PreviewPanel
          open={previewOpen}
          top={top}
          phone={phone}
          nodes={graph.nodes}
          nodeId={previewId ?? graph.startNodeId}
          username={username}
          mediaById={mediaById}
          onPick={setPreviewId}
          onClose={() => setPreviewOpen(false)}
        />

        {notice && (
          <div
            className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4"
            style={{ bottom: (phone && panelOpen ? sheetHeight : 0) + 80 }}
          >
            <div
              role="status"
              className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-full border bg-surface/95 px-4 py-2 text-sm shadow-xl backdrop-blur-xl transition-[opacity,translate] duration-200 starting:translate-y-2 starting:opacity-0 ${
                notice.tone === "error" ? "border-error/30 text-error" : notice.tone === "success" ? "border-success/30 text-success" : "border-border text-foreground"
              }`}
            >
              <span className="min-w-0">{notice.text}</span>
              {notice.undo && (
                <button
                  type="button"
                  onClick={() => {
                    doc.undo();
                    showNotice(null);
                  }}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-medium text-accent hover:bg-accent/10 ${PRESS}`}
                >
                  Undo
                </button>
              )}
              <button type="button" aria-label="Dismiss" onClick={() => showNotice(null)} className="-mr-1 shrink-0 rounded-full p-1 text-muted hover:text-foreground">
                <Icon.close className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </FlowEditorContext.Provider>
    );
  }

  return (
    <>
      <div ref={anchorRef} aria-hidden="true" className="h-px" />
      <div
        className="fixed z-[35] overflow-hidden bg-background"
        style={frame ? { top: frame.top, left: frame.left, width: frame.width, height: frame.height } : { inset: 0, visibility: "hidden" }}
      >
        <ReactFlowProvider>{body}</ReactFlowProvider>
      </div>
    </>
  );
}
