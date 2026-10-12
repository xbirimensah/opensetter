"use client";

/**
 * What stands between this flow and going live, grouped by the trigger or
 * step it is about. Tapping a group opens that card.
 */

import { Icon } from "../icons";
import { Button, PRESS } from "../ui";
import { PanelHeader } from "./panel-parts";

export type IssueTarget = { kind: "node"; id: string } | { kind: "trigger"; id: string } | null;

export interface IssueGroup {
  key: string;
  title: string;
  target: IssueTarget;
  errors: string[];
  warnings: string[];
}

export function IssuesPanel({
  groups,
  live,
  dirty,
  busy,
  onOpen,
  onGoLive,
  onClose,
}: {
  groups: IssueGroup[];
  live: boolean;
  /** Live flows only publish when something changed. */
  dirty: boolean;
  busy: boolean;
  onOpen: (target: IssueTarget) => void;
  onGoLive: () => void;
  onClose: () => void;
}) {
  const errorCount = groups.reduce((sum, g) => sum + g.errors.length, 0);
  const warningCount = groups.reduce((sum, g) => sum + g.warnings.length, 0);
  const blocking = errorCount > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={
          <span
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              blocking ? "bg-error/10 text-error" : "bg-success/10 text-success"
            }`}
          >
            {blocking ? <Icon.close className="h-4 w-4" /> : <Icon.check className="h-4 w-4" />}
          </span>
        }
        eyebrow={blocking ? `${errorCount} ${errorCount === 1 ? "problem" : "problems"}` : "Checks passed"}
        title={<span className="text-foreground">{blocking ? (live ? "Fix these to publish" : "Fix these to go live") : live ? "Ready to publish" : "Ready to go live"}</span>}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {!blocking && (
          <div className="space-y-3 rounded-2xl border border-success/25 bg-success/5 p-3">
            <p className="text-sm text-foreground">
              {warningCount > 0
                ? "Nothing blocks this flow. The notes below are worth a look first."
                : "Nothing blocks this flow."}
            </p>
            <Button variant="primary" onClick={onGoLive} disabled={busy || (live && !dirty)}>
              {busy ? "Saving…" : live ? (dirty ? "Publish changes" : "Everything is published") : "Set Live"}
            </Button>
          </div>
        )}
        {groups.map((group) => (
          <section key={group.key} className="space-y-1.5 rounded-2xl border border-border bg-background/40 p-3">
            <button
              type="button"
              disabled={!group.target}
              onClick={() => onOpen(group.target)}
              className={`flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-foreground disabled:pointer-events-none ${PRESS}`}
            >
              <span className="min-w-0 truncate">{group.title}</span>
              {group.target && <Icon.chevron className="h-4 w-4 shrink-0 -rotate-90 text-faint" />}
            </button>
            <ul className="space-y-1">
              {group.errors.map((message, i) => (
                <li key={`e${i}`} className="flex gap-2 text-xs leading-relaxed text-error">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0 break-words">{message}</span>
                </li>
              ))}
              {group.warnings.map((message, i) => (
                <li key={`w${i}`} className="flex gap-2 text-xs leading-relaxed text-warning">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0 break-words">{message}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
