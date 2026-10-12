/**
 * Response shapes of /api/flows, /api/flows/:id, /api/flows/:id/stats and
 * /api/media as the editor and list page read them.
 */

import type { CommentTrigger, EditorTrigger } from "@/lib/flows/types";
import type { FlowIssue, MediaAssetKind } from "@/lib/flows/validate";

export type FlowStatusValue = "DRAFT" | "ACTIVE" | "PAUSED";

/** A comment trigger's Automation row (stats live at /campaigns/:id). */
export interface FlowCampaignRef {
  id: string;
  name: string;
  isActive: boolean;
}

export interface FlowListItem {
  id: string;
  name: string;
  status: FlowStatusValue;
  instagramAccountId: string;
  instagramAccount: { id: string; username: string };
  /** Comment triggers first, then Flow.triggers. */
  triggers: EditorTrigger[];
  nodeCount: number;
  firstText: string | null;
  automations: FlowCampaignRef[];
  activeRuns: number;
  totalRuns: number;
  /** Private replies sent by its comment triggers. */
  sends: number;
  createdAt: string;
  updatedAt: string;
}

/** A comment campaign without a flow (the classic DM pipeline). */
export interface ClassicCampaignItem {
  id: string;
  name: string;
  isActive: boolean;
  instagramAccountId: string;
  instagramAccount: { id: string; username: string };
  trigger: CommentTrigger;
  dmMessage: string;
  sends: number;
  updatedAt: string;
}

export interface FlowAccount {
  id: string;
  username: string;
  instagramId: string;
  name?: string | null;
}

export interface FlowDetail {
  id: string;
  name: string;
  status: FlowStatusValue;
  instagramAccountId: string;
  instagramAccount: { id: string; username: string; name: string | null };
  /** Raw stored JSON; the editor shape-parses it before use. */
  graph: unknown;
  /** Comment triggers (from Automation rows) merged with Flow.triggers. */
  triggers: unknown;
  automations: FlowCampaignRef[];
  /** automationId -> row version, sent back on save. */
  triggerVersions: Record<string, string>;
  activeRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowValidationPayload {
  errors: FlowIssue[];
  warnings: FlowIssue[];
  serverErrors: FlowIssue[];
  serverWarnings: FlowIssue[];
}

export interface MediaItem {
  id: string;
  kind: MediaAssetKind;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  path: string;
}

export type NodeEventCounts = Record<
  | "SENT"
  | "CLICKED"
  | "INPUT_VALID"
  | "INPUT_INVALID"
  | "REPLIED"
  | "CONDITION_TRUE"
  | "CONDITION_FALSE"
  | "SEND_FAILED",
  number
>;

export interface FlowStats {
  days: number | null;
  since: string | null;
  nodes: Record<string, NodeEventCounts>;
  totals: NodeEventCounts;
  runs: Record<"RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED" | "total", number>;
}
