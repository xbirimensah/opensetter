"use client";

/**
 * Sidebar editor for the "When..." card: every trigger of the flow, the
 * comment triggers (Automation rows) first, plus "+ New Trigger".
 */

import { useState } from "react";
import { COMMENT_TRIGGER_LABEL, COMMENT_TRIGGER_LIMITS, createCommentTrigger } from "@/lib/flows/comment-triggers";
import { describeEditorTrigger } from "@/lib/flows/trigger-summary";
import type { CommentTrigger, EditorTrigger, EditorTriggerType, FlowTrigger } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, TRIGGER_TYPE_LABELS } from "@/lib/flows/validate";
import { createTrigger, newId } from "../graph-utils";
import { Icon } from "../icons";
import { NEW_FOLLOWER_NOTE, SINGLETONS, TRIGGER_HINTS, TRIGGER_ORDER, TriggerFields } from "../triggers-panel";
import { Collapse, EASE, IconButton, IssueList, Popover, PRESS } from "../ui";
import { CommentTriggerEditor } from "./comment-trigger-editor";
import { PanelHeader } from "./panel-parts";

function label(type: EditorTriggerType): string {
  return type === "comment" ? COMMENT_TRIGGER_LABEL : TRIGGER_TYPE_LABELS[type];
}

const MENU: { type: EditorTriggerType; hint: string }[] = [
  { type: "comment", hint: "They comment on your post or reel" },
  ...TRIGGER_ORDER.map((type) => ({ type, hint: TRIGGER_HINTS[type] })),
];

