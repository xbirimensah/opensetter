"use client";

/**
 * Followers Over Time
 *
 * Single-series line chart over stored daily snapshots. Deliberately separate
 * from the Overview stat tiles: those sum the selected posts, while this is an
 * account-level total that ignores the post range.
 *
 * History depth is limited by what has been snapshotted — Instagram only serves
 * ~30 days of account insights, so earlier days exist only if this instance was
 * already running then.
 */

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface FollowerChartPoint {
  date: string;
  followers: number;
  delta: number | null;
}

// Recharts writes colors as SVG attributes, where CSS var() does not
// resolve, so the theme tokens are read from the computed style and
// re-read whenever data-theme flips on <html>.
const FALLBACK_TOKENS = {
  series: "#a610df", // --color-accent, 3.4:1+ against the dark card (non-text)
  grid: "#2a2a2a", // --color-border
  axis: "#999999", // --color-muted
  dotStroke: "#0e0e0e", // --color-surface
};

function readChartTokens(): typeof FALLBACK_TOKENS {
  if (typeof window === "undefined") return FALLBACK_TOKENS;
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    series: token("--color-accent", FALLBACK_TOKENS.series),
    grid: token("--color-border", FALLBACK_TOKENS.grid),
    axis: token("--color-muted", FALLBACK_TOKENS.axis),
    dotStroke: token("--color-surface", FALLBACK_TOKENS.dotStroke),
  };
}

function useChartTokens(): typeof FALLBACK_TOKENS {
  const [tokens, setTokens] = useState(FALLBACK_TOKENS);
  useEffect(() => {
    setTokens(readChartTokens());
    const observer = new MutationObserver(() => setTokens(readChartTokens()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: FollowerChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-footnote shadow-[var(--shadow-raised)]">
      <p className="text-muted">{formatDay(point.date)}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-foreground">
        {point.followers.toLocaleString()} followers
      </p>
      {point.delta !== null && point.delta !== 0 && (
        <p className={point.delta > 0 ? "text-success" : "text-error"}>
          {formatSigned(point.delta)} that day
        </p>
      )}
    </div>
  );
}

export default function FollowerChart({
  data,
  followers,
}: {
  data: FollowerChartPoint[];
  followers: number | null;
}) {
  const [showTable, setShowTable] = useState(false);
  const tokens = useChartTokens();

  const current = followers ?? data.at(-1)?.followers ?? null;

  // Net change across the whole visible window, shown once in the header rather
  // than labelling every point.
  const net =
    data.length > 1 ? data[data.length - 1].followers - data[0].followers : null;

  return (
    <section aria-labelledby="follower-chart-title" className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="follower-chart-title" className="section-title">
            Followers over time
          </h2>
          <p className="mt-1 text-sm tabular-nums text-muted">
            {current === null
              ? "Follower count unavailable"
              : `${current.toLocaleString()} now`}
            {net !== null && (
              <>
                {" · "}
                <span className={net >= 0 ? "text-success" : "text-error"}>
                  {formatSigned(net)}
                </span>{" "}
                over {data.length} days
              </>
            )}
          </p>
        </div>
        {data.length > 1 && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="btn btn-secondary btn-sm"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>

      {data.length < 2 ? (
        <div className="mt-6 rounded-xl bg-fill px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">Collecting follower history</p>
          <p className="mt-1 text-sm text-muted">
            {data.length === 0
              ? "No snapshots recorded yet."
              : "One day recorded so far."}{" "}
            A point is added daily. The chart appears once there are at least
            two.
          </p>
        </div>
      ) : showTable ? (
        <div className="mt-4 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption text-faint">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 px-3 font-medium text-right">Followers</th>
                <th className="py-2 pl-3 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.date} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 text-foreground">
                    {formatDay(p.date)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted">
                    {p.followers.toLocaleString()}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-muted">
                    {p.delta === null ? "n/a" : formatSigned(p.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-6 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke={tokens.grid}
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDay}
                tick={{ fill: tokens.axis, fontSize: 12 }}
                stroke={tokens.grid}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fill: tokens.axis, fontSize: 12 }}
                stroke={tokens.grid}
                tickLine={false}
                width={52}
                // Followers rarely start near zero, so a zero baseline would
                // flatten the line into a straight edge.
                domain={["dataMin - 5", "dataMax + 5"]}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: tokens.grid, strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="followers"
                stroke={tokens.series}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: tokens.series, stroke: tokens.dotStroke, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
