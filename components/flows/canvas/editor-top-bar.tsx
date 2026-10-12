"use client";

/**
 * The editor's floating top bar: breadcrumb with inline rename, status,
 * save state, undo / redo, issues, Preview, the primary action (Set Live
 * or Publish) and the overflow menu.
 */

import Link from "next/link";
import type { FlowStatusValue } from "../api-types";
import { Icon } from "../icons";
import { Button, IconButton, Menu, PRESS, type MenuItem } from "../ui";
import { InlineRename } from "./panel-parts";

const STATUS: Record<FlowStatusValue, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted/15 text-muted" },
  ACTIVE: { label: "Live", className: "bg-success/12 text-success" },
  PAUSED: { label: "Paused", className: "bg-warning/12 text-warning" },
};

export type SaveIndicator =
  | { kind: "saved"; text: string }
  | { kind: "saving" }
  | { kind: "pending"; text: string }
  | { kind: "error"; text: string };

function SaveState({ state, onRetry }: { state: SaveIndicator; onRetry: () => void }) {
  if (state.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden="true" />
        <span className="hidden sm:inline">Saving…</span>
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-error" aria-live="polite">
        <span className="hidden max-w-56 truncate sm:inline" title={state.text}>
          Not saved
        </span>
        <button type="button" onClick={onRetry} className={`rounded-full px-2 py-0.5 font-medium hover:bg-error/10 ${PRESS}`}>
          Retry
        </button>
      </span>
    );
  }
  if (state.kind === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning" aria-live="polite">
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        <span className="hidden sm:inline">{state.text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" aria-live="polite">
      <Icon.check className="h-3.5 w-3.5 text-success" />
      <span className="hidden sm:inline">{state.text}</span>
    </span>
  );
}

function UndoIcon({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 ${flip ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </svg>
  );
}

export function EditorTopBar({
  name,
  onRename,
  status,
  save,
  onRetry,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  errorCount,
  onShowIssues,
  previewOpen,
  onTogglePreview,
  primary,
  menuItems,
}: {
  name: string;
  onRename: (name: string) => void;
  status: FlowStatusValue;
  save: SaveIndicator;
  onRetry: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  errorCount: number;
  onShowIssues: () => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  primary: { label: string; busyLabel: string; busy: boolean; disabled: boolean; onClick: () => void };
  menuItems: MenuItem[];
}) {
  const badge = STATUS[status];
  // nokey: Backspace on a focused toolbar button never deletes the selected card.
  return (
    <div className="nokey pointer-events-none absolute inset-x-0 top-0 z-30 p-2 sm:p-3">
      <div className="pointer-events-auto flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-surface/80 px-2 shadow-[0_12px_32px_-18px_rgb(0_0_0/0.4)] backdrop-blur-2xl backdrop-saturate-150 sm:gap-3 sm:px-3 [@media(prefers-reduced-transparency:reduce)]:bg-surface">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
          <Link
            href="/flows"
            aria-label="Flows"
            className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:bg-surface-hover hover:text-foreground sm:min-h-9 ${PRESS}`}
          >
            <Icon.chevron className="h-4 w-4 rotate-90 sm:hidden" />
            <span className="hidden sm:inline">Flows</span>
          </Link>
          <span aria-hidden="true" className="hidden text-faint sm:inline">
            ›
          </span>
          <div className="min-w-0 text-[15px] font-semibold tracking-[-0.015em]">
            <InlineRename value={name} placeholder="Untitled flow" label="Flow name" maxLength={100} onCommit={(next) => onRename(next || "Untitled flow")} />
          </div>
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] max-sm:px-1 ${badge.className}`}>
            {badge.label}
          </span>
          <span className="shrink-0">
            <SaveState state={save} onRetry={onRetry} />
          </span>
        </nav>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* Phones get undo / redo in a floating pill at the bottom instead. */}
          <IconButton label="Undo (Cmd+Z)" disabled={!canUndo} onClick={onUndo} className="max-md:hidden">
            <UndoIcon />
          </IconButton>
          <IconButton label="Redo (Shift+Cmd+Z)" disabled={!canRedo} onClick={onRedo} className="max-md:hidden">
            <UndoIcon flip />
          </IconButton>
          {errorCount > 0 && (
            <button
              type="button"
              onClick={onShowIssues}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-error/30 px-2.5 text-xs font-medium text-error hover:bg-error/10 max-md:hidden ${PRESS}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {errorCount} {errorCount === 1 ? "problem" : "problems"}
            </button>
          )}
          <Button
            variant="ghost"
            onClick={onTogglePreview}
            aria-pressed={previewOpen}
            className={`max-sm:hidden ${previewOpen ? "bg-surface-hover text-foreground" : ""}`}
          >
            <Icon.message className="h-4 w-4" />
            Preview
          </Button>
          <IconButton label="Preview" onClick={onTogglePreview} aria-pressed={previewOpen} className="sm:hidden">
            <Icon.message className="h-4 w-4" />
          </IconButton>
          <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled || primary.busy}>
            {primary.busy ? primary.busyLabel : primary.label}
          </Button>
          <Menu
            align="right"
            width="w-56"
            items={menuItems}
            trigger={(props) => (
              <IconButton label="More flow actions" {...props}>
                <Icon.more className="h-4 w-4" />
              </IconButton>
            )}
          />
        </div>
      </div>
    </div>
  );
}
