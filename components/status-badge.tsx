/**
 * Status label for a campaign DM. A dot plus a word, so the state never
 * rests on color alone.
 */

const statusConfig: Record<string, { text: string; dot: string; label: string }> = {
  SENT: { text: "text-success", dot: "bg-success", label: "Sent" },
  FAILED: { text: "text-error", dot: "bg-error", label: "Failed" },
  PENDING: { text: "text-warning", dot: "bg-warning", label: "Pending" },
  SKIPPED_DEDUP: { text: "text-muted", dot: "bg-quiet", label: "Dedup" },
  SKIPPED_RATE_LIMIT: { text: "text-warning", dot: "bg-warning", label: "Rate limited" },
  SKIPPED_PLAN_LIMIT: { text: "text-warning", dot: "bg-warning", label: "Skipped" },
  SKIPPED_NO_MATCH: { text: "text-muted", dot: "bg-quiet", label: "No match" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.PENDING;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-footnote font-medium ${config.text}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
