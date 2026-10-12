/**
 * The editor's draft (name + graph + triggers) and its undo/redo history.
 * Pure functions, so the coalescing rules are unit-tested.
 *
 * Coalescing: consecutive changes with the same key (typing in one field,
 * dragging one card) inside `windowMs` of the previous change become one
 * undo step, so undo jumps back over a whole edit, not one keystroke.
 */

import type { EditorTrigger, FlowGraph } from "@/lib/flows/types";

export interface Draft {
  name: string;
  graph: FlowGraph;
  triggers: EditorTrigger[];
}

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 900;

export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function historyCommit<T>(
  history: History<T>,
  next: T,
  key: string | null = null,
  now: number = Date.now(),
  windowMs: number = COALESCE_MS
): History<T> {
  if (Object.is(next, history.present)) return history;
  const coalesce = key !== null && key === history.lastKey && now - history.lastAt < windowMs;
  const past = coalesce ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function historyUndo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function historyRedo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

/** Replaces the present without an undo step (server refreshes, layout fixes). */
export function historyReplace<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next, lastKey: null };
}

/** Stable string of what a save would store; dirty = differs from the last saved one. */
export function draftSnapshot(draft: Draft): string {
  return JSON.stringify({ name: draft.name.trim() || "Untitled flow", graph: draft.graph, triggers: draft.triggers });
}
