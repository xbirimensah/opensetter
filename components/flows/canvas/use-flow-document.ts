"use client";

/**
 * Loads one flow, keeps its draft with undo/redo, and saves it.
 *
 * Saving: drafts and paused flows autosave shortly after the last change.
 * A live flow never autosaves (half-typed text must not reach real
 * leads): its changes wait for "Publish". Comment triggers carry their
 * Automation id and row version outside the draft (idMap / versions), so
 * undo and redo never resend stale ids; a row changed elsewhere (409) is
 * refreshed into the draft and saved again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEditorTriggersShape } from "@/lib/flows/comment-triggers";
import type { CommentTrigger, EditorTrigger } from "@/lib/flows/types";
import { parseFlowGraphShape, type FlowIssue } from "@/lib/flows/validate";
import type { FlowDetail, FlowStats, FlowStatusValue, FlowValidationPayload, MediaItem } from "../api-types";
import {
  draftSnapshot,
  historyCommit,
  historyInit,
  historyRedo,
  historyReplace,
  historyUndo,
  type Draft,
  type History,
} from "./draft";
import { autoLayout } from "./model";

export const AUTOSAVE_MS = 900;

export type SaveState = "idle" | "saving" | "saved" | "error";
export type SaveMode = "auto" | "publish" | "live" | "pause";

export interface SaveResult {
  ok: boolean;
  error?: string;
  validation?: FlowValidationPayload;
}

const EMPTY_DRAFT: Draft = { name: "", graph: { startNodeId: null, nodes: [] }, triggers: [] };

function stripVersions(triggers: EditorTrigger[]): EditorTrigger[] {
  return triggers.map((trigger) => {
    if (trigger.type !== "comment" || trigger.version === undefined) return trigger;
    const copy: CommentTrigger = { ...trigger };
    delete copy.version;
    return copy;
  });
}

const SAVE_RETRY_DELAY_MS = 1000;

/**
 * A dropped connection (fetch throws) is retried once after a second. The
 * whole draft is sent, so a retry re-applies the same state, with one
 * exception: a comment trigger saved for the first time has no id yet, and
 * if the lost attempt did reach the server, a retry would create it twice
 * (double DMs). Those saves are not retried.
 * HTTP errors are answers, not network failures, and are returned as is.
 */
async function putWithRetry(url: string, body: string, retryable: boolean): Promise<Response> {
  const send = () => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  try {
    return await send();
  } catch (error) {
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, SAVE_RETRY_DELAY_MS));
    return send();
  }
}

