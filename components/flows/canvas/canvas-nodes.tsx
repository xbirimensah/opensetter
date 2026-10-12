"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Canvas cards: the "When..." trigger card and one card per step. Cards
 * show a read-only preview of the step; every routed output (buttons,
 * quick replies, branches, "Next Step") ends in its own handle on the
 * right edge. Editing happens in the sidebar.
 */

import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect } from "react";
import type { FlowButton, FlowContent, FlowNode, MessageNode } from "@/lib/flows/types";
import { describeEditorTrigger } from "@/lib/flows/trigger-summary";
import { Icon, NODE_TINTS, NodeTypeIcon } from "../icons";
import { EASE } from "../ui";
import { useCanvas } from "./canvas-context";
import { nodeOutputs, TRIGGER_HANDLE, TRIGGER_NODE_ID } from "./model";
import { describeAction, describeDelay, describeRule, stepChannel, stepTitle } from "./summaries";

export interface StepNodeData extends Record<string, unknown> {
  node: FlowNode;
  isStart: boolean;
  errorCount: number;
  warningCount: number;
}

export type StepCanvasNode = Node<StepNodeData, "step">;
export type TriggerCanvasNode = Node<Record<string, never>, "trigger">;

/** Card edge padding; row handles sit on the card border. */
const PAD = 14;

const HANDLE_CLASS =
  "!h-3 !w-3 !min-h-0 !min-w-0 !rounded-full !border-2 !border-accent !bg-surface transition-[scale] duration-150 hover:!scale-125 before:absolute before:-inset-3 before:content-['']";

/** `inset`: distance from the row's right edge to the card border. */
function OutHandle({ id, inset = PAD }: { id: string; inset?: number }) {
  return <Handle type="source" position={Position.Right} id={id} className={HANDLE_CLASS} style={{ right: -(inset + 1) }} />;
}

/** Buttons inside a card preview sit deeper: body padding + card border + card padding. */
const CARD_BUTTON_INSET = PAD + 1 + 10;

function CardShell({
  selected,
  errorCount,
  children,
  dashed,
}: {
  selected: boolean;
  errorCount?: number;
  children: React.ReactNode;
  dashed?: boolean;
}) {
  const ring = selected
    ? "border-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_16%,transparent),0_12px_32px_-12px_rgb(0_0_0/0.35)]"
    : errorCount
      ? "border-error/60 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.3)]"
      : "border-border shadow-[0_8px_24px_-14px_rgb(0_0_0/0.3)] hover:border-border-hover";
  return (
    <div
      className={`relative w-[288px] rounded-2xl border bg-surface text-left transition-[border-color,box-shadow] duration-200 ${EASE} ${
        dashed ? "border-dashed" : ""
      } ${ring}`}
    >
      {children}
    </div>
  );
}

