"use client";

/**
 * DM Logs Page
 *
 * Filterable, paginated log of campaign DMs. A table from md up; on phones
 * each log is a two-line row, so nothing needs a sideways scroll.
 */

import { useEffect, useState, useCallback } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/nav-icons";

interface DmLog {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  automation: { name: string; keywords: string[] };
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "PENDING", label: "Pending" },
  { value: "SKIPPED_RATE_LIMIT", label: "Rate limited" },
  { value: "SKIPPED_PLAN_LIMIT", label: "Plan limit" },
  { value: "SKIPPED_DEDUP", label: "Dedup" },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function commenter(log: DmLog): string {
  return `@${log.commenterName ?? log.commenterId.slice(0, 8)}`;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<DmLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }

      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.logs);
        setPagination(data.data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, selectedAccountId]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  function handleFilterChange(status: string) {
    setLoading(true);
    setStatusFilter(status);
    setPage(1);
  }

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
    setPage(1);
  }

  function goToPage(next: number) {
    setLoading(true);
    setPage(next);
  }

  const showEmpty = !loading && logs.length === 0;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="group"
          aria-label="Filter by status"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {STATUS_FILTERS.map((filter) => {
            const isActive = statusFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => handleFilterChange(filter.value)}
                aria-pressed={isActive}
                className={`btn btn-sm shrink-0 ${
                  isActive ? "bg-foreground text-background" : "btn-secondary text-muted hover:text-foreground"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={handleAccountChange}
            hideLabel
          />
        )}
      </div>

      <div className="panel overflow-hidden" aria-busy={loading}>
        {/* Table from md up */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-caption text-faint">
                <th scope="col" className="py-3 pl-5 pr-4 font-medium">Commenter</th>
                <th scope="col" className="px-4 py-3 font-medium">Comment</th>
                <th scope="col" className="px-4 py-3 font-medium">Campaign</th>
                <th scope="col" className="px-4 py-3 font-medium">Account</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="py-3 pl-4 pr-5 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    <td colSpan={6} className="px-5 py-4">
                      <div className="skeleton h-4" />
                    </td>
                  </tr>
                ))}
              {showEmpty && (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-5 py-14 text-center text-muted">
                    No logs match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((log) => (
                  <tr key={log.id} className="border-t border-border hover:bg-surface-hover">
                    <td className="py-3 pl-5 pr-4 font-medium text-foreground">{commenter(log)}</td>
                    <td className="max-w-[16rem] px-4 py-3">
                      <span className="block truncate text-muted" title={log.commentText}>
                        {log.commentText}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{log.automation.name}</td>
                    <td className="px-4 py-3 text-muted">@{log.instagramAccount.username}</td>
                    <td className="px-4 py-3">
                      <span title={log.errorMessage ?? undefined}>
                        <StatusBadge status={log.status} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pl-4 pr-5 text-right tabular-nums text-faint">
                      {formatTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Rows on phones */}
        <ul className="md:hidden">
          {loading &&
            [...Array(6)].map((_, i) => (
              <li key={i} className={`space-y-2 px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3.5 w-52" />
              </li>
            ))}
          {showEmpty && (
            <li className="px-4 py-14 text-center text-sm text-muted">No logs match this filter.</li>
          )}
          {!loading &&
            logs.map((log, index) => (
              <li key={log.id} className={`px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {commenter(log)}
                  </span>
                  <StatusBadge status={log.status} />
                </div>
                <p className="mt-0.5 truncate text-footnote text-muted">{log.commentText}</p>
                <p className="mt-0.5 truncate text-caption text-faint">
                  {log.automation.name} · @{log.instagramAccount.username} · {formatTime(log.createdAt)}
                </p>
                {log.errorMessage && log.status === "FAILED" && (
                  <p className="mt-1 break-words text-caption text-error">{log.errorMessage}</p>
                )}
              </li>
            ))}
        </ul>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <p className="text-footnote tabular-nums text-muted">
              {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                aria-label="Previous page"
                className="btn btn-quiet btn-sm px-2.5"
              >
                <ChevronLeftIcon size={16} />
                <span className="hidden sm:inline">Previous</span>
              </button>
              <span className="px-2 text-footnote tabular-nums text-muted">
                {page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => goToPage(page + 1)}
                aria-label="Next page"
                className="btn btn-quiet btn-sm px-2.5"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
