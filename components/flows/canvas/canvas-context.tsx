"use client";

/**
 * What the canvas cards read without going through React Flow's node data:
 * lookups (media, flows, stats, issues) and the editor callbacks.
 */

import { createContext, useContext } from "react";
import type { EditorTrigger } from "@/lib/flows/types";
import type { MediaItem, NodeEventCounts } from "../api-types";

export interface CanvasContextValue {
  triggers: EditorTrigger[];
  /** Trigger ids with blocking errors. */
  triggerErrorIds: Set<string>;
  mediaById: Map<string, MediaItem>;
  flowNames: Map<string, string>;
  nodeStats: Record<string, NodeEventCounts> | null;
  /** Opens the trigger editor with the add menu open. */
  onAddTrigger: () => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error("useCanvas must be used inside the flow canvas");
  return value;
}
