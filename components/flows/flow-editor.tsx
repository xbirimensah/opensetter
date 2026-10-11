"use client";

/**
 * Flow Editor
 *
 * A structured step editor (not a free canvas): triggers on top, then one
 * card per step with explicit routing pickers. The right column holds the
 * phone preview of the selected message, an overview map, run stats and
 * the variables list. Validation from lib/flows/validate runs live and is
 * shown next to the step it is about.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowGraph, FlowNode, FlowNodeType, FlowTrigger } from "@/lib/flows/types";
import {
  FLOW_VARIABLES,
  lintFlow,
  NODE_TYPE_LABELS,
  nodeDisplayName,
  parseFlowGraphShape,
  parseFlowTriggersShape,
  triggerDisplayName,
  validateFlowGraph,
  validateFlowTriggers,
  type FlowIssue,
} from "@/lib/flows/validate";
import type { FlowDetail, FlowStats, FlowStatusValue, FlowValidationPayload, MediaItem } from "./api-types";
import { FlowEditorContext, type FlowEditorContextValue } from "./editor-context";
import { FlowMap } from "./flow-map";
import { FlowPreview } from "./flow-preview";
import {
  addNode,
  collectFieldNames,
  collectTags,
  createNode,
  duplicateNode,
  moveNode,
  removeNode,
  replaceNode,
  stepOptions,
} from "./graph-utils";
import { Icon, NODE_TINTS, NodeTypeIcon } from "./icons";
import { NodeCard } from "./node-card";
import { NODE_TYPE_ORDER } from "./step-select";
import { TriggersPanel } from "./triggers-panel";
import { Button, IconButton, IssueList, Menu, PRESS, Segmented, StatusPill } from "./ui";
import { VariablesPanel } from "./variables-panel";

type SaveMode = "save" | "activate" | "pause";
type Notice = { tone: "error" | "success" | "info"; text: string; undo?: () => void };

const EMPTY_GRAPH: FlowGraph = { startNodeId: null, nodes: [] };

const NODE_TYPE_HINTS: Record<FlowNodeType, string> = {
  message: "Text, media, cards, buttons",
  input: "Ask for an email, phone or answer",
  condition: "Branch on tags, fields, follows",
  action: "Tags, fields, webhooks, AI",
  delay: "Wait minutes or hours",
  randomizer: "Split people for A/B tests",
  start_flow: "Jump into another flow",
  ai_handoff: "Let the AI setter continue",
};

function snapshotOf(name: string, graph: FlowGraph, triggers: FlowTrigger[]): string {
  return JSON.stringify({ name, graph, triggers });
}

/** "Step 3 (Message): block 1 text is empty." -> "Block 1 text is empty." */
function withoutPrefix(message: string, prefix: string): string {
  if (!message.startsWith(`${prefix}: `)) return message;
  const rest = message.slice(prefix.length + 2);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToNode(id: string) {
  window.setTimeout(() => {
    document
      .getElementById(`flow-node-${id}`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, 60);
}

export default function FlowEditor({ flowId }: { flowId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shapeErrors, setShapeErrors] = useState<string[]>([]);
  const [meta, setMeta] = useState<FlowDetail | null>(null);
  const [name, setName] = useState("");
  const [graph, setGraph] = useState<FlowGraph>(EMPTY_GRAPH);
  const [triggers, setTriggers] = useState<FlowTrigger[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  // Database checks from the last load or save (deleted media, other flows).
  const [serverErrors, setServerErrors] = useState<FlowIssue[]>([]);
  const [serverWarnings, setServerWarnings] = useState<FlowIssue[]>([]);
  const [saving, setSaving] = useState<SaveMode | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sideTab, setSideTab] = useState<"preview" | "map">("preview");
  const [flows, setFlows] = useState<{ id: string; name: string; status: FlowStatusValue }[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<FlowStats | null>(null);
  const [statsDays, setStatsDays] = useState<"7" | "30" | "all">("30");
  const noticeTimer = useRef<number | null>(null);

  function showNotice(next: Notice | null, autoHideMs = 0) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && autoHideMs > 0) {
      noticeTimer.current = window.setTimeout(() => setNotice(null), autoHideMs);
    }
  }

  // ─── Loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/flows/${flowId}`, { cache: "no-store" })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "Flow not found");
        return payload as { data: FlowDetail; validation: FlowValidationPayload };
      })
      .then(({ data, validation }) => {
        if (cancelled) return;
        const parsedGraph = parseFlowGraphShape(data.graph);
        const parsedTriggers = parseFlowTriggersShape(data.triggers);
        setMeta(data);
        setName(data.name);
        if (!parsedGraph.ok || !parsedTriggers.ok) {
          setShapeErrors([...(parsedGraph.ok ? [] : parsedGraph.errors), ...(parsedTriggers.ok ? [] : parsedTriggers.errors)]);
          return;
        }
        setGraph(parsedGraph.value);
        setTriggers(parsedTriggers.value);
        setSelectedId(parsedGraph.value.startNodeId);
        setSavedSnapshot(snapshotOf(data.name, parsedGraph.value, parsedTriggers.value));
        setServerErrors(validation?.serverErrors ?? []);
        setServerWarnings(validation?.serverWarnings ?? []);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const accountId = meta?.instagramAccountId;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    fetch(`/api/flows?instagramAccountId=${encodeURIComponent(accountId)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setFlows(
          (payload.data as { id: string; name: string; status: FlowStatusValue }[]).map(({ id, name: flowName, status }) => ({
            id,
            name: flowName,
            status,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/media", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload?.success) setMedia(payload.data as MediaItem[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = statsDays === "all" ? "" : `?days=${statsDays}`;
    fetch(`/api/flows/${flowId}/stats${query}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload?.success) setStats(payload.data as FlowStats);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flowId, statsDays]);

  // ─── Derived state ──────────────────────────────────────────────────────

  const snapshot = snapshotOf(name, graph, triggers);
  const dirty = !loading && !shapeErrors.length && meta !== null && snapshot !== savedSnapshot;
  const status: FlowStatusValue = meta?.status ?? "DRAFT";
  const commentTriggered = (meta?.automations.length ?? 0) > 0;

  const localErrors = useMemo(() => [...validateFlowGraph(graph), ...validateFlowTriggers(triggers)], [graph, triggers]);
  const warnings = useMemo(
    () => [...lintFlow(graph, { commentTriggered }), ...serverWarnings],
    [graph, commentTriggered, serverWarnings]
  );
  const errors = useMemo(
    () => [...localErrors, ...serverErrors.filter((s) => !localErrors.some((l) => l.message === s.message))],
    [localErrors, serverErrors]
  );

  const issues = useMemo(() => {
    const byNode = new Map<string, { errors: string[]; warnings: string[] }>();
    const byTrigger = new Map<string, string[]>();
    const general: string[] = [];
    const generalWarnings: string[] = [];
    const labels = new Map(graph.nodes.map((node, index) => [node.id, nodeDisplayName(node, index)] as const));
    const triggerLabels = new Map(triggers.map((t, index) => [t.id, triggerDisplayName(t, index)] as const));
    const bucket = (id: string) => {
      const entry = byNode.get(id) ?? { errors: [], warnings: [] };
      byNode.set(id, entry);
      return entry;
    };
    for (const issue of errors) {
      if (issue.nodeId && labels.has(issue.nodeId)) {
        bucket(issue.nodeId).errors.push(withoutPrefix(issue.message, labels.get(issue.nodeId) as string));
      } else if (issue.triggerId && triggerLabels.has(issue.triggerId)) {
        const list = byTrigger.get(issue.triggerId) ?? [];
        list.push(withoutPrefix(issue.message, triggerLabels.get(issue.triggerId) as string));
        byTrigger.set(issue.triggerId, list);
      } else {
        general.push(issue.message);
      }
    }
    for (const issue of warnings) {
      if (issue.nodeId && labels.has(issue.nodeId)) {
        bucket(issue.nodeId).warnings.push(withoutPrefix(issue.message, labels.get(issue.nodeId) as string));
      } else {
        generalWarnings.push(issue.message);
      }
    }
    return { byNode, byTrigger, general, generalWarnings };
  }, [errors, warnings, graph.nodes, triggers]);

  const errorNodeIds = useMemo(() => new Set(issues.byNode.keys()), [issues]);
  const selectedNode = graph.nodes.find((n) => n.id === selectedId);
  const previewNode =
    selectedNode && (selectedNode.type === "message" || selectedNode.type === "input")
      ? selectedNode
      : graph.nodes.find((n) => n.id === graph.startNodeId && n.type === "message") ?? selectedNode;

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m] as const)), [media]);
  const fieldNames = useMemo(() => collectFieldNames(graph), [graph]);
  const tags = useMemo(() => collectTags(graph), [graph]);
  const username = meta?.instagramAccount.username ?? "yourbrand";

  // ─── Editing ────────────────────────────────────────────────────────────

  function createStep(type: FlowNodeType, afterId?: string): string {
    const node = createNode(type);
    setGraph((g) => addNode(g, node, afterId));
    return node.id;
  }

  function addStepAtEnd(type: FlowNodeType) {
    const id = createStep(type);
    setSelectedId(id);
    scrollToNode(id);
  }

  function updateNode(id: string, node: FlowNode) {
    setGraph((g) => replaceNode(g, id, node));
  }

  function deleteStep(id: string) {
    const before = graph;
    setGraph((g) => removeNode(g, id));
    showNotice({ tone: "info", text: "Step deleted", undo: () => setGraph(before) }, 6000);
  }

  function duplicateStep(id: string) {
    const result = duplicateNode(graph, id);
    setGraph(result.graph);
    if (result.copyId) {
      setSelectedId(result.copyId);
      scrollToNode(result.copyId);
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function revealNode(id: string) {
    setSelectedId(id);
    setCollapsed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    scrollToNode(id);
  }

  async function uploadMedia(file: File): Promise<MediaItem> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/media", { method: "POST", body: form });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.success) throw new Error(payload?.error ?? "Upload failed");
    const item = payload.data as MediaItem;
    setMedia((current) => [item, ...current]);
    return item;
  }

  // ─── Saving ─────────────────────────────────────────────────────────────

  async function persist(mode: SaveMode) {
    if (saving) return;
    const sentName = name.trim() || "Untitled flow";
    const sentGraph = graph;
    const sentTriggers = triggers;
    const body: Record<string, unknown> = { name: sentName, graph: sentGraph, triggers: sentTriggers };
    if (mode === "activate") body.status = "ACTIVE";
    if (mode === "pause") body.status = "PAUSED";

    setSaving(mode);
    showNotice(null);
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        if (payload?.validation) {
          const validation = payload.validation as FlowValidationPayload;
          setServerErrors(validation.serverErrors ?? []);
          setServerWarnings(validation.serverWarnings ?? []);
        }
        showNotice({ tone: "error", text: payload?.error ?? "Could not save the flow" });
        return;
      }
      const data = payload.data as FlowDetail;
      setMeta(data);
      if (sentName !== name) setName(sentName);
      setSavedSnapshot(snapshotOf(sentName, sentGraph, sentTriggers));
      const validation = payload.validation as FlowValidationPayload | undefined;
      setServerErrors(validation?.serverErrors ?? []);
      setServerWarnings(validation?.serverWarnings ?? []);
      showNotice(
        { tone: "success", text: mode === "activate" ? "Flow is active" : mode === "pause" ? "Flow paused" : "Saved" },
        2500
      );
    } catch {
      showNotice({ tone: "error", text: "Could not reach the server. Your changes are still here." });
    } finally {
      setSaving(null);
    }
  }

  async function deleteFlow() {
    if (!window.confirm("Delete this flow? Runs in progress stop. This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/flows/${flowId}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        showNotice({ tone: "error", text: payload?.error ?? "Could not delete the flow" });
        return;
      }
      setSavedSnapshot(snapshot);
      router.push("/flows");
      router.refresh();
    } catch {
      showNotice({ tone: "error", text: "Could not reach the server." });
    }
  }

  const canSave = dirty && !saving && !(status === "ACTIVE" && localErrors.length > 0);

  // Cmd/Ctrl+S saves; the ref always holds the latest handler.
  const saveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveRef.current = () => {
      if (canSave) void persist("save");
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="panel h-14 rounded-2xl" />
        <div className="panel h-40 rounded-2xl" />
        <div className="panel h-64 rounded-2xl" />
      </div>
    );
  }

  if (loadError || !meta) {
    return (
      <div className="panel rounded-2xl p-8 text-center">
        <p className="text-sm text-muted">{loadError ?? "Flow not found."}</p>
        <Link href="/flows" className={`mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-muted hover:text-foreground sm:min-h-9 ${PRESS}`}>
          Back to flows
        </Link>
      </div>
    );
  }

  if (shapeErrors.length > 0) {
    return (
      <div className="space-y-4">
        <Link href="/flows" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground sm:min-h-0">
          &larr; Flows
        </Link>
        <div className="rounded-2xl border border-error/30 bg-error/5 p-5">
          <h1 className="text-base font-semibold tracking-tight text-foreground">This flow&apos;s data could not be read</h1>
          <p className="mt-1 text-sm text-muted">The editor stays read-only so nothing gets overwritten.</p>
          <div className="mt-4">
            <IssueList errors={shapeErrors} />
          </div>
        </div>
      </div>
    );
  }

  const contextValue: FlowEditorContextValue = {
    flowId,
    steps: stepOptions(graph),
    createStep,
    flows,
    media,
    mediaById,
    uploadMedia,
    variables: [
      ...FLOW_VARIABLES.filter((v) => v.token !== "{{field.<name>}}").map((v) => v.token),
      ...fieldNames.map((field) => `{{field.${field}}}`),
      "{{field.}}",
    ],
    fieldNames,
    tags,
    stats,
    username,
  };

  const errorCount = errors.length;
  const warningCount = warnings.length;
  const firstIssueNode = graph.nodes.find((n) => issues.byNode.has(n.id));
  const runs = stats?.runs;

  return (
    <FlowEditorContext.Provider value={contextValue}>
      <div className="space-y-5">
        {/* Toolbar: a translucent layer the steps scroll under. */}
        <div className="sticky top-0 z-30 -mx-4 -mt-6 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 lg:-mx-8 lg:px-8 [@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link
              href="/flows"
              className="inline-flex min-h-11 shrink-0 items-center text-sm text-muted hover:text-foreground sm:min-h-0"
            >
              &larr; Flows
            </Link>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              aria-label="Flow name"
              placeholder="Untitled flow"
              className="min-w-0 flex-1 basis-40 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold tracking-tight text-foreground placeholder:text-faint hover:border-border focus:border-accent/40 focus:outline-none sm:text-lg"
            />
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={status} />
              {dirty && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Unsaved
                </span>
              )}
              {(errorCount > 0 || warningCount > 0) && (
                <button
                  type="button"
                  onClick={() => firstIssueNode && revealNode(firstIssueNode.id)}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-2.5 text-xs sm:min-h-7 ${PRESS} hover:border-border-hover`}
                >
                  {errorCount > 0 && (
                    <span className="text-error">
                      {errorCount} {errorCount === 1 ? "error" : "errors"}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="text-warning">
                      {warningCount} {warningCount === 1 ? "warning" : "warnings"}
                    </span>
                  )}
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {status === "ACTIVE" ? (
                <Button onClick={() => void persist("pause")} disabled={Boolean(saving)}>
                  {saving === "pause" ? "Pausing…" : "Pause"}
                </Button>
              ) : (
                <Button
                  variant="success"
                  onClick={() => void persist("activate")}
                  disabled={Boolean(saving) || localErrors.length > 0}
                  title={localErrors.length > 0 ? `Fix ${localErrors.length} ${localErrors.length === 1 ? "error" : "errors"} first` : undefined}
                >
                  {saving === "activate" ? "Activating…" : dirty ? "Save and activate" : "Activate"}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => void persist("save")}
                disabled={!canSave}
                title={status === "ACTIVE" && localErrors.length > 0 ? "Fix the errors or pause the flow to save" : "Save (Cmd+S)"}
              >
                {saving === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </Button>
              <Menu
                align="right"
                items={[
                  {
                    label: "Delete flow",
                    tone: "danger",
                    hint: meta.automations.length > 0 ? "Unlink its campaigns first." : undefined,
                    onSelect: () => void deleteFlow(),
                    icon: <Icon.trash className="h-4 w-4" />,
                  },
                ]}
                trigger={(props) => (
                  <IconButton label="More flow actions" {...props}>
                    <Icon.more className="h-4 w-4" />
                  </IconButton>
                )}
              />
            </div>
          </div>
        </div>

        {status === "ACTIVE" && localErrors.length > 0 && (
          <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            This flow is live. Fix the errors below to save, or pause it to keep a draft.
          </p>
        )}
        <IssueList errors={issues.general} warnings={issues.generalWarnings} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <TriggersPanel
              triggers={triggers}
              onChange={setTriggers}
              username={username}
              campaigns={meta.automations}
              flowId={flowId}
              issuesByTrigger={issues.byTrigger}
              generalTriggerErrors={[]}
            />

            <div className="flex items-center justify-between gap-3 pt-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Steps <span className="font-normal text-muted">({graph.nodes.length})</span>
              </h2>
              {graph.nodes.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setCollapsed((current) =>
                      current.size >= graph.nodes.length ? new Set() : new Set(graph.nodes.map((n) => n.id))
                    )
                  }
                >
                  {collapsed.size >= graph.nodes.length ? "Expand all" : "Collapse all"}
                </Button>
              )}
            </div>

            {graph.nodes.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted">No steps yet. Start with a message.</p>
              </div>
            )}

            <ol className="space-y-3">
              {graph.nodes.map((node, index) => {
                const nodeIssues = issues.byNode.get(node.id);
                return (
                  <li key={node.id}>
                    <NodeCard
                      node={node}
                      index={index}
                      count={graph.nodes.length}
                      isStart={graph.startNodeId === node.id}
                      selected={selectedId === node.id}
                      collapsed={collapsed.has(node.id)}
                      errors={nodeIssues?.errors ?? []}
                      warnings={nodeIssues?.warnings ?? []}
                      onChange={(next) => updateNode(node.id, next)}
                      onSelect={() => setSelectedId(node.id)}
                      onToggleCollapsed={() => toggleCollapsed(node.id)}
                      onSetStart={() => setGraph((g) => ({ ...g, startNodeId: node.id }))}
                      onDuplicate={() => duplicateStep(node.id)}
                      onMove={(direction) => setGraph((g) => moveNode(g, node.id, direction))}
                      onDelete={() => deleteStep(node.id)}
                    />
                  </li>
                );
              })}
            </ol>

            <section aria-label="Add a step" className="rounded-2xl border border-dashed border-border p-3">
              <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Add a step</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {NODE_TYPE_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addStepAtEnd(type)}
                    className={`flex min-h-11 items-start gap-2 rounded-xl border border-border bg-surface p-2.5 text-left hover:border-border-hover hover:bg-surface-hover ${PRESS}`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${NODE_TINTS[type]}`}>
                      <NodeTypeIcon type={type} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground">{NODE_TYPE_LABELS[type]}</span>
                      <span className="block text-[11px] leading-snug text-muted">{NODE_TYPE_HINTS[type]}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:pb-4">
            <div className="flex items-center justify-between gap-2">
              <Segmented
                ariaLabel="Side panel"
                options={[
                  { value: "preview", label: "Preview" },
                  { value: "map", label: "Map" },
                ]}
                value={sideTab}
                onChange={setSideTab}
              />
              {sideTab === "preview" && previewNode && (
                <span className="min-w-0 truncate text-xs text-muted">
                  {graph.nodes.indexOf(previewNode) + 1}. {previewNode.name || NODE_TYPE_LABELS[previewNode.type]}
                </span>
              )}
            </div>
            {sideTab === "preview" ? (
              <FlowPreview node={previewNode} username={username} mediaById={mediaById} />
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-3">
                <FlowMap graph={graph} selectedId={selectedId} errorIds={errorNodeIds} onSelect={revealNode} />
                <p className="mt-2 text-[11px] text-faint">Solid lines continue at once, dashed lines wait for the person.</p>
              </div>
            )}

            <section className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">Runs</h3>
                <Segmented
                  ariaLabel="Stats period"
                  options={[
                    { value: "7", label: "7d" },
                    { value: "30", label: "30d" },
                    { value: "all", label: "All" },
                  ]}
                  value={statsDays}
                  onChange={setStatsDays}
                />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                {[
                  { label: "Started", value: runs?.total ?? 0 },
                  { label: "In progress", value: (runs?.RUNNING ?? 0) + (runs?.WAITING ?? 0) },
                  { label: "Completed", value: runs?.COMPLETED ?? 0 },
                  { label: "Expired", value: runs?.EXPIRED ?? 0 },
                  { label: "Failed", value: runs?.FAILED ?? 0 },
                  { label: "Clicks", value: stats?.totals.CLICKED ?? 0 },
                ].map((item) => (
                  <div key={item.label}>
                    <dt className="text-[11px] text-muted">{item.label}</dt>
                    <dd className="text-lg font-semibold tabular-nums tracking-tight text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <VariablesPanel fieldNames={fieldNames} />
          </aside>
        </div>
      </div>

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-lg transition-[opacity,translate] duration-200 starting:translate-y-2 starting:opacity-0 ${
              notice.tone === "error"
                ? "border-error/30 bg-surface text-error"
                : notice.tone === "success"
                  ? "border-success/30 bg-surface text-success"
                  : "border-border bg-surface text-foreground"
            }`}
          >
            <span className="min-w-0">{notice.text}</span>
            {notice.undo && (
              <button
                type="button"
                onClick={() => {
                  notice.undo?.();
                  showNotice(null);
                }}
                className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-medium text-accent hover:bg-accent/10 ${PRESS}`}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => showNotice(null)}
              className="-mr-1 shrink-0 rounded-full p-1 text-muted hover:text-foreground"
            >
              <Icon.close className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </FlowEditorContext.Provider>
  );
}
