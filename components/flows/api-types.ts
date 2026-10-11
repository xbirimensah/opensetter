/**
 * Response shapes of /api/flows, /api/flows/:id, /api/flows/:id/stats and
 * /api/media as the editor and list page read them.
 */

import type { FlowTrigger } from "@/lib/flows/types";
import type { FlowIssue, MediaAssetKind } from "@/lib/flows/validate";

export type FlowStatusValue = "DRAFT" | "ACTIVE" | "PAUSED";

export interface FlowCampaignRef {
  id: string;
  name: string;
  isActive: boolean;
  postUrl?: string | null;
  matchAnyPost?: boolean;
  pendingNextReel?: boolean;
  matchAnyWord?: boolean;
  keywords?: string[];
}

export interface FlowListItem {
  id: string;
  name: string;
  status: FlowStatusValue;
  instagramAccountId: string;
  instagramAccount: { id: string; username: string };
  triggers: FlowTrigger[];
  nodeCount: number;
  firstText: string | null;
  automations: FlowCampaignRef[];
  activeRuns: number;
  createdAt: string;
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
  triggers: unknown;
  automations: FlowCampaignRef[];
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
