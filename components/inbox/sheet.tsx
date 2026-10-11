"use client";

/**
 * Modal sheet on a native <dialog>: a bottom sheet on phones, a right-edge
 * sheet on tablets. Enters and leaves along the same edge, dims the page
 * behind it, traps focus, and closes on Escape or a tap on the dimmed area.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/inbox/icons";
import { PRESS } from "@/components/inbox/ui";
import styles from "@/components/inbox/inbox.module.css";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-surface text-foreground shadow-2xl sm:h-full sm:max-h-none sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className={`-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground ${PRESS}`}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </dialog>
  );
}
