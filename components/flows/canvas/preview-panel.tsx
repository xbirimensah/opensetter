"use client";

/**
 * Phone preview of one message or question, floating on the right (or
 * full screen on a phone). Follows the selected step; a picker switches
 * between the steps that send something.
 */

import type { FlowNode } from "@/lib/flows/types";
import type { MediaItem } from "../api-types";
import { FlowPreview } from "../flow-preview";
import { Icon } from "../icons";
import { EASE, IconButton, Select } from "../ui";
import { stepTitle } from "./summaries";

export function PreviewPanel({
  open,
  top,
  phone,
  nodes,
  nodeId,
  username,
  mediaById,
  onPick,
  onClose,
}: {
  open: boolean;
  top: number;
  phone: boolean;
  nodes: FlowNode[];
  nodeId: string | null;
  username: string;
  mediaById: Map<string, MediaItem>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const sendable = nodes.filter((n) => n.type === "message" || n.type === "input");
  const node = sendable.find((n) => n.id === nodeId) ?? sendable[0];
  return (
    <aside
      aria-label="Preview"
      aria-hidden={!open}
      inert={!open}
      className={`nokey absolute z-30 flex flex-col overflow-hidden border border-border bg-surface/90 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] backdrop-blur-2xl backdrop-saturate-150 transition-[translate,opacity] duration-300 ${EASE} motion-reduce:transition-opacity [@media(prefers-reduced-transparency:reduce)]:bg-surface ${
        phone ? "inset-0 rounded-none" : "bottom-3 right-3 w-[352px] rounded-2xl"
      } ${open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0 motion-reduce:translate-x-0"}`}
      style={phone ? undefined : { top }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
        <Icon.message className="h-4 w-4 text-muted" />
        <p className="flex-1 text-sm font-semibold tracking-[-0.01em] text-foreground">Preview</p>
        <IconButton label="Close preview" onClick={onClose}>
          <Icon.close className="h-4 w-4" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {sendable.length > 1 && (
          <Select label="Step" value={node?.id ?? ""} onChange={onPick}>
            {sendable.map((n) => (
              <option key={n.id} value={n.id}>
                {stepTitle(n)}
              </option>
            ))}
          </Select>
        )}
        <FlowPreview node={node} username={username} mediaById={mediaById} />
        <p className="text-center text-[11px] text-faint">Sample values fill in the variables.</p>
      </div>
    </aside>
  );
}
