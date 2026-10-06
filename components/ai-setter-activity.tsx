"use client";

/**
 * AI Setter activity: the review queue (held drafts with inline edit,
 * approve, dismiss) and the recent-activity feed underneath.
 */

import { useState } from "react";

export interface AiReplyItem {
  id: string;
  inboundText: string;
  draftText: string;
  confidence: number;
  reasons: string[];
  status:
    | "PENDING"
    | "SENDING"
    | "SENT"
    | "HELD"
    | "SKIPPED"
    | "FAILED"
    | "DISMISSED";
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  conversation: {
    id: string;
    participantId: string;
    participantUsername: string | null;
    aiEnabled: boolean;
  };
}

const STATUS_STYLES: Record<AiReplyItem["status"], { text: string; label: string }> = {
  SENT: { text: "text-success", label: "Sent" },
  SENDING: { text: "text-warning", label: "Sending" },
  HELD: { text: "text-warning", label: "Needs review" },
  PENDING: { text: "text-warning", label: "Pending" },
  SKIPPED: { text: "text-muted", label: "Skipped" },
  FAILED: { text: "text-error", label: "Failed" },
  DISMISSED: { text: "text-muted", label: "Dismissed" },
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function contactLabel(reply: AiReplyItem): string {
  return reply.conversation.participantUsername
    ? `@${reply.conversation.participantUsername}`
    : `user ${reply.conversation.participantId.slice(-6)}`;
}

function ConfidenceMeter({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  const tone =
    percent >= 78 ? "bg-success" : percent >= 50 ? "bg-warning" : "bg-error";
  return (
    <div className="flex items-center gap-2" title={`Model confidence ${percent}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-hover">
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted">{percent}%</span>
    </div>
  );
}

interface DraftCardProps {
  reply: AiReplyItem;
  onResolved: () => void;
}

function DraftCard({ reply, onResolved }: DraftCardProps) {
  const [text, setText] = useState(reply.draftText);
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "dismiss") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/ai-setter/replies/${reply.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action, text: text.trim() } : { action }
        ),
      });
      const data = await res.json();
      if (data.success) {
        onResolved();
      } else {
        setError(data.error ?? "Something went wrong");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground">
          {contactLabel(reply)}
        </span>
        <span className="shrink-0 text-[11px] text-faint">
          {formatTime(reply.createdAt)}
        </span>
      </div>

      <p className="mt-2 break-words rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted">
        {reply.inboundText}
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border border-border bg-surface-hover px-3 py-2 text-base text-foreground focus:border-accent/40 focus:outline-none sm:text-sm"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ConfidenceMeter value={reply.confidence} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void act("dismiss")}
            disabled={busy !== null}
            className="min-h-11 rounded-lg px-4 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-3"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => void act("approve")}
            disabled={busy !== null || !text.trim()}
            className="min-h-11 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:px-3"
          >
            {busy === "approve" ? "Sending…" : "Approve & send"}
          </button>
        </div>
      </div>

      {reply.reasons.length > 0 && (
        <p className="mt-2 text-[11px] text-faint">
          Held because: {reply.reasons.join("; ")}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  );
}

interface AiSetterActivityProps {
  held: AiReplyItem[];
  recent: AiReplyItem[];
  loading: boolean;
  onRefresh: () => void;
}

export default function AiSetterActivity({
  held,
  recent,
  loading,
  onRefresh,
}: AiSetterActivityProps) {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Needs review
            {held.length > 0 && (
              <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                {held.length}
              </span>
            )}
          </h2>
        </div>
        <div className="mt-3 space-y-3">
          {loading && held.length === 0 ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : held.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              Nothing waiting on you. Drafts land here when the setter is in
              draft mode or a safety gate holds a reply back.
            </p>
          ) : (
            held.map((reply) => (
              <DraftCard key={reply.id} reply={reply} onResolved={onRefresh} />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No setter activity yet.
            </p>
          ) : (
            recent.map((reply) => {
              const style = STATUS_STYLES[reply.status];
              return (
                <div
                  key={reply.id}
                  className="border-b border-border bg-surface px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-foreground">
                      {contactLabel(reply)}
                    </span>
                    <span className={`shrink-0 text-xs ${style.text}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {reply.inboundText}
                  </p>
                  {reply.draftText && (
                    <p className="mt-0.5 truncate text-xs text-faint">
                      AI: {reply.draftText}
                    </p>
                  )}
                  {reply.status === "SKIPPED" && reply.reasons.length > 0 && (
                    <p className="mt-0.5 truncate text-[11px] text-faint">
                      {reply.reasons.join("; ")}
                    </p>
                  )}
                  {reply.errorMessage && (
                    <p className="mt-0.5 truncate text-[11px] text-error">
                      {reply.errorMessage}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
