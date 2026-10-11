"use client";

/**
 * Shared editor state the step editors read without prop drilling: the
 * step list for routing pickers, sibling flows, the media library, stats
 * and the variables the text fields offer.
 */

import { createContext, useContext } from "react";
import type { FlowNodeType } from "@/lib/flows/types";
import type { FlowStats, FlowStatusValue, MediaItem } from "./api-types";

export interface FlowEditorContextValue {
  flowId: string;
  steps: { id: string; label: string }[];
  /** Appends a new step (after `afterId`) and returns its id. */
  createStep: (type: FlowNodeType, afterId?: string) => string;
  /** Flows on the same Instagram account, this one included. */
  flows: { id: string; name: string; status: FlowStatusValue }[];
  media: MediaItem[];
  mediaById: Map<string, MediaItem>;
  uploadMedia: (file: File) => Promise<MediaItem>;
  /** Tokens for the insert-variable menus. */
  variables: string[];
  fieldNames: string[];
  tags: string[];
  stats: FlowStats | null;
  username: string;
}

export const FlowEditorContext = createContext<FlowEditorContextValue | null>(null);

export function useFlowEditor(): FlowEditorContextValue {
  const value = useContext(FlowEditorContext);
  if (!value) throw new Error("useFlowEditor must be used inside the flow editor");
  return value;
}
