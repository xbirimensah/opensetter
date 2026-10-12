"use client";

/**
 * Instagram Overview Page
 *
 * Aggregate reach/engagement across your recent posts, plus a per-post table.
 * Views / reach / saved / shares come from Instagram media insights (requires
 * the insights permission); likes and comments are always available.
 */

import { useEffect, useState } from "react";
import AccountSelect, { SelectChevron } from "@/components/account-select";
import StatCard, { StatGroup } from "@/components/stat-card";
import FollowerChart from "@/components/follower-chart";
import { AlertIcon } from "@/components/nav-icons";
import type { OverviewResponse } from "@/app/api/instagram/overview/route";

/** Shown where Instagram did not return a number (no insights permission). */
const NOT_AVAILABLE = "n/a";

function formatNumber(n: number | null): string {
  if (n === null) return NOT_AVAILABLE;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COUNT_OPTIONS = [
  { value: "25", label: "Last 25 posts" },
  { value: "50", label: "Last 50 posts" },
  { value: "100", label: "Last 100 posts" },
  { value: "all", label: "All posts" },
];

const COLUMNS: Array<{ key: "views" | "reach" | "likes" | "comments" | "saved" | "shares"; label: string }> = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "saved", label: "Saved" },
  { key: "shares", label: "Shares" },
];

function Thumbnail({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-lg bg-fill-strong" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Instagram CDN thumbnail, expires; not worth optimizing
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg bg-fill-strong object-cover"
    />
  );
}

function LoadingState() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading overview">
      <div className="space-y-3">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-4 w-64" />
      </div>
      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-3 xl:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="space-y-3 bg-surface px-5 py-4">
            <div className="skeleton h-3.5 w-16" />
            <div className="skeleton h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="panel h-80" />
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [count, setCount] = useState("50");

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId !== "all") {
      params.set("instagramAccountId", selectedAccountId);
    }
    params.set("count", count);

    fetch(`/api/instagram/overview?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Failed to load overview");
        }
      })
      .catch(() => setError("Failed to load overview"))
      .finally(() => setLoading(false));
  }, [selectedAccountId, count]);

  function handleAccountChange(accountId: string) {
    setLoading(true);
    setSelectedAccountId(accountId);
  }

  function handleCountChange(next: string) {
    setLoading(true);
    setCount(next);
  }

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="panel mx-auto mt-6 max-w-md px-6 py-10 text-center">
        <span
          aria-hidden="true"
          className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-error/14 text-error"
        >
          <AlertIcon size={24} />
        </span>
        <p className="mt-4 text-title-3 font-semibold text-foreground">The overview did not load</p>
        <p className="mt-1.5 text-sm text-muted">{error}</p>
        {error.includes("connect") && (
          <a href="/api/instagram/connect" className="btn btn-primary mt-6">
            Connect Instagram
          </a>
        )}
      </div>
    );
  }

  if (!data) return null;

  const { totals, posts, accounts, insightsAvailable, followers, followerHistory } =
    data;

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-title-1 font-bold tabular-nums text-foreground">
            {followers !== null ? `${followers.toLocaleString()} followers` : `@${data.account.username}`}
          </p>
          {/* The follower total is account-level; the numbers below sum
              the selected posts only. */}
          <p className="mt-2 text-sm text-muted">
            {followers !== null && <>@{data.account.username} · </>}
            {totals.posts} {totals.posts === 1 ? "post" : "posts"}
            {data.requestedCount === "all" ? " of all time" : " analyzed"}
            {data.truncated ? ` (capped at ${totals.posts})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="sr-only">Posts</span>
            <span className="relative block">
              <select
                value={count}
                onChange={(e) => handleCountChange(e.target.value)}
                className="field appearance-none pr-9 sm:min-w-40"
              >
                {COUNT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </span>
          </label>
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts.map((a) => ({
                id: a.id,
                username: a.username,
                instagramId: a.id,
              }))}
              value={selectedAccountId}
              onChange={handleAccountChange}
              hideLabel
            />
          )}
        </div>
      </div>

      {!insightsAvailable && (
        <div className="panel flex flex-col gap-4 border-warning/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <AlertIcon size={20} className="mt-0.5 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                Views, reach, saved and shares need the insights permission.
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Reconnect your account to grant it. Likes and comments show in the
                meantime.
              </p>
            </div>
          </div>
          <a href="/api/instagram/connect" className="btn btn-secondary shrink-0">
            Reconnect Instagram
          </a>
        </div>
      )}

      {/* Aggregate totals across the selected posts */}
      <section aria-labelledby="overview-totals">
        <h2 id="overview-totals" className="section-title mb-2.5 px-1">
          Across these posts
        </h2>
        <StatGroup className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((column) => {
            const value = totals[column.key];
            return (
              <StatCard
                key={column.key}
                grouped
                label={column.label}
                value={formatNumber(value)}
                tone={value === null ? "quiet" : "default"}
              />
            );
          })}
        </StatGroup>
      </section>

      {/* Follower trend: account-level, independent of the post range */}
      <FollowerChart data={followerHistory} followers={followers} />

      {/* Per-post table */}
      <section aria-labelledby="overview-posts">
        <h2 id="overview-posts" className="section-title mb-2.5 px-1">
          Posts
        </h2>
        {posts.length === 0 ? (
          <p className="panel px-5 py-10 text-center text-sm text-muted">No posts found.</p>
        ) : (
          <>
          {/* Phones: one row per post with its numbers on a second line. */}
          <ul className="panel overflow-hidden md:hidden">
            {posts.map((p, index) => {
              const caption = p.caption || `${p.mediaType.toLowerCase()} post`;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <Thumbnail src={p.thumbnailUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      {p.permalink ? (
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 truncate text-sm font-medium text-foreground"
                        >
                          {caption}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{caption}</span>
                      )}
                      <span className="shrink-0 text-caption tabular-nums text-faint">
                        {formatDate(p.timestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-footnote leading-snug tabular-nums text-muted">
                      {COLUMNS.map((column) => `${formatNumber(p[column.key])} ${column.label.toLowerCase()}`).join(" · ")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="text-left text-caption text-faint">
                  <th scope="col" className="py-3 pl-4 pr-4 font-medium sm:pl-5">
                    Post
                  </th>
                  {COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className="px-3 py-3 text-right font-medium">
                      {column.label}
                    </th>
                  ))}
                  <th scope="col" className="py-3 pl-3 pr-4 text-right font-medium sm:pr-5">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => {
                  const caption = p.caption || `${p.mediaType.toLowerCase()} post`;
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-surface-hover">
                      <td className="max-w-xs py-2.5 pl-4 pr-4 sm:pl-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumbnail src={p.thumbnailUrl} />
                          {p.permalink ? (
                            <a
                              href={p.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block min-w-0 truncate text-foreground hover:text-accent"
                            >
                              {caption}
                            </a>
                          ) : (
                            <span className="block min-w-0 truncate text-foreground">{caption}</span>
                          )}
                        </div>
                      </td>
                      {COLUMNS.map((column) => {
                        const value = p[column.key];
                        return (
                          <td
                            key={column.key}
                            className={`px-3 py-2.5 text-right tabular-nums ${
                              value === null ? "text-faint" : "text-muted"
                            }`}
                          >
                            {formatNumber(value)}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap py-2.5 pl-3 pr-4 text-right tabular-nums text-faint sm:pr-5">
                        {formatDate(p.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}
