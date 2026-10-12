"use client";

/**
 * Diagnostics
 *
 * Answers one question first: is OpenSetter processing comments and DMs
 * right now, and if not, what is wrong. The verdict sits on top, the job
 * queue under it, then each failure source in a fixed order (an empty
 * source collapses to one "None recorded" row, so nothing moves around),
 * and the operational event log last.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import StatusBadge from "@/components/status-badge";
import {
  AlertIcon,
  CheckCircleIcon,
  DiagnosticsIcon,
  RefreshIcon,
} from "@/components/nav-icons";

interface DiagnosticsData {
  queueCounts: Record<string, number>;
  workerHealth: {
    healthy: boolean;
    ageMs: number | null;
    heartbeat: {
      checkedAt: string;
      hostname?: string;
      pid: number;
      startedAt?: string;
    } | null;
  };
  workerAlerts: Array<{
    level: string;
    message: string;
    jobId?: string;
    commentId?: string;
    createdAt: string;
  }>;
  webhookFailures: Array<{
    id: string;
    object: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  dmFailures: Array<{
    id: string;
    status: string;
    commentId: string;
    commentText: string;
    errorMessage: string | null;
    updatedAt: string;
    automation: { name: string };
  }>;
  tokenRefreshFailures: Array<{
    id: string;
    message: string;
    createdAt: string;
  }>;
  operationalEvents: Array<{
    id: string;
    source: string;
    level: string;
    message: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

type Tone = "success" | "warning" | "error";
type IconType = ComponentType<{ size?: number; className?: string }>;

/** The API returns at most this many rows per failure list. */
const LIST_CAP = 10;
const EVENT_CAP = 20;
const REQUEST_TIMEOUT_MS = 15_000;

const QUEUE_KEYS = [
  { key: "waiting", label: "Waiting" },
  { key: "active", label: "Active" },
  { key: "delayed", label: "Delayed" },
  { key: "failed", label: "Failed" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  WORKER: "Worker",
  TOKEN_REFRESH: "Token refresh",
  HEALTH: "Health check",
  SYSTEM: "System",
  AUDIT: "Security audit",
};

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

const TONE_BADGE: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  error: "bg-error/14 text-error",
};

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatAbsolute(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "Just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
function formatRelative(value: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact span: "42 seconds", "6 minutes", "3 h 20 min", "4 days 2 h". */
function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ${hours % 24} h`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A capped list may hold more than it shows. */
function capped(count: number, cap: number): string {
  return count >= cap ? `${cap}+` : String(count);
}

// ─── Data ───────────────────────────────────────────────────────────────────

type FetchResult = { data: DiagnosticsData } | { error: string; forbidden?: boolean };

async function fetchDiagnostics(): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/admin/diagnostics", {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success) return { data: payload.data as DiagnosticsData };
    return {
      error:
        payload?.error ??
        `The diagnostics request failed with status ${response.status}.`,
      forbidden: response.status === 403,
    };
  } catch {
    return controller.signal.aborted
      ? {
          error:
            "No answer within 15 seconds. Redis or the database may be unreachable from the app server.",
        }
      : { error: "Could not reach the server. Check your connection and try again." };
  } finally {
    window.clearTimeout(timer);
  }
}

interface Verdict {
  tone: Tone;
  title: string;
  detail: string;
}

function describe(data: DiagnosticsData): Verdict {
  const { workerHealth } = data;
  if (!workerHealth.healthy) {
    return workerHealth.heartbeat && workerHealth.ageMs != null
      ? {
          tone: "error",
          title: "The DM worker stopped checking in",
          detail: `Its last heartbeat was ${formatSpan(workerHealth.ageMs)} ago. Queued comments and DMs wait until it runs again.`,
        }
      : {
          tone: "error",
          title: "The DM worker is not running",
          detail:
            "No heartbeat found. Queued comments and DMs wait until the worker runs again.",
        };
  }

  const failedDms = data.dmFailures.filter((item) => item.status === "FAILED").length;
  const failedJobs = data.queueCounts.failed ?? 0;
  const problems = [
    failedJobs > 0 && plural(failedJobs, "failed job", "failed jobs"),
    data.workerAlerts.length > 0 &&
      `${capped(data.workerAlerts.length, LIST_CAP)} worker ${data.workerAlerts.length === 1 ? "alert" : "alerts"}`,
    failedDms > 0 && plural(failedDms, "failed DM", "failed DMs"),
    data.webhookFailures.length > 0 &&
      `${capped(data.webhookFailures.length, LIST_CAP)} webhook ${data.webhookFailures.length === 1 ? "failure" : "failures"}`,
    data.tokenRefreshFailures.length > 0 &&
      `${capped(data.tokenRefreshFailures.length, LIST_CAP)} token refresh ${data.tokenRefreshFailures.length === 1 ? "failure" : "failures"}`,
  ].filter((item): item is string => Boolean(item));

  if (problems.length > 0) {
    return {
      tone: "warning",
      title: "Running, with problems to review",
      detail: `${problems.join(", ")}.`,
    };
  }
  return {
    tone: "success",
    title: "Everything is running",
    detail: "The DM worker is processing comments and DMs. No failures recorded.",
  };
}

// ─── Building blocks ────────────────────────────────────────────────────────

function Time({ value, now }: { value: string; now: number }) {
  return (
    <time
      dateTime={value}
      title={formatAbsolute(value)}
      className="shrink-0 text-caption tabular-nums text-faint"
    >
      {formatRelative(value, now)}
    </time>
  );
}

function LevelTag({ level }: { level: string }) {
  const normalized = level.toUpperCase();
  const tone: Tone | null =
    normalized === "ERROR" ? "error" : normalized === "WARNING" || normalized === "WARN" ? "warning" : null;
  if (!tone) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${TONE_BADGE[tone]}`}>
      {tone === "error" ? "Error" : "Warning"}
    </span>
  );
}

