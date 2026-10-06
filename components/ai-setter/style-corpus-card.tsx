"use client";

/**
 * Style corpus status: freshness, coverage, language mix, a sample of
 * what the setter learns from, and the rebuild action. The corpus is
 * built server-side from the locally mirrored DMs only.
 *
 * The rebuild reports its real outcome even when the HTTP response is
 * lost (proxy timeout, backgrounded phone tab): see style-corpus-client.
 */

import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "./form";
import {
  describeCorpusState,
  describeRebuildSuccess,
  fetchCorpusStatus,
  rebuildCorpusWithRecovery,
  type CorpusBadgeTone,
  type CorpusStatusView,
} from "@/lib/ai-setter/style-corpus-client";

const LANGUAGE_LABELS: Record<string, string> = {
  de: "German",
  en: "English",
  pt: "Portuguese",
  unknown: "Unclear",
};

const BADGE_CLASSES: Record<CorpusBadgeTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  neutral: "bg-surface-hover text-muted",
};

type Feedback = { tone: "success" | "error"; text: string; at: string };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2">
      <dt className="truncate text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export default function StyleCorpusCard({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<CorpusStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Results that arrive after the user switched accounts must not land
  // on the other account's card.
  const currentAccount = useRef(accountId);

  useEffect(() => {
    currentAccount.current = accountId;
    let cancelled = false;
    void fetchCorpusStatus(accountId).then((result) => {
      if (cancelled) return;
      if ("status" in result) {
        setStatus(result.status);
        setLoadError(null);
      } else {
        setStatus(null);
        setLoadError(result.error);
      }
      setFeedback(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function rebuild() {
    if (rebuilding) return;
    const startedFor = accountId;
    setRebuilding(true);
    setFeedback(null);
    try {
      const outcome = await rebuildCorpusWithRecovery(startedFor, status?.builtAt ?? null);
      if (currentAccount.current !== startedFor) return;
      if (outcome.status) {
        setStatus(outcome.status);
        setLoadError(null);
      }
      setFeedback({
        tone: outcome.kind === "success" ? "success" : "error",
        text: outcome.kind === "success" ? describeRebuildSuccess(outcome) : outcome.message,
        at: new Date().toISOString(),
      });
    } finally {
      setRebuilding(false);
    }
  }

  const view = status ? describeCorpusState({ ...status, rebuilding: rebuilding || status.rebuilding }) : null;
  const languageEntries = Object.entries(status?.languages ?? {}).sort((a, b) => b[1] - a[1]);
  const lastFailed = feedback?.tone === "error";

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="corpus-heading" aria-busy={rebuilding}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="corpus-heading" className="text-sm font-semibold text-foreground">
            Style corpus
          </h2>
          <p className="mt-1 text-xs text-muted">
            Your own hand-typed Instagram DMs, already mirrored on this server.
            AI, campaign and prospect messages are excluded; emails, phone
            numbers, links and @handles are redacted. Nothing is fetched from
            other accounts.
          </p>
        </div>
        {view && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${BADGE_CLASSES[view.badge.tone]}`}>
            {view.badge.label}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted">Loading corpus…</p>
      ) : status ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Examples" value={String(status.entryCount)} />
            <Stat
              label="Chats covered"
              value={`${status.conversationCount}/${status.mirroredConversations} (${status.coveragePercent}%)`}
            />
            <Stat label="Last rebuild" value={formatDateTime(status.builtAt)} />
            <Stat label="Mirrored DMs" value={String(status.mirroredMessageCount)} />
            <Stat label="Hand-typed by you" value={String(status.humanMessageCount)} />
            <Stat label="Last DM mirrored" value={formatDateTime(status.lastMirroredAt)} />
            <Stat label="Newest example" value={formatDateTime(status.newestMessageAt)} />
            <Stat label="Oldest example" value={formatDateTime(status.oldestMessageAt)} />
          </dl>

          {view?.hint && (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {view.hint}
            </p>
          )}

          {languageEntries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {languageEntries.map(([language, count]) => (
                <span
                  key={language}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted"
                >
                  {LANGUAGE_LABELS[language] ?? language}: {count}
                </span>
              ))}
            </div>
          )}

          {status.samples.length > 0 && (
            <details className="mt-3 rounded-lg border border-border bg-background">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted hover:text-foreground">
                Show {status.samples.length} newest examples
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {status.samples.map((sample) => (
                  <li key={sample.id} className="px-3 py-2 text-sm">
                    <p className="break-words text-foreground">{sample.text}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : null}

      {loadError && !status && <p className="mt-3 text-sm text-error" role="alert">{loadError}</p>}

      <div className="mt-3 min-h-5" role="status" aria-live="polite">
        {feedback && (
          <p className={`break-words text-sm ${feedback.tone === "success" ? "text-success" : "text-error"}`}>
            {feedback.text}{" "}
            <span className="text-xs text-faint">({formatDateTime(feedback.at)})</span>
          </p>
        )}
        {rebuilding && (
          <p className="text-xs text-muted">
            Reading your mirrored DMs. This can take a minute; the rebuild keeps
            running on the server if you leave this page.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void rebuild()}
        disabled={rebuilding || loading}
        className="mt-3 min-h-11 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-border-hover hover:bg-surface-hover disabled:opacity-50 sm:min-h-0 sm:w-auto"
      >
        {rebuilding ? "Rebuilding…" : lastFailed ? "Try again" : "Rebuild from mirrored DMs"}
      </button>
    </section>
  );
}