function CardHeader({ node, isStart, errorCount }: { node: FlowNode; isStart: boolean; errorCount: number }) {
  return (
    <header className="flex items-center gap-2.5 px-3.5 pt-3">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${NODE_TINTS[node.type]}`}>
        <NodeTypeIcon type={node.type} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{stepChannel(node)}</p>
        <p className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{stepTitle(node)}</p>
      </div>
      {isStart && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
          <Icon.flag className="h-3 w-3" />
          Start
        </span>
      )}
      {errorCount > 0 && (
        <span
          className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-error/15 px-1 text-[10px] font-semibold tabular-nums text-error"
          title={`${errorCount} ${errorCount === 1 ? "problem" : "problems"}`}
        >
          {errorCount}
        </span>
      )}
    </header>
  );
}

/** A labelled row ending in an output handle (Next Step, Yes, branch A, ...). */
function OutputRow({ handle, label, tone = "muted" }: { handle: string; label: string; tone?: "muted" | "accent" }) {
  return (
    <div
      className={`relative flex min-h-8 items-center justify-end rounded-lg px-2.5 text-[11px] font-medium ${
        tone === "accent" ? "text-accent" : "text-muted"
      }`}
    >
      {label}
      <OutHandle id={handle} />
    </div>
  );
}

function ButtonRow({ button, inset = PAD }: { button: FlowButton; inset?: number }) {
  const { flowNames } = useCanvas();
  const routed = button.type === "next";
  return (
    <div className="relative flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 text-[12px] font-medium text-accent">
      {button.type === "url" && <Icon.link className="h-3 w-3 shrink-0 opacity-70" />}
      {button.type === "flow" && <Icon.startFlow className="h-3 w-3 shrink-0 opacity-70" />}
      <span className="min-w-0 truncate">{button.title || (button.type === "url" ? "Open link" : "Button")}</span>
      {button.type === "flow" && (
        <span className="min-w-0 truncate text-[10px] font-normal text-faint">{flowNames.get(button.flowId) ?? "flow"}</span>
      )}
      {routed && <OutHandle id={`btn:${button.id}`} inset={inset} />}
    </div>
  );
}

function mediaUrl(content: { mediaId?: string; url?: string }, mediaById: Map<string, { url: string; filename: string }>) {
  const asset = content.mediaId ? mediaById.get(content.mediaId) : undefined;
  return { src: asset?.url ?? content.url ?? null, name: asset?.filename ?? (content.url ? content.url.split("/").pop() : null) };
}

function ContentPreview({ content }: { content: FlowContent }) {
  const { mediaById } = useCanvas();
  switch (content.type) {
    case "text":
      return (
        <div className="space-y-1.5">
          <div className="rounded-xl bg-surface-hover px-3 py-2 text-[12.5px] leading-snug text-foreground">
            <p className="line-clamp-5 whitespace-pre-wrap break-words">
              {content.text.trim() || <span className="text-faint">Empty text</span>}
            </p>
          </div>
          {(content.buttons ?? []).map((button) => (
            <ButtonRow key={button.id} button={button} />
          ))}
        </div>
      );
    case "image": {
      const { src } = mediaUrl(content, mediaById);
      return src ? (
        <img src={src} alt="" draggable={false} className="h-32 w-full rounded-xl border border-border object-cover" />
      ) : (
        <MediaStub icon={<Icon.image className="h-4 w-4" />} label="No image yet" />
      );
    }
    case "video":
    case "audio":
    case "file": {
      const { name } = mediaUrl(content, mediaById);
      const icon =
        content.type === "video" ? <Icon.video className="h-4 w-4" /> : content.type === "audio" ? <Icon.audio className="h-4 w-4" /> : <Icon.file className="h-4 w-4" />;
      const kind = content.type === "video" ? "Video" : content.type === "audio" ? "Voice message" : "PDF";
      return <MediaStub icon={icon} label={name ? `${kind} · ${name}` : `${kind}, no file yet`} />;
    }
    case "cards": {
      const [card, ...rest] = content.cards;
      if (!card) return <MediaStub icon={<Icon.cards className="h-4 w-4" />} label="No cards yet" />;
      const { src } = mediaUrl({ mediaId: card.imageMediaId, url: card.imageUrl }, mediaById);
      return (
        <div className="overflow-hidden rounded-xl border border-border">
          {src ? (
            <img src={src} alt="" draggable={false} className="h-24 w-full object-cover" />
          ) : (
            <div className="grid h-16 place-items-center bg-surface-hover text-faint">
              <Icon.image className="h-4 w-4" />
            </div>
          )}
          <div className="space-y-1.5 p-2.5">
            <p className="truncate text-[12px] font-semibold text-foreground">{card.title || "Card title"}</p>
            {card.subtitle && <p className="line-clamp-2 text-[11px] text-muted">{card.subtitle}</p>}
            {card.buttons.map((button) => (
              <ButtonRow key={button.id} button={button} inset={CARD_BUTTON_INSET} />
            ))}
            {rest.length > 0 && (
              <p className="text-[10px] text-faint">
                +{rest.length} more {rest.length === 1 ? "card" : "cards"}
                {rest.some((c) => c.buttons.some((b) => b.type === "next")) ? " (their buttons route from the sidebar)" : ""}
              </p>
            )}
          </div>
        </div>
      );
    }
    case "typing":
      return (
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-faint">
          <Icon.typing className="h-3.5 w-3.5" />
          Typing for {content.seconds}s
        </div>
      );
  }
}

function MediaStub({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-xl border border-dashed border-border px-3 text-[11.5px] text-muted">
      <span className="shrink-0 text-faint">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function MessageBody({ node }: { node: MessageNode }) {
  const hiddenCardButtons = node.contents.flatMap((c) =>
    c.type === "cards" ? c.cards.slice(1).flatMap((card) => card.buttons.filter((b) => b.type === "next")) : []
  );
  return (
    <>
      <div className="space-y-2">
        {node.contents.length === 0 && <MediaStub icon={<Icon.message className="h-4 w-4" />} label="No content yet" />}
        {node.contents.map((content) => (
          <ContentPreview key={content.id} content={content} />
        ))}
      </div>
      {/* Buttons on cards past the first still need a handle to keep their edges. */}
      {hiddenCardButtons.map((button) => (
        <OutputRow key={button.id} handle={`btn:${button.id}`} label={button.title || "Card button"} tone="accent" />
      ))}
      {(node.quickReplies ?? []).length > 0 && (
        <div className="space-y-1.5">
          {(node.quickReplies ?? []).map((reply) => (
            <div
              key={reply.id}
              className="relative flex min-h-8 items-center justify-center rounded-full border border-accent/40 px-3 text-[12px] font-medium text-accent"
            >
              <span className="min-w-0 truncate">{reply.title || "Quick reply"}</span>
              <OutHandle id={`qr:${reply.id}`} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatLine({ id, type }: { id: string; type: FlowNode["type"] }) {
  const { nodeStats } = useCanvas();
  const counts = nodeStats?.[id];
  if (!counts) return null;
  let text = "";
  if (type === "message" && counts.SENT > 0) {
    text = `${counts.SENT} sent${counts.CLICKED > 0 ? ` · ${counts.CLICKED} clicks` : ""}`;
  } else if (type === "input" && counts.INPUT_VALID + counts.INPUT_INVALID > 0) {
    text = `${counts.INPUT_VALID} captured${counts.INPUT_INVALID ? ` · ${counts.INPUT_INVALID} invalid` : ""}`;
  } else if (type === "condition" && counts.CONDITION_TRUE + counts.CONDITION_FALSE > 0) {
    text = `${counts.CONDITION_TRUE} yes · ${counts.CONDITION_FALSE} no`;
  }
  if (counts.SEND_FAILED > 0) text = `${text ? `${text} · ` : ""}${counts.SEND_FAILED} failed`;
  if (!text) return null;
  return <p className="px-1 text-[10.5px] tabular-nums text-faint">{text}</p>;
}

function StepBody({ node }: { node: FlowNode }) {
  const { flowNames } = useCanvas();
  switch (node.type) {
    case "message":
      return <MessageBody node={node} />;
    case "input":
      return (
        <div className="rounded-xl bg-surface-hover px-3 py-2 text-[12.5px] leading-snug text-foreground">
          <p className="line-clamp-4 whitespace-pre-wrap break-words">
            {node.prompt.trim() || <span className="text-faint">No question yet</span>}
          </p>
        </div>
      );
    case "condition":
      return (
        <ul className="space-y-1">
          <li className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">
            {node.match === "all" ? "All of these" : "Any of these"}
          </li>
          {node.rules.map((rule) => (
            <li key={rule.id} className="truncate rounded-lg bg-surface-hover px-2.5 py-1.5 text-[12px] text-foreground">
              {describeRule(rule)}
            </li>
          ))}
        </ul>
      );
    case "action":
      return (
        <ul className="space-y-1">
          {node.actions.map((action) => (
            <li key={action.id} className="truncate rounded-lg bg-surface-hover px-2.5 py-1.5 text-[12px] text-foreground">
              {describeAction(action)}
            </li>
          ))}
        </ul>
      );
    case "delay":
      return <p className="rounded-lg bg-surface-hover px-2.5 py-1.5 text-[12px] text-foreground">{describeDelay(node.seconds)}</p>;
    case "randomizer":
      return null;
    case "start_flow":
      return (
        <p className="truncate rounded-lg bg-surface-hover px-2.5 py-1.5 text-[12px] text-foreground">
          {node.flowId ? `Starts "${flowNames.get(node.flowId) ?? "a flow"}"` : "No flow chosen yet"}
        </p>
      );
    case "ai_handoff":
      return <p className="px-1 text-[12px] text-muted">The AI setter takes over the conversation.</p>;
  }
}

/** Output rows other than message buttons and quick replies (those render inline). */
function TrailingOutputs({ node }: { node: FlowNode }) {
  const outputs = nodeOutputs(node).filter((o) => !o.handle.startsWith("btn:") && !o.handle.startsWith("qr:"));
  if (outputs.length === 0) return null;
  return (
    <div className="space-y-0.5 border-t border-border/70 px-1.5 pb-1.5 pt-1" style={{ marginInline: PAD - 6 }}>
      {outputs.map((output) => (
        <OutputRow key={output.handle} handle={output.handle} label={output.label} />
      ))}
    </div>
  );
}

function handleSignature(node: FlowNode): string {
  return nodeOutputs(node)
    .map((o) => o.handle)
    .join("|");
}

export const StepNodeView = memo(function StepNodeView({ id, data, selected }: NodeProps<StepCanvasNode>) {
  const { node, isStart, errorCount } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const signature = handleSignature(node);
  // Handles appear and disappear with buttons; re-measure them.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, signature, updateNodeInternals]);

  return (
    <CardShell selected={Boolean(selected)} errorCount={errorCount}>
      <Handle
        type="target"
        position={Position.Left}
        className={`${HANDLE_CLASS} !border-border-hover`}
        style={{ top: 26 }}
        isConnectableStart={false}
      />
      <CardHeader node={node} isStart={isStart} errorCount={errorCount} />
      <div className="space-y-2 px-3.5 pb-3 pt-2.5">
        <StepBody node={node} />
        <StatLine id={id} type={node.type} />
      </div>
      <TrailingOutputs node={node} />
    </CardShell>
  );
});

export const TriggerNodeView = memo(function TriggerNodeView({ selected }: NodeProps<TriggerCanvasNode>) {
  const { triggers, triggerErrorIds, onAddTrigger } = useCanvas();
  return (
    <CardShell selected={Boolean(selected)} errorCount={triggers.some((t) => triggerErrorIds.has(t.id)) ? 1 : 0}>
      <header className="flex items-center gap-2.5 px-3.5 pt-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <Icon.bolt className="h-3.5 w-3.5" />
        </span>
        <p className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">When...</p>
      </header>
      <div className="space-y-2 px-3.5 pb-3 pt-2.5">
        {triggers.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            A Trigger is an event that starts your Automation. Click to add a Trigger.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {triggers.map((trigger) => (
              <li
                key={trigger.id}
                className={`flex items-start gap-2 rounded-lg bg-surface-hover px-2.5 py-2 text-[12px] leading-snug text-foreground ${
                  trigger.type === "new_follower" ? "opacity-60" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${triggerErrorIds.has(trigger.id) ? "bg-error" : "bg-accent"}`}
                />
                <span className="min-w-0 break-words">{describeEditorTrigger(trigger)}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddTrigger();
          }}
          className="nodrag flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-hover text-[12px] font-medium text-accent transition-[background-color,scale] duration-150 hover:bg-accent/5 active:scale-[0.98] active:duration-75"
        >
          <Icon.plus className="h-3.5 w-3.5" />
          New Trigger
        </button>
      </div>
      <div className="border-t border-border/70 px-1.5 pb-1.5 pt-1" style={{ marginInline: PAD - 6 }}>
        <OutputRow handle={TRIGGER_HANDLE} label="Then" />
      </div>
    </CardShell>
  );
});

export const NODE_TYPES = { step: StepNodeView, trigger: TriggerNodeView };

export { TRIGGER_NODE_ID };
