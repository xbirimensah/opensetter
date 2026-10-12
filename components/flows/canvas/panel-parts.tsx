"use client";

/**
 * Small pieces shared by the sidebar and the top bar: inline rename, an
 * info tooltip, the panel header and the 24h window note.
 */

import { useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { IconButton, PRESS } from "../ui";

export function InlineRename({
  value,
  placeholder,
  onCommit,
  maxLength = 60,
  className = "",
  label,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  maxLength?: number;
  className?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  function start() {
    setDraft(value);
    cancelled.current = false;
    setEditing(true);
  }

  function finish() {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim().slice(0, maxLength);
    if (next !== value.trim()) onCommit(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={maxLength}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        className={`-mx-1.5 w-full min-w-0 rounded-md border border-accent/40 bg-background px-1.5 py-0.5 text-foreground outline-none ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title={`${label} (click to rename)`}
      className={`group -mx-1.5 inline-flex min-w-0 max-w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-surface-hover ${PRESS} ${className}`}
    >
      <span className={`min-w-0 truncate ${value.trim() ? "text-foreground" : "text-muted"}`}>{value.trim() || placeholder}</span>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-hover:text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
      </svg>
    </button>
  );
}

/** (i) with a short explanation; hover, focus or tap shows it. */
export function InfoTip({ text, label = "More info" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="-m-2 inline-grid h-8 w-8 place-items-center rounded-full text-faint hover:text-muted"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl transition-[opacity,scale] duration-150 starting:scale-95 starting:opacity-0"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export const WINDOW_TIP =
  "Instagram lets a business message someone automatically only within 24 hours of their last message, button tap or comment. If that window has closed, this step is not sent and the run ends.";

export const PRIVATE_REPLY_TIP =
  "Instagram allows one private reply per comment. The first block goes out as that reply; the rest of the flow continues once they tap a button or write back.";

export function WindowNote({ privateReply }: { privateReply: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {privateReply ? "Sent as the private reply to the comment" : "Send within 24 hour window"}
      <InfoTip text={privateReply ? PRIVATE_REPLY_TIP : WINDOW_TIP} label="About the 24 hour window" />
    </p>
  );
}

export function PanelHeader({
  icon,
  eyebrow,
  title,
  actions,
  onClose,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 pb-3 pt-3.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{eyebrow}</p>
        <div className="text-[17px] font-semibold leading-snug tracking-[-0.02em]">{title}</div>
      </div>
      <div className="-mr-1.5 flex shrink-0 items-center">
        {actions}
        <IconButton label="Close" onClick={onClose}>
          <Icon.close className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}
