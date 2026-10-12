"use client";

export interface AccountOption {
  id: string;
  username: string;
  instagramId: string;
  name?: string | null;
}

interface AccountSelectProps {
  accounts: AccountOption[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  label?: string;
  /** Keep the label for screen readers only (tight toolbars). */
  hideLabel?: boolean;
}

/** Chevron for a native select styled with `.field appearance-none pr-9`. */
export function SelectChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

/** Native select (keyboard, screen reader and phone pickers for free), styled as a field. */
export default function AccountSelect({
  accounts,
  value,
  onChange,
  includeAll = true,
  label = "Instagram account",
  hideLabel = false,
}: AccountSelectProps) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className={hideLabel ? "sr-only" : "field-label"}>{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="field appearance-none pr-9 sm:min-w-52"
        >
          {includeAll && <option value="all">All accounts</option>}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              @{account.username}
            </option>
          ))}
        </select>
        <SelectChevron />
      </span>
    </label>
  );
}
