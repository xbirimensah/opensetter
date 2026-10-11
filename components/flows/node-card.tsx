"use client";

/**
 * One step of the flow as a card: type icon, editable name, start marker,
 * stats chips, menu (start, duplicate, move, delete), the type's editor and
 * the errors and warnings that belong to it.
 */

import type { FlowNode } from "@/lib/flows/types";
import { FLOW_EDITOR_LIMITS, NODE_TYPE_LABELS } from "@/lib/flows/validate";
import { ActionEditor } from "./action-editor";
import type { NodeEventCounts } from "./api-types";
import { useFlowEditor } from "./editor-context";
import { formatDuration } from "./graph-utils";
import { Icon, NODE_TINTS, NodeTypeIcon } from "./icons";
import { MessageEditor } from "./message-editor";
import {
  AiHandoffEditor,
  ConditionEditor,
  DelayEditor,
  InputEditor,
  RandomizerEditor,
  StartFlowEditor,
} from "./step-editors";
import { Collapse, EASE, IconButton, IssueList, Menu } from "./ui";

function StatChips({ node, counts }: { node: FlowNode; counts: NodeEventCounts | undefined }) {
  if (!counts) return null;
  const chips: { label: string; tone?: string }[] = [];
  if (node.type === "message") {
    chips.push({ label: `${counts.SENT} sent` });
    if (counts.CLICKED > 0 || counts.SENT > 0) {
      chips.push({ label: `${counts.CLICKED} clicks` });
      chips.push({ label: `${counts.SENT > 0 ? Math.round((counts.CLICKED / counts.SENT) * 100) : 0}% CTR` });
    }
    if (counts.REPLIED > 0) chips.push({ label: `${counts.REPLIED} replies` });
  } else if (node.type === "input") {
    chips.push({ label: `${counts.INPUT_VALID} captured`, tone: "text-success" });
    if (counts.INPUT_INVALID > 0) chips.push({ label: `${counts.INPUT_INVALID} invalid` });
  } else if (node.type === "condition") {
    chips.push({ label: `${counts.CONDITION_TRUE} yes` }, { label: `${counts.CONDITION_FALSE} no` });
  }
  if (counts.SEND_FAILED > 0) chips.push({ label: `${counts.SEND_FAILED} failed`, tone: "text-error" });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums ${chip.tone ?? "text-muted"}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

/** One-line summary shown while the card is collapsed. */
function summary(node: FlowNode): string {
  switch (node.type) {
    case "message": {
      const first = node.contents[0];
      if (!first) return "Empty message";
      if (first.type === "text") return first.text.trim() || "Empty text";
      return `${node.contents.length} block${node.contents.length === 1 ? "" : "s"}`;
    }
    case "input":
      return node.prompt.trim() || "No question yet";
    case "condition":
      return `${node.rules.length} rule${node.rules.length === 1 ? "" : "s"}, ${node.match === "all" ? "all must match" : "any can match"}`;
    case "action":
      return `${node.actions.length} action${node.actions.length === 1 ? "" : "s"}`;
    case "delay":
      return `Wait ${formatDuration(node.seconds)}`;
    case "randomizer":
      return `${node.branches.length} branches`;
    case "start_flow":
      return node.flowId ? "Starts another flow" : "No flow chosen";
    case "ai_handoff":
      return "AI setter takes over";
  }
}

export function NodeCard({
  node,
  index,
  count,
  isStart,
  selected,
  collapsed,
  errors,
  warnings,
  onChange,
  onSelect,
  onToggleCollapsed,
  onSetStart,
  onDuplicate,
  onMove,
  onDelete,
}: {
  node: FlowNode;
  index: number;
  count: number;
  isStart: boolean;
  selected: boolean;
  collapsed: boolean;
  errors: string[];
  warnings: string[];
  onChange: (node: FlowNode) => void;
  onSelect: () => void;
  onToggleCollapsed: () => void;
  onSetStart: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { stats } = useFlowEditor();
  const counts = stats?.nodes[node.id];
  const typeLabel = NODE_TYPE_LABELS[node.type];

  return (
    <article
      id={`flow-node-${node.id}`}
      aria-label={`Step ${index + 1}, ${node.name || typeLabel}`}
      onPointerDownCapture={onSelect}
      onFocusCapture={onSelect}
      className={`scroll-mt-24 rounded-2xl border bg-surface transition-[border-color,box-shadow] duration-200 ${EASE} ${
        selected ? "border-accent/50 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]" : "border-border"
      } ${errors.length > 0 ? "border-l-error/60" : ""}`}
    >
      <header className="flex items-start gap-3 px-4 py-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${NODE_TINTS[node.type]}`}>
          <NodeTypeIcon type={node.type} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              {index + 1}. {typeLabel}
            </span>
            {isStart && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                <Icon.flag className="h-3 w-3" />
                Start
              </span>
            )}
            {errors.length > 0 && (
              <span className="rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-medium text-error">
                {errors.length} {errors.length === 1 ? "error" : "errors"}
              </span>
            )}
          </div>
          <input
            value={node.name ?? ""}
            maxLength={FLOW_EDITOR_LIMITS.nameMax}
            placeholder={`Name this ${typeLabel.toLowerCase()} step`}
            aria-label="Step name"
            onChange={(e) => onChange({ ...node, name: e.target.value || undefined })}
            className="-mx-1.5 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold tracking-tight text-foreground placeholder:font-normal placeholder:text-faint hover:border-border focus:border-accent/40 focus:outline-none sm:text-sm"
          />
          {collapsed ? (
            <p className="truncate text-xs text-muted">{summary(node)}</p>
          ) : (
            <StatChips node={node} counts={counts} />
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <Menu
            align="right"
            items={[
              { label: "Set as start step", disabled: isStart, onSelect: onSetStart, icon: <Icon.flag className="h-4 w-4" /> },
              { label: "Duplicate", onSelect: onDuplicate, icon: <Icon.copy className="h-4 w-4" /> },
              { label: "Move up", disabled: index === 0, onSelect: () => onMove(-1), icon: <Icon.up className="h-4 w-4" /> },
              { label: "Move down", disabled: index === count - 1, onSelect: () => onMove(1), icon: <Icon.down className="h-4 w-4" /> },
              {
                label: "Delete step",
                tone: "danger",
                hint: "Steps that lead here will end the flow instead.",
                onSelect: onDelete,
                icon: <Icon.trash className="h-4 w-4" />,
              },
            ]}
            trigger={(props) => (
              <IconButton label="Step actions" {...props}>
                <Icon.more className="h-4 w-4" />
              </IconButton>
            )}
          />
          <IconButton label={collapsed ? "Expand step" : "Collapse step"} aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            <Icon.chevron className={`h-4 w-4 transition-transform duration-300 ${EASE} ${collapsed ? "-rotate-90" : ""}`} />
          </IconButton>
        </div>
      </header>

      <Collapse open={!collapsed}>
        <div className="space-y-4 border-t border-border px-4 py-4">
          <StepBody node={node} onChange={onChange} />
          <IssueList errors={errors} warnings={warnings} />
        </div>
      </Collapse>
      {collapsed && (errors.length > 0 || warnings.length > 0) && (
        <div className="px-4 pb-3">
          <IssueList errors={errors} warnings={warnings} />
        </div>
      )}
    </article>
  );
}

function StepBody({ node, onChange }: { node: FlowNode; onChange: (node: FlowNode) => void }) {
  switch (node.type) {
    case "message":
      return <MessageEditor node={node} onChange={onChange} />;
    case "input":
      return <InputEditor node={node} onChange={onChange} />;
    case "condition":
      return <ConditionEditor node={node} onChange={onChange} />;
    case "action":
      return <ActionEditor node={node} onChange={onChange} />;
    case "delay":
      return <DelayEditor node={node} onChange={onChange} />;
    case "randomizer":
      return <RandomizerEditor node={node} onChange={onChange} />;
    case "start_flow":
      return <StartFlowEditor node={node} onChange={onChange} />;
    case "ai_handoff":
      return <AiHandoffEditor node={node} />;
  }
}
