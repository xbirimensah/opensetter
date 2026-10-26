"use client";

/**
 * Search and quick filters above the inbox list: free text (handle,
 * email, phone, message text), a conversation state and a tag.
 */

import type { InboxStatus } from "@/lib/inbox/filters";
import { SearchIcon } from "@/components/inbox/icons";

export interface InboxListFilter {
  q: string;
  status: InboxStatus | "";
  tag: string;
}

export const EMPTY_LIST_FILTER: InboxListFilter = { q: "", status: "", tag: "" };

const STATUS_OPTIONS: Array<{ value: InboxStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "held_draft", label: "AI draft" },
  { value: "active_flow", label: "In a flow" },
];

export default function ListFilters({
  value,
  tags,
  onChange,
}: {
  value: InboxListFilter;
  tags: string[];
  onChange: (next: InboxListFilter) => void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
      <label className="relative block">
        <span className="sr-only">Search conversations</span>
        <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
          placeholder="Search name, email or message"
          maxLength={100}
          className="field min-h-10 py-1.5 pl-9"
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter conversations">
        {STATUS_OPTIONS.map((option) => {
          const selected = value.status === option.value;
          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ ...value, status: option.value })}
              className={`shrink-0 rounded-full px-3 py-1 text-footnote font-medium transition-colors duration-100 ${
                selected ? "bg-accent text-white" : "bg-fill text-muted hover:bg-fill-strong"
              }`}
            >
              {option.label}
            </button>
          );
        })}
        {tags.length > 0 && (
          <select
            value={value.tag}
            onChange={(event) => onChange({ ...value, tag: event.target.value })}
            aria-label="Filter by tag"
            className={`shrink-0 rounded-full border-0 py-1 pl-3 pr-7 text-footnote font-medium ${
              value.tag ? "bg-accent text-white" : "bg-fill text-muted"
            }`}
          >
            <option value="">Any tag</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