function NewTriggerMenu({
  triggers,
  open,
  onOpenChange,
  onAdd,
}: {
  triggers: EditorTrigger[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: EditorTriggerType) => void;
}) {
  const present = new Set(triggers.map((t) => t.type));
  const comments = triggers.filter((t) => t.type === "comment").length;
  const full = triggers.length >= FLOW_EDITOR_LIMITS.triggersMax;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          disabled={full}
          className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-hover text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50 ${PRESS}`}
        >
          <Icon.plus className="h-4 w-4" />
          New Trigger
        </button>
      )}
    >
      <div
        ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
        className="max-h-[60vh] w-[min(20rem,80vw)] overflow-y-auto py-1"
      >
        {MENU.map((item) => {
          const unavailable = item.type === "new_follower";
          const disabled =
            unavailable ||
            (item.type === "comment" && comments >= COMMENT_TRIGGER_LIMITS.perFlowMax) ||
            (item.type !== "comment" && SINGLETONS.includes(item.type) && present.has(item.type));
          return (
            <button
              key={item.type}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                onOpenChange(false);
                onAdd(item.type);
              }}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-hover disabled:pointer-events-none"
            >
              <span
                className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                  disabled ? "bg-muted/10 text-faint" : "bg-accent/10 text-accent"
                }`}
              >
                {item.type === "comment" ? <Icon.message className="h-3.5 w-3.5" /> : <Icon.bolt className="h-3.5 w-3.5" />}
              </span>
              <span className={`min-w-0 ${disabled ? "opacity-60" : ""}`}>
                <span className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                  {label(item.type)}
                  {unavailable && (
                    <span className="rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] font-medium text-muted">Meta partners only</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  {unavailable ? NEW_FOLLOWER_NOTE : item.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

export function TriggerInspector({
  triggers,
  username,
  instagramAccountId,
  startLabel,
  issuesByTrigger,
  expandedId,
  addMenuOpen,
  onAddMenuOpenChange,
  onExpand,
  onChange,
  automationIdOf,
  onClose,
}: {
  triggers: EditorTrigger[];
  username: string;
  instagramAccountId: string;
  /** Title of the step the flow starts with. */
  startLabel: string | null;
  issuesByTrigger: Map<string, { errors: string[]; warnings: string[] }>;
  expandedId: string | null;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
  onExpand: (id: string | null) => void;
  onChange: (triggers: EditorTrigger[], key: string | null) => void;
  automationIdOf: (trigger: CommentTrigger) => string | null;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  function add(type: EditorTriggerType) {
    const trigger: EditorTrigger = type === "comment" ? createCommentTrigger(newId("t")) : createTrigger(type);
    // Comment triggers lead the list, as the API returns them.
    const next =
      type === "comment"
        ? [...triggers.filter((t) => t.type === "comment"), trigger, ...triggers.filter((t) => t.type !== "comment")]
        : [...triggers, trigger];
    onChange(next, null);
    onExpand(trigger.id);
  }

  function remove(trigger: EditorTrigger) {
    if (trigger.type === "comment" && automationIdOf(trigger) && confirming !== trigger.id) {
      setConfirming(trigger.id);
      return;
    }
    setConfirming(null);
    onChange(
      triggers.filter((t) => t.id !== trigger.id),
      null
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <Icon.bolt className="h-4 w-4" />
          </span>
        }
        eyebrow="Triggers"
        title={<span className="text-foreground">When...</span>}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        <p className="text-xs leading-relaxed text-muted">
          A Trigger is an event that starts your Automation. Any of these starts the flow
          {startLabel ? (
            <>
              {" "}
              at <span className="font-medium text-foreground">{startLabel}</span>.
            </>
          ) : (
            ". Connect Then to the first step."
          )}
        </p>

        {triggers.map((trigger) => {
          const open = expandedId === trigger.id;
          const issues = issuesByTrigger.get(trigger.id);
          const disabled = trigger.type === "new_follower";
          return (
            <article
              key={trigger.id}
              className={`overflow-hidden rounded-2xl border bg-background/40 transition-[border-color] duration-200 ${EASE} ${
                open ? "border-accent/40" : issues?.errors.length ? "border-error/40" : "border-border"
              }`}
            >
              <header className="flex items-start gap-2 p-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onExpand(open ? null : trigger.id)}
                  className={`flex min-w-0 flex-1 items-start gap-2.5 text-left ${PRESS}`}
                >
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${disabled ? "bg-muted/10 text-faint" : "bg-accent/10 text-accent"}`}>
                    {trigger.type === "comment" ? <Icon.message className="h-3.5 w-3.5" /> : <Icon.bolt className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{label(trigger.type)}</span>
                    <span className="block text-xs leading-snug text-muted">
                      {disabled ? "Not available yet" : describeEditorTrigger(trigger)}
                    </span>
                  </span>
                </button>
                {issues?.errors.length ? (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-error" aria-label="Has problems" />
                ) : null}
                <IconButton label="Remove trigger" tone="danger" onClick={() => remove(trigger)}>
                  <Icon.trash className="h-3.5 w-3.5" />
                </IconButton>
              </header>
              {confirming === trigger.id && (
                <div className="mx-3 mb-3 space-y-2 rounded-xl border border-error/30 bg-error/5 p-3 text-xs text-foreground">
                  <p>Removing this comment trigger deletes its send history and stats when the flow saves. Undo brings the trigger back, not the history.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => remove(trigger)} className={`rounded-lg bg-error px-3 py-1.5 font-medium text-white ${PRESS}`}>
                      Remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={`rounded-lg px-3 py-1.5 text-muted hover:bg-surface-hover ${PRESS}`}>
                      Keep it
                    </button>
                  </div>
                </div>
              )}
              <Collapse open={open}>
                <div className="space-y-3 border-t border-border/70 p-3">
                  {trigger.type === "comment" ? (
                    <CommentTriggerEditor
                      trigger={trigger}
                      instagramAccountId={instagramAccountId}
                      automationId={automationIdOf(trigger)}
                      onChange={(next) => onChange(triggers.map((t) => (t.id === trigger.id ? next : t)), `trigger:${trigger.id}`)}
                    />
                  ) : (
                    <TriggerFields
                      trigger={trigger as FlowTrigger}
                      username={username}
                      onChange={(next) => onChange(triggers.map((t) => (t.id === trigger.id ? next : t)), `trigger:${trigger.id}`)}
                    />
                  )}
                </div>
              </Collapse>
              {issues && (issues.errors.length > 0 || issues.warnings.length > 0) && (
                <div className="px-3 pb-3">
                  <IssueList errors={issues.errors} warnings={issues.warnings} />
                </div>
              )}
            </article>
          );
        })}

        <NewTriggerMenu triggers={triggers} open={addMenuOpen} onOpenChange={onAddMenuOpenChange} onAdd={add} />
      </div>
    </div>
  );
}
