"use client";

/**
 * Dashboard Home Page
 *
 * The month at a glance (one stat group, outcome first), the last seven
 * days of sends, the keywords that drove them, and the latest activity.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatCard, { StatGroup } from "@/components/stat-card";
import StatusBadge from "@/components/status-badge";
import { ChevronRightIcon } from "@/components/nav-icons";

interface DashboardStats {
  userName: string | null;
  contactsCount: number;
  totalAutomations: number;
  activeAutomations: number;
  dmsSentToday: number;
  dmsSentWeek: number;
  dmsSentMonth: number;
  dmsSkippedMonth: number;
  dmsFailedMonth: number;
  totalDMs: number;
  clicksThisMonth: number;
  totalClicks: number;
  ctrThisMonth: number;
  instagramAccounts: AccountOption[];
  selectedInstagramAccountId: string | null;
  topKeywords: { keyword: string; count: number }[];
  dailyDMs: { date: string; count: number }[];
  recentLogs: Array<{
    id: string;
    commenterName: string | null;
    commentText: string;
    status: string;
    createdAt: string;
    automation: { name: string };
    instagramAccount?: { username: string };
  }>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LoadingState() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-3">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>
      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="space-y-3 bg-surface px-5 py-4">
            <div className="skeleton h-3.5 w-20" />
            <div className="skeleton h-8 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="panel h-72 lg:col-span-2" />
        <div className="panel h-72" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }

    fetch(`/api/dashboard/stats${params.size ? `?${params}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setStats(data.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedAccountId]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  if (loading) return <LoadingState />;

  const dailyDMs = stats?.dailyDMs ?? [];
  const maxDM = Math.max(...dailyDMs.map((d) => d.count), 1);
  const weekTotal = dailyDMs.reduce((sum, day) => sum + day.count, 0);
  const connectedCount = stats?.instagramAccounts.length ?? 0;
  const failed = stats?.dmsFailedMonth ?? 0;
  const contacts = stats?.contactsCount ?? 0;

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-title-1 font-bold text-foreground">
            Hello, {stats?.userName ?? "there"}!
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>
              {connectedCount} connected {connectedCount === 1 ? "account" : "accounts"}
            </span>
            <span aria-hidden="true" className="text-quiet">
              ·
            </span>
            <span>
              {contacts} {contacts === 1 ? "contact" : "contacts"}
            </span>
            <span aria-hidden="true" className="text-quiet">
              ·
            </span>
            <Link
              href="/logs"
              className="press inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
            >
              See activity
              <ChevronRightIcon size={14} />
            </Link>
          </p>
        </div>
        {stats && stats.instagramAccounts.length > 1 && (
          <AccountSelect
            accounts={stats.instagramAccounts}
            value={selectedAccountId}
            onChange={handleAccountChange}
            hideLabel
          />
        )}
      </div>

      {/* The month: outcome first, then reach, then health. */}
      <section aria-labelledby="dashboard-month">
        <h2 id="dashboard-month" className="section-title mb-2.5 px-1">
          This month
        </h2>
        <StatGroup className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard grouped label="DMs sent" value={(stats?.dmsSentMonth ?? 0).toLocaleString()} />
          <StatCard grouped label="Link clicks" value={(stats?.clicksThisMonth ?? 0).toLocaleString()} />
          <StatCard grouped label="Click-through rate" value={`${stats?.ctrThisMonth ?? 0}%`} />
          <StatCard
            grouped
            label="Live comment triggers"
            value={stats?.activeAutomations ?? 0}
            hint={stats ? `of ${stats.totalAutomations}` : undefined}
          />
          <StatCard
            grouped
            label="Skipped"
            value={(stats?.dmsSkippedMonth ?? 0).toLocaleString()}
            tone={stats?.dmsSkippedMonth ? "default" : "quiet"}
          />
          <StatCard
            grouped
            label="Failed"
            value={failed.toLocaleString()}
            tone={failed > 0 ? "error" : "quiet"}
          />
        </StatGroup>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 7-day chart */}
        <section aria-labelledby="dashboard-week" className="panel p-5 sm:p-6 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="dashboard-week" className="section-title">
              DMs sent, last 7 days
            </h2>
            <p className="text-footnote text-muted">
              <span className="font-semibold tabular-nums text-foreground">
                {weekTotal.toLocaleString()}
              </span>{" "}
              total
            </p>
          </div>
          <ol className="mt-6 flex h-48 items-end gap-2 sm:gap-3">
            {dailyDMs.map((day, index) => {
              const isToday = index === dailyDMs.length - 1;
              return (
                <li
                  key={`${day.date}-${index}`}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                  aria-label={`${isToday ? "Today" : day.date}: ${day.count} DMs`}
                >
                  <span
                    className={`text-caption tabular-nums ${
                      day.count > 0 ? "font-semibold text-foreground" : "text-faint"
                    }`}
                  >
                    {day.count}
                  </span>
                  <div
                    className={`w-full max-w-9 rounded-t-lg rounded-b-sm ${day.count > 0 ? "bg-accent" : "bg-fill-strong"}`}
                    style={{ height: `${Math.max((day.count / maxDM) * 100, 3)}%` }}
                  />
                  <span
                    className={`text-caption ${isToday ? "font-semibold text-foreground" : "text-faint"}`}
                  >
                    {isToday ? "Today" : day.date}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Top keywords */}
        <section aria-labelledby="dashboard-keywords" className="panel p-5 sm:p-6">
          <h2 id="dashboard-keywords" className="section-title">
            Top keywords
          </h2>
          {stats?.topKeywords.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No keyword matches yet.</p>
          ) : (
            <ol className="mt-4 space-y-3">
              {stats?.topKeywords.map((keyword, index) => {
                const top = stats.topKeywords[0]?.count || 1;
                return (
                  <li key={keyword.keyword}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-4 shrink-0 text-caption tabular-nums text-faint">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {keyword.keyword}
                        </span>
                      </span>
                      <span className="text-footnote tabular-nums text-muted">{keyword.count}</span>
                    </div>
                    <div className="ml-6 mt-1.5 h-1 overflow-hidden rounded-full bg-fill">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max((keyword.count / top) * 100, 4)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section aria-labelledby="dashboard-activity">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
          <h2 id="dashboard-activity" className="section-title">
            Recent activity
          </h2>
          <Link
            href="/logs"
            className="press inline-flex items-center gap-0.5 text-footnote font-medium text-accent hover:underline"
          >
            All DM logs
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {stats?.recentLogs.length === 0 ? (
          <p className="panel px-5 py-10 text-center text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="panel overflow-hidden">
            {stats?.recentLogs.map((log, index) => (
              <li
                key={log.id}
                className={`flex items-center gap-4 px-4 py-3 sm:px-5 ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    @{log.commenterName ?? "unknown"}
                  </p>
                  <p className="mt-0.5 truncate text-footnote text-muted">
                    {log.commentText}
                    <span className="text-faint">
                      {" · "}
                      {log.automation.name}
                      {log.instagramAccount ? ` · @${log.instagramAccount.username}` : ""}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <StatusBadge status={log.status} />
                  <time dateTime={log.createdAt} className="text-caption tabular-nums text-faint">
                    {formatTime(log.createdAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
