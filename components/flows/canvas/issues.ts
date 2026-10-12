/**
 * Live validation for the canvas editor: the same rules the API enforces
 * (graph, comment triggers, Flow.triggers), lint warnings, and the
 * database checks from the last load or save, bucketed by step and
 * trigger for the cards, the sidebar and the issues panel.
 */

import { isCommentTrigger, validateCommentTriggers } from "@/lib/flows/comment-triggers";
import type { EditorTrigger, FlowGraph, FlowTrigger } from "@/lib/flows/types";
import { describeEditorTrigger } from "@/lib/flows/trigger-summary";
import {
  lintFlow,
  nodeDisplayName,
  validateFlowGraph,
  validateFlowTriggers,
  type FlowIssue,
} from "@/lib/flows/validate";
import type { IssueGroup } from "./issues-panel";
import { stepTitle } from "./summaries";

export interface EditorIssues {
  errors: FlowIssue[];
  /** Errors the browser can check itself (block the Set Live button at once). */
  localErrors: FlowIssue[];
  warnings: FlowIssue[];
  byNode: Map<string, { errors: string[]; warnings: string[] }>;
  byTrigger: Map<string, { errors: string[]; warnings: string[] }>;
  general: { errors: string[]; warnings: string[] };
  errorCounts: Map<string, number>;
  warningCounts: Map<string, number>;
  triggerErrorIds: Set<string>;
  groups: IssueGroup[];
}

const TRIGGER_PREFIX = /^(Trigger \d+ \([^)]*\)|Comment trigger \d+): /;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Step 3 (Message): block 1 text is empty." -> "Block 1 text is empty." */
function stripPrefix(message: string, prefix: string | null): string {
  if (prefix && message.startsWith(`${prefix}: `)) return capitalize(message.slice(prefix.length + 2));
  const trigger = message.match(TRIGGER_PREFIX);
  return trigger ? capitalize(message.slice(trigger[0].length)) : message;
}

function dedupe(list: FlowIssue[]): FlowIssue[] {
  const seen = new Set<string>();
  return list.filter((issue) => {
    const key = `${issue.nodeId}|${issue.triggerId}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildEditorIssues(params: {
  graph: FlowGraph;
  triggers: EditorTrigger[];
  serverErrors: FlowIssue[];
  serverWarnings: FlowIssue[];
}): EditorIssues {
  const { graph, triggers } = params;
  const comments = triggers.filter(isCommentTrigger);
  const flowTriggers = triggers.filter((t): t is FlowTrigger => !isCommentTrigger(t));

  const localErrors = [...validateFlowGraph(graph), ...validateCommentTriggers(comments), ...validateFlowTriggers(flowTriggers)];
  const errors = dedupe([...localErrors, ...params.serverErrors.filter((s) => !localErrors.some((l) => l.message === s.message))]);
  const warnings = dedupe([...lintFlow(graph, { commentTriggered: comments.length > 0 }), ...params.serverWarnings]);

  const nodeLabels = new Map(graph.nodes.map((node, index) => [node.id, nodeDisplayName(node, index)] as const));
  const triggerIds = new Set(triggers.map((t) => t.id));
  const byNode = new Map<string, { errors: string[]; warnings: string[] }>();
  const byTrigger = new Map<string, { errors: string[]; warnings: string[] }>();
  const general = { errors: [] as string[], warnings: [] as string[] };

  const bucket = (map: Map<string, { errors: string[]; warnings: string[] }>, id: string) => {
    const entry = map.get(id) ?? { errors: [], warnings: [] };
    map.set(id, entry);
    return entry;
  };
  const place = (issue: FlowIssue, kind: "errors" | "warnings") => {
    if (issue.nodeId && nodeLabels.has(issue.nodeId)) {
      bucket(byNode, issue.nodeId)[kind].push(stripPrefix(issue.message, nodeLabels.get(issue.nodeId) as string));
    } else if (issue.triggerId && triggerIds.has(issue.triggerId)) {
      bucket(byTrigger, issue.triggerId)[kind].push(stripPrefix(issue.message, null));
    } else {
      general[kind].push(issue.message);
    }
  };
  errors.forEach((issue) => place(issue, "errors"));
  warnings.forEach((issue) => place(issue, "warnings"));

  const errorCounts = new Map([...byNode].map(([id, entry]) => [id, entry.errors.length] as const));
  const warningCounts = new Map([...byNode].map(([id, entry]) => [id, entry.warnings.length] as const));
  const triggerErrorIds = new Set([...byTrigger].filter(([, entry]) => entry.errors.length > 0).map(([id]) => id));

  const groups: IssueGroup[] = [];
  if (general.errors.length || general.warnings.length) {
    groups.push({ key: "general", title: "This flow", target: null, ...general });
  }
  for (const trigger of triggers) {
    const entry = byTrigger.get(trigger.id);
    if (!entry) continue;
    groups.push({
      key: `t:${trigger.id}`,
      title: describeEditorTrigger(trigger),
      target: { kind: "trigger", id: trigger.id },
      ...entry,
    });
  }
  for (const node of graph.nodes) {
    const entry = byNode.get(node.id);
    if (!entry) continue;
    groups.push({ key: `n:${node.id}`, title: stepTitle(node), target: { kind: "node", id: node.id }, ...entry });
  }
  // Blocking groups first.
  groups.sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0));

  return { errors, localErrors, warnings, byNode, byTrigger, general, errorCounts, warningCounts, triggerErrorIds, groups };
}
