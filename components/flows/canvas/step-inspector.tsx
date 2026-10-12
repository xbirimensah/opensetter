"use client";

/**
 * Sidebar editor for the selected step: title with rename, the 24h window
 * line, the step's existing editor (message, input, condition, ...), the
 * block palette for messages, the next-step pickers, issues and stats.
 */

import type { FlowContent, FlowNode } from "@/lib/flows/types";
import { NODE_TYPE_LABELS } from "@/lib/flows/validate";
import { ActionEditor } from "../action-editor";
import type { NodeEventCounts } from "../api-types";
import { ContentTypeIcon, Icon, NODE_TINTS, NodeTypeIcon } from "../icons";
import { MessageEditor } from "../message-editor";
import {
  AiHandoffEditor,
  ConditionEditor,
  DelayEditor,
  InputEditor,
  RandomizerEditor,
  StartFlowEditor,
} from "../step-editors";
import { IconButton, IssueList, Menu, PRESS } from "../ui";
import { useFlowEditor } from "../editor-context";
import { VariablesPanel } from "../variables-panel";
import { InlineRename, PanelHeader, WindowNote } from "./panel-parts";
import { STEP_GROUPS, type StepPreset } from "./step-type-menu";
import { defaultStepTitle, stepChannel } from "./summaries";

const PALETTE: { type: FlowContent["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "video", label: "Video" },
  { type: "audio", label: "Audio" },
  { type: "file", label: "PDF" },
  { type: "cards", label: "Cards" },
  { type: "typing", label: "Delay" },
];

const TILE = `flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background/50 px-1 text-[11px] font-medium text-foreground hover:border-border-hover hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40 ${PRESS}`;

function BlockPalette({
  add,
  full,
  onAddAfter,
}: {
  add: (type: FlowContent["type"]) => void;
  full: boolean;
  onAddAfter: (preset: StepPreset) => void;
}) {
  const dataItems = STEP_GROUPS.find((g) => g.title === "Data Collection")?.items ?? [];
  const moreItems = STEP_GROUPS.filter((g) => g.title === "Logic" || g.title === "Actions").flatMap((g) => g.items);
  return (
    <section aria-label="Add a content block" className="space-y-2 rounded-2xl border border-dashed border-border p-3">
      <p className="text-xs text-muted">Add one of the content blocks:</p>
      <div className="grid grid-cols-3 gap-2">
        {PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            disabled={full}
            onClick={() => add(item.type)}
            className={TILE}
            title={item.type === "typing" ? "Typing pause between blocks, up to 20 seconds" : undefined}
          >
            <ContentTypeIcon type={item.type} className="h-4 w-4 text-accent" />
            {item.label}
          </button>
        ))}
        <Menu
          width="w-60"
          items={dataItems.map((item) => ({
            label: item.label,
            hint: `${item.hint}, as the next step`,
            onSelect: () => onAddAfter(item.preset),
          }))}
          trigger={(props) => (
            <button type="button" {...props} className={`${TILE} w-full`}>
              <Icon.input className="h-4 w-4 text-success" />
              Data Collection
            </button>
          )}
        />
        <Menu
          align="right"
          width="w-60"
          items={moreItems.map((item) => ({
            label: item.label,
            hint: `${item.hint}, as the next step`,
            onSelect: () => onAddAfter(item.preset),
          }))}
          trigger={(props) => (
            <button type="button" {...props} className={`${TILE} w-full`}>
              <Icon.more className="h-4 w-4 text-muted" />
              More
            </button>
          )}
        />
      </div>
      {full && <p className="text-[11px] text-faint">This message has the most blocks Instagram allows in one step.</p>}
    </section>
  );
}

function StatChips({ node, counts }: { node: FlowNode; counts: NodeEventCounts | undefined }) {
  if (!counts) return null;
  const chips: string[] = [];
  if (node.type === "message") {
    chips.push(`${counts.SENT} sent`, `${counts.CLICKED} clicks`);
    if (counts.SENT > 0) chips.push(`${Math.round((counts.CLICKED / counts.SENT) * 100)}% CTR`);
    if (counts.REPLIED > 0) chips.push(`${counts.REPLIED} replies`);
  } else if (node.type === "input") {
    chips.push(`${counts.INPUT_VALID} captured`, `${counts.INPUT_INVALID} invalid`);
  } else if (node.type === "condition") {
    chips.push(`${counts.CONDITION_TRUE} yes`, `${counts.CONDITION_FALSE} no`);
  }
  if (counts.SEND_FAILED > 0) chips.push(`${counts.SEND_FAILED} failed`);
  if (chips.length === 0) return null;
  return (
    <section aria-label="Step stats" className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip} className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {chip}
        </span>
      ))}
    </section>
  );
}

function StepBody({ node, onChange, onAddAfter }: { node: FlowNode; onChange: (node: FlowNode) => void; onAddAfter: (preset: StepPreset) => void }) {
  switch (node.type) {
    case "message":
      return (
        <MessageEditor
          node={node}
          onChange={onChange}
          palette={(add, full) => <BlockPalette add={add} full={full} onAddAfter={onAddAfter} />}
        />
      );
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

function Variables() {
  const { fieldNames } = useFlowEditor();
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden">
        <Icon.braces className="h-3.5 w-3.5" />
        Variables you can use
        <Icon.chevron className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="pt-2">
        <VariablesPanel fieldNames={fieldNames} />
      </div>
    </details>
  );
}

export function StepInspector({
  node,
  isStart,
  privateReply,
  errors,
  warnings,
  counts,
  onChange,
  onClose,
  onDuplicate,
  onDelete,
  onSetStart,
  onAddAfter,
}: {
  node: FlowNode;
  isStart: boolean;
  /** Start step of a comment-triggered flow: its first block is the private reply. */
  privateReply: boolean;
  errors: string[];
  warnings: string[];
  counts: NodeEventCounts | undefined;
  onChange: (node: FlowNode) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetStart: () => void;
  onAddAfter: (preset: StepPreset) => void;
}) {
  const sends = node.type === "message" || node.type === "input";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={
          <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${NODE_TINTS[node.type]}`}>
            <NodeTypeIcon type={node.type} />
          </span>
        }
        eyebrow={`${stepChannel(node)} · ${NODE_TYPE_LABELS[node.type]}`}
        title={
          <InlineRename
            value={node.name ?? ""}
            placeholder={defaultStepTitle(node)}
            label="Step name"
            onCommit={(name) => onChange({ ...node, name: name || undefined })}
          />
        }
        onClose={onClose}
        actions={
          <Menu
            align="right"
            width="w-52"
            items={[
              { label: "Set as start step", disabled: isStart, onSelect: onSetStart, icon: <Icon.flag className="h-4 w-4" /> },
              { label: "Duplicate", onSelect: onDuplicate, icon: <Icon.copy className="h-4 w-4" /> },
              {
                label: "Delete step",
                tone: "danger",
                hint: "Connections into it end the flow instead.",
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
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {sends && <WindowNote privateReply={privateReply} />}
        {isStart && !sends && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Icon.flag className="h-3.5 w-3.5" />
            The flow starts here
          </p>
        )}
        <IssueList errors={errors} warnings={warnings} />
        <StepBody node={node} onChange={onChange} onAddAfter={onAddAfter} />
        <StatChips node={node} counts={counts} />
        {sends && <Variables />}
      </div>
    </div>
  );
}
