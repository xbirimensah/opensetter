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
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-fill-strong">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-caption tabular-nums text-muted">{percent}% confident</span>
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
    <article className="panel p-4" aria-label={`Draft for ${contactLabel(reply)}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-headline font-semibold text-foreground">
          {contactLabel(reply)}
        </span>
        <span className="shrink-0 text-caption tabular-nums text-faint">
          {formatTime(reply.createdAt)}
        </span>
      </div>

      {/* Their message as they sent it, then the reply waiting for you. */}
      <p className="mt-3 w-fit max-w-[90%] break-words rounded-[1.125rem] rounded-bl-md bg-fill-strong px-3 py-2 text-sm text-foreground">
        {reply.inboundText}
      </p>

      <label className="mt-3 block">
        <span className="sr-only">Reply to send</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          className="field field-sizing-content max-h-60 resize-y border-accent/40 bg-accent/[0.06]"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ConfidenceMeter value={reply.confidence} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void act("dismiss")}
            disabled={busy !== null}
            className="btn btn-quiet"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => void act("approve")}
            disabled={busy !== null || !text.trim()}
            className="btn btn-primary"
          >
            {busy === "approve" ? "Sending…" : "Approve & send"}
          </button>
        </div>
      </div>

      {reply.reasons.length > 0 && (
        <p className="mt-3 text-caption text-faint">
          Held because: {reply.reasons.join("; ")}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-footnote text-error">{error}</p>}
    </article>
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
    <div className="space-y-8">
      <section aria-labelledby="setter-review">
        <h2 id="setter-review" className="section-title mb-2.5 flex items-center gap-2 px-1">
          Needs review
          {held.length > 0 && (
            <span className="rounded-full bg-warning/15 px-2 py-px text-caption font-semibold tabular-nums text-warning">
              {held.length}
            </span>
          )}
        </h2>
        <div className="space-y-3">
          {loading && held.length === 0 ? (
            <div className="panel h-40" aria-busy="true" aria-label="Loading drafts" />
          ) : held.length === 0 ? (
            <div className="panel px-5 py-8 text-center">
              <p className="text-sm font-medium text-foreground">Nothing waiting on you</p>
              <p className="mx-auto mt-1 max-w-xs text-footnote text-muted">
                Drafts land here when the setter is in draft mode or a safety
                gate holds a reply back.
              </p>
            </div>
          ) : (
            held.map((reply) => (
              <DraftCard key={reply.id} reply={reply} onResolved={onRefresh} />
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="setter-recent">
        <h2 id="setter-recent" className="section-title mb-2.5 px-1">
          Recent activity
        </h2>
        <div className="panel overflow-hidden">
          {recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              No setter activity yet.
            </p>
          ) : (
            recent.map((reply, index) => {
              const style = STATUS_STYLES[reply.status];
              return (
                <div
                  key={reply.id}
                  className={`px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">
                      {contactLabel(reply)}
                    </span>
                    <span className={`shrink-0 text-footnote font-medium ${style.text}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-footnote text-muted">
                    {reply.inboundText}
                  </p>
                  {reply.draftText && (
                    <p className="mt-0.5 truncate text-footnote text-faint">
                      <span className="font-medium text-accent">AI</span> {reply.draftText}
                    </p>
                  )}
                  {reply.status === "SKIPPED" && reply.reasons.length > 0 && (
                    <p className="mt-0.5 truncate text-caption text-faint">
                      {reply.reasons.join("; ")}
                    </p>
                  )}
                  {reply.errorMessage && (
                    <p className="mt-0.5 truncate text-caption text-error">
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