/**
 * One failure source as a grouped card: a header row that always shows,
 * and the recorded items under it. Rows are inset so their dividers line
 * up with the header text, not the icon.
 */
function SourceCard({
  id,
  title,
  count,
  cap = LIST_CAP,
  tone,
  children,
}: {
  id: string;
  title: string;
  count: number;
  cap?: number;
  /** Tone of the header icon when the list has items. */
  tone: Tone | "neutral";
  children?: ReactNode;
}) {
  const empty = count === 0;
  const Glyph: IconType = empty ? CheckCircleIcon : tone === "neutral" ? DiagnosticsIcon : AlertIcon;
  const glyphClass = empty
    ? "text-success"
    : tone === "neutral"
      ? "text-muted"
      : TONE_TEXT[tone];

  return (
    <section aria-labelledby={id} className="panel overflow-hidden">
      <div className="flex min-h-13 items-center gap-3 px-4 py-3 sm:px-5">
        <Glyph size={20} className={`shrink-0 ${glyphClass}`} />
        <h3 id={id} className="min-w-0 flex-1 text-headline font-semibold text-foreground">
          {title}
        </h3>
        {empty ? (
          <span className="text-footnote text-muted">None recorded</span>
        ) : (
          <span className="rounded-full bg-fill-strong px-2.5 py-0.5 text-footnote font-semibold tabular-nums text-foreground">
            {capped(count, cap)}
          </span>
        )}
      </div>
      {!empty && <ul className="pb-1">{children}</ul>}
    </section>
  );
}

function SourceRow({ children }: { children: ReactNode }) {
  return (
    <li className="pl-4 pr-4 sm:pl-[3.25rem] sm:pr-5">
      <div className="border-t border-border py-3">{children}</div>
    </li>
  );
}

function RowHead({ title, after, time }: { title: ReactNode; after?: ReactNode; time: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 break-words text-sm font-medium text-foreground">{title}</p>
        {after}
      </div>
      {time}
    </div>
  );
}