export function useFlowDocument(flowId: string) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shapeErrors, setShapeErrors] = useState<string[]>([]);
  const [meta, setMeta] = useState<FlowDetail | null>(null);
  const [history, setHistory] = useState<History<Draft>>(() => historyInit(EMPTY_DRAFT));
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [failedSnapshot, setFailedSnapshot] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FlowIssue[]>([]);
  const [serverWarnings, setServerWarnings] = useState<FlowIssue[]>([]);
  const [flows, setFlows] = useState<{ id: string; name: string; status: FlowStatusValue }[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<FlowStats | null>(null);

  // Comment trigger bookkeeping that must survive undo/redo.
  const idMapRef = useRef(new Map<string, string>());
  const versionsRef = useRef<Record<string, string>>({});
  const savingRef = useRef(false);
  // Render-safe mirror of idMapRef (stats links in the trigger editor).
  const [automationIds, setAutomationIds] = useState<Record<string, string>>({});

  const draft = history.present;
  const snapshot = useMemo(() => draftSnapshot(draft), [draft]);
  const status: FlowStatusValue = meta?.status ?? "DRAFT";
  const ready = !loading && !loadError && shapeErrors.length === 0 && meta !== null;
  const dirty = ready && snapshot !== savedSnapshot;

  // ─── Loading ──────────────────────────────────────────────────────────

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
        setMeta(data);
        const graph = parseFlowGraphShape(data.graph);
        const triggers = parseEditorTriggersShape(data.triggers);
        if (!graph.ok || !triggers.ok) {
          setShapeErrors([...(graph.ok ? [] : graph.errors), ...(triggers.ok ? [] : triggers.errors)]);
          return;
        }
        const list: EditorTrigger[] = [...triggers.value.commentTriggers, ...triggers.value.flowTriggers];
        for (const trigger of triggers.value.commentTriggers) {
          if (trigger.automationId) idMapRef.current.set(trigger.id, trigger.automationId);
        }
        versionsRef.current = { ...(data.triggerVersions ?? {}) };
        setAutomationIds(Object.fromEntries(idMapRef.current));
        // Steps without a stored position get one here; that is not a change.
        const loaded: Draft = { name: data.name, graph: autoLayout(graph.value), triggers: stripVersions(list) };
        setHistory(historyInit(loaded));
        setSavedSnapshot(draftSnapshot(loaded));
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
          (payload.data as { id: string; name: string; status: FlowStatusValue }[]).map(({ id, name, status: s }) => ({
            id,
            name,
            status: s,
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
    fetch(`/api/flows/${flowId}/stats`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload?.success) setStats(payload.data as FlowStats);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  // ─── Editing ──────────────────────────────────────────────────────────

  /** Applies a change. Same `key` within a moment = one undo step. */
  const commit = useCallback((update: (draft: Draft) => Draft, key: string | null = null) => {
    setHistory((h) => {
      const next = update(h.present);
      if (next === h.present) return h;
      // Any step created without a position gets one right away.
      const laidOut = next.graph === h.present.graph ? next : { ...next, graph: autoLayout(next.graph) };
      return historyCommit(h, laidOut, key);
    });
  }, []);

  const undo = useCallback(() => setHistory((h) => historyUndo(h)), []);
  const redo = useCallback(() => setHistory((h) => historyRedo(h)), []);

  // ─── Saving ───────────────────────────────────────────────────────────

  function payloadTriggers(triggers: EditorTrigger[]): EditorTrigger[] {
    return triggers.map((trigger) => {
      if (trigger.type !== "comment") return trigger;
      const automationId = idMapRef.current.get(trigger.id) ?? trigger.automationId;
      return automationId ? { ...trigger, automationId } : trigger;
    });
  }

  const save = useCallback(
    async (mode: SaveMode): Promise<SaveResult> => {
      if (savingRef.current) return { ok: false, error: "A save is already running" };
      const sent = history.present;
      const sentSnapshot = draftSnapshot(sent);
      const body: Record<string, unknown> = {
        name: sent.name.trim() || "Untitled flow",
        graph: sent.graph,
        triggers: payloadTriggers(sent.triggers),
        triggerVersions: versionsRef.current,
      };
      if (mode === "live") body.status = "ACTIVE";
      if (mode === "pause") body.status = "PAUSED";

      savingRef.current = true;
      setSaveState("saving");
      try {
        const triggers = body.triggers as EditorTrigger[];
        const hasNewCommentTrigger = triggers.some((t) => t.type === "comment" && !t.automationId);
        const res = await putWithRetry(`/api/flows/${flowId}`, JSON.stringify(body), !hasNewCommentTrigger);
        const payload = await res.json().catch(() => null);
        if (res.status === 409 && Array.isArray(payload?.conflicts)) {
          const conflicts = payload.conflicts as { clientId: string; trigger: CommentTrigger }[];
          for (const { trigger } of conflicts) {
            if (trigger.automationId && trigger.version) versionsRef.current[trigger.automationId] = trigger.version;
          }
          const fresh = new Map(conflicts.map((c) => [c.clientId, { ...c.trigger, id: c.clientId, version: undefined }] as const));
          setHistory((h) =>
            historyReplace(h, {
              ...h.present,
              triggers: h.present.triggers.map((t) => fresh.get(t.id) ?? t).map((t) => (t.type === "comment" ? stripVersions([t])[0] : t)),
            })
          );
          setSaveState("error");
          setSaveError(payload.error ?? "A comment trigger changed elsewhere and was refreshed.");
          return { ok: false, error: payload.error };
        }
        if (!res.ok || !payload?.success) {
          const validation = payload?.validation as FlowValidationPayload | undefined;
          if (validation) {
            setServerErrors(validation.serverErrors ?? []);
            setServerWarnings(validation.serverWarnings ?? []);
          }
          setSaveState("error");
          setSaveError(payload?.error ?? "Could not save the flow");
          if (mode === "auto") setFailedSnapshot(sentSnapshot);
          return { ok: false, error: payload?.error ?? "Could not save the flow", validation };
        }
        const data = payload.data as FlowDetail & { idMap?: Record<string, string> };
        for (const [clientId, automationId] of Object.entries(data.idMap ?? {})) idMapRef.current.set(clientId, automationId);
        setAutomationIds(Object.fromEntries(idMapRef.current));
        versionsRef.current = { ...(data.triggerVersions ?? {}) };
        setMeta(data);
        setSavedSnapshot(sentSnapshot);
        setFailedSnapshot(null);
        const validation = payload.validation as FlowValidationPayload | undefined;
        setServerErrors(validation?.serverErrors ?? []);
        setServerWarnings(validation?.serverWarnings ?? []);
        setSaveState("saved");
        setSaveError(null);
        return { ok: true, validation };
      } catch (error) {
        console.error("[flows] save failed:", error);
        setSaveState("error");
        setSaveError("Could not reach the server. Your changes are still here: check your connection and try again.");
        if (mode === "auto") setFailedSnapshot(sentSnapshot);
        return { ok: false, error: "Could not reach the server" };
      } finally {
        savingRef.current = false;
      }
    },
    [flowId, history.present]
  );

  // Autosave drafts and paused flows; a live flow waits for Publish.
  const canAutosave = dirty && status !== "ACTIVE" && saveState !== "saving" && snapshot !== failedSnapshot;
  useEffect(() => {
    if (!canAutosave) return;
    const timer = window.setTimeout(() => void save("auto"), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [canAutosave, snapshot, save]);

  // Leaving with unsaved work: warn for live flows, flush drafts.
  const flushRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    flushRef.current = () => {
      if (!dirty || status === "ACTIVE" || savingRef.current) return;
      const sent = history.present;
      void fetch(`/api/flows/${flowId}`, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sent.name.trim() || "Untitled flow",
          graph: sent.graph,
          triggers: payloadTriggers(sent.triggers),
          triggerVersions: versionsRef.current,
        }),
      }).catch(() => undefined);
    };
  });
  useEffect(() => {
    const onPageHide = () => flushRef.current();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flushRef.current();
    };
  }, []);
  useEffect(() => {
    if (!dirty || status !== "ACTIVE") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, status]);

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

  return {
    loading,
    loadError,
    shapeErrors,
    meta,
    draft,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
    undo,
    redo,
    save,
    dirty,
    status,
    saveState,
    saveError,
    serverErrors,
    serverWarnings,
    flows,
    media,
    stats,
    uploadMedia,
    /** Automation id of a comment trigger, once it has one. */
    automationIdOf: (trigger: CommentTrigger) => automationIds[trigger.id] ?? trigger.automationId ?? null,
  };
}

export type FlowDocument = ReturnType<typeof useFlowDocument>;
