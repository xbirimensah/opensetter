/**
 * Stat Card
 *
 * One metric: a quiet label over a large number. Inside a StatGroup the
 * cells share one card and hairline dividers instead of each being its
 * own box, so a row of metrics reads as one object.
 */

import type { ReactNode } from "react";

type Tone = "default" | "error" | "success" | "quiet";

const TONE: Record<Tone, string> = {
  default: "text-foreground",
  error: "text-error",
  success: "text-success",
  quiet: "text-quiet",
};

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  /** Color of the number. Defaults to the foreground. */
  tone?: Tone;
  /** One short line under the number. */
  hint?: string;
  /** Rendered as a cell of a StatGroup rather than its own card. */
  grouped?: boolean;
}

export default function StatCard({
  label,
  value,
  trend,
  trendUp,
  tone = "default",
  hint,
  grouped = false,
}: StatCardProps) {
  return (
    <div className={grouped ? "min-w-0 bg-surface px-4 py-4 sm:px-5" : "panel min-w-0 px-4 py-4 sm:px-5"}>
      <p className="truncate text-footnote text-muted">{label}</p>
      <p className={`mt-1 truncate text-metric font-semibold tabular-nums ${TONE[tone]}`}>{value}</p>
      {trend && (
        <p className={`mt-1 text-caption ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "Up" : "Down"} {trend}
        </p>
      )}
      {hint && <p className="mt-1 truncate text-caption text-faint">{hint}</p>}
    </div>
  );
}

/**
 * A row of StatCards in one card. The 1px gaps show the border color
 * through, which draws the dividers for any column count. Pass a
 * grid-cols-* set that divides the number of cells evenly at every
 * breakpoint, so no empty cell shows.
 */
export function StatGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`panel grid gap-px overflow-hidden bg-border ${className}`}>{children}</div>
  );
}