function StatusHero({
  data,
  error,
  forbidden,
  refreshing,
  fetchedAt,
  onRefresh,
}: {
  data: DiagnosticsData | null;
  error: string | null;
  forbidden: boolean;
  refreshing: boolean;
  fetchedAt: number | null;
  onRefresh: () => void;
}) {
  const verdict: Verdict = data
    ? describe(data)
    : forbidden
      ? {
          tone: "warning",
          title: "Diagnostics are for owners and admins",
          detail: "Ask a workspace owner or admin to check this page or to change your role.",
        }
      : {
          tone: "error",
          title: "Diagnostics did not load",
          detail: error ?? "Something went wrong.",
        };
  const Glyph: IconType = verdict.tone === "success" ? CheckCircleIcon : AlertIcon;
  const heartbeat = data?.workerHealth.heartbeat ?? null;
  const ageMs = data?.workerHealth.ageMs ?? null;

  const facts: Array<{ label: string; value: string }> = [];
  if (heartbeat && ageMs != null) {
    facts.push({ label: "Last heartbeat", value: `${formatSpan(ageMs)} ago` });
    if (heartbeat.hostname) facts.push({ label: "Host", value: heartbeat.hostname });
    facts.push({ label: "PID", value: String(heartbeat.pid) });
    if (heartbeat.startedAt) {
      const upMs = new Date(heartbeat.checkedAt).getTime() - new Date(heartbeat.startedAt).getTime();
      if (Number.isFinite(upMs) && upMs >= 0) facts.push({ label: "Up for", value: formatSpan(upMs) });
    }
  }

  return (
    <section aria-labelledby="diagnostics-status" className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:gap-4">
          <span
            aria-hidden="true"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${TONE_BADGE[verdict.tone]}`}
          >
            <Glyph size={24} />
          </span>
          <div className="min-w-0 sm:pt-0.5">
            <h2 id="diagnostics-status" className="text-title-2 font-bold text-foreground">
              {verdict.title}
            </h2>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{verdict.detail}</p>
            {facts.length > 0 && (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {facts.map((fact) => (
                  <div key={fact.label} className="min-w-0">
                    <dt className="text-caption text-faint">{fact.label}</dt>
                    <dd className="mt-0.5 truncate text-footnote font-medium tabular-nums text-foreground">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {data && error && (
              <p role="alert" className="mt-4 text-footnote text-error">
                Refresh failed: {error} Showing the previous result.
              </p>
            )}
          </div>
        </div>

        <div
          className={`flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-2 ${
            forbidden && !data ? "hidden" : ""
          }`}
        >
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="btn btn-secondary"
          >
            <RefreshIcon size={16} className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Checking…" : data ? "Refresh" : "Try again"}
          </button>
          <p className="text-caption tabular-nums text-faint" aria-live="polite">
            {fetchedAt
              ? `Checked ${new Date(fetchedAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function QueueCard({ counts }: { counts: Record<string, number> }) {
  return (
    <section aria-labelledby="diagnostics-queue">
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
        <h2 id="diagnostics-queue" className="section-title">
          Job queue
        </h2>
        <p className="text-caption text-faint">Comment and DM jobs in Redis</p>
      </div>
      <dl className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-4">
        {QUEUE_KEYS.map(({ key, label }, index) => {
          const value = counts[key] ?? 0;
          const tone =
            value === 0 ? "text-quiet" : key === "failed" ? "text-error" : "text-foreground";
          return (
            <div
              key={key}
              className={`px-4 py-4 sm:px-5 ${index % 2 === 1 ? "border-l border-border" : ""} ${
                index >= 2 ? "border-t border-border sm:border-t-0" : ""
              } ${index === 2 ? "sm:border-l" : ""}`}
            >
              <dt className="text-footnote text-muted">{label}</dt>
              <dd className={`mt-1 text-metric font-semibold tabular-nums ${tone}`}>
                {value.toLocaleString()}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="max-w-5xl space-y-8" aria-busy="true" aria-label="Loading diagnostics">
      <div className="panel flex items-start gap-4 p-5 sm:p-6">
        <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
        <div className="flex-1 space-y-3 pt-1">
          <div className="skeleton h-6 w-64 max-w-full" />
          <div className="skeleton h-4 w-96 max-w-full" />
          <div className="skeleton h-4 w-48" />
        </div>
      </div>
      <div className="panel h-[6.5rem]" />
      <div className="space-y-3">
        <div className="panel h-13" />
        <div className="panel h-13" />
        <div className="panel h-13" />
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  function apply(result: FetchResult) {
    if ("data" in result) {
      setData(result.data);
      setError(null);
      setForbidden(false);
    } else {
      setError(result.error);
      setForbidden(Boolean(result.forbidden));
    }
    setFetchedAt(Date.now());
  }

  async function refreshDiagnostics() {
    if (refreshing) return;
    setRefreshing(true);
    apply(await fetchDiagnostics());
    setRefreshing(false);
  }

  useEffect(() => {
    let active = true;
    void fetchDiagnostics().then((result) => {
      if (!active) return;
      apply(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <LoadingState />;

  const now = fetchedAt ?? 0;

  return (
    <div className="max-w-5xl space-y-8">
      <StatusHero
        data={data}
        error={error}
        forbidden={forbidden}
        refreshing={refreshing}
        fetchedAt={fetchedAt}
        onRefresh={() => void refreshDiagnostics()}
      />

      {data && (
        <>
          <QueueCard counts={data.queueCounts} />

          <section aria-labelledby="diagnostics-failures" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 id="diagnostics-failures" className="section-title">
                Failures
              </h2>
              <p className="text-caption text-faint">Latest {LIST_CAP} per source</p>
            </div>

            <SourceCard
              id="diagnostics-worker-alerts"
              title="Worker alerts"
              count={data.workerAlerts.length}
              tone={data.workerAlerts.some((alert) => alert.level.toLowerCase() === "error") ? "error" : "warning"}
            >
              {data.workerAlerts.map((alert) => (
                <SourceRow key={`${alert.createdAt}-${alert.jobId ?? alert.message}`}>
                  <RowHead
                    title={alert.message}
                    time={<Time value={alert.createdAt} now={now} />}
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-faint">
                    <LevelTag level={alert.level} />
                    {alert.commentId && (
                      <span>
                        Comment <span className="font-mono text-muted">{alert.commentId}</span>
                      </span>
                    )}
                    {alert.jobId && (
                      <span className="min-w-0 break-all">
                        Job <span className="font-mono text-muted">{alert.jobId}</span>
                      </span>
                    )}
                  </div>
                </SourceRow>
              ))}
            </SourceCard>

            <SourceCard
              id="diagnostics-dm-failures"
              title="Failed and skipped campaign DMs"
              count={data.dmFailures.length}
              tone={data.dmFailures.some((item) => item.status === "FAILED") ? "error" : "neutral"}
            >
              {data.dmFailures.map((item) => (
                <SourceRow key={item.id}>
                  <RowHead
                    title={item.automation.name}
                    after={<StatusBadge status={item.status} />}
                    time={<Time value={item.updatedAt} now={now} />}
                  />
                  {item.commentText && (
                    <p className="mt-1 line-clamp-2 break-words text-footnote text-muted">
                      “{item.commentText}”
                    </p>
                  )}
                  {item.errorMessage && (
                    <p
                      className={`mt-1 break-words text-footnote ${
                        item.status === "FAILED" ? "text-error" : "text-muted"
                      }`}
                    >
                      {item.errorMessage}
                    </p>
                  )}
                </SourceRow>
              ))}
            </SourceCard>

            <SourceCard
              id="diagnostics-webhooks"
              title="Webhook failures"
              count={data.webhookFailures.length}
              tone="error"
            >
              {data.webhookFailures.map((event) => (
                <SourceRow key={event.id}>
                  <RowHead
                    title={
                      event.object
                        ? `${event.object.charAt(0).toUpperCase()}${event.object.slice(1)} webhook`
                        : "Instagram webhook"
                    }
                    time={<Time value={event.createdAt} now={now} />}
                  />
                  <p className="mt-1 break-words text-footnote text-error">
                    {event.errorMessage ?? "Unknown error"}
                  </p>
                </SourceRow>
              ))}
            </SourceCard>

            <SourceCard
              id="diagnostics-token-refresh"
              title="Token refresh failures"
              count={data.tokenRefreshFailures.length}
              tone="error"
            >
              {data.tokenRefreshFailures.map((event) => (
                <SourceRow key={event.id}>
                  <RowHead title={event.message} time={<Time value={event.createdAt} now={now} />} />
                </SourceRow>
              ))}
            </SourceCard>
          </section>

          <section aria-labelledby="diagnostics-events">
            <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
              <h2 id="diagnostics-events" className="section-title">
                Event log
              </h2>
              <p className="text-caption text-faint">Latest {EVENT_CAP}, newest first</p>
            </div>
            {data.operationalEvents.length === 0 ? (
              <p className="panel px-5 py-6 text-center text-sm text-muted">
                No operational events recorded.
              </p>
            ) : (
              <ol className="panel overflow-hidden">
                {data.operationalEvents.map((event, index) => {
                  const level = event.level.toUpperCase();
                  const dot =
                    level === "ERROR" ? "bg-error" : level === "WARNING" ? "bg-warning" : "bg-quiet";
                  return (
                    <li
                      key={event.id}
                      className={`flex gap-3 px-4 py-3 sm:px-5 ${index > 0 ? "border-t border-border" : ""}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-[0.4375rem] h-2 w-2 shrink-0 rounded-full ${dot}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 break-words text-sm text-foreground">{event.message}</p>
                          <Time value={event.createdAt} now={now} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-faint">
                          <LevelTag level={event.level} />
                          <span>{SOURCE_LABELS[event.source] ?? event.source}</span>
                          {event.resolvedAt && (
                            <span className="text-success" title={formatAbsolute(event.resolvedAt)}>
                              Resolved
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
