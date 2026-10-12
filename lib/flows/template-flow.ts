/**
 * Campaign templates (lib/templates) as flows, and where the old
 * /campaigns/new links land now that campaigns live inside flows.
 *
 * A template becomes a DRAFT flow with one comment trigger (the template's
 * keywords, post still to choose) and its DM as the first message. A link
 * in the DM text moves onto a tracked "Open link" button, which is also
 * what Instagram's one-private-reply rule wants from a first message.
 */

import { getCampaignTemplate, type CampaignTemplate } from "@/lib/templates/campaign-templates";
import { createCommentTrigger } from "./comment-triggers";
import type { CommentTrigger, FlowGraph, MessageNode } from "./types";
import { FLOW_ID_PATTERN } from "./validate";

export type IdFactory = (prefix: string) => string;

export function randomFlowId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Templates write {username}; flows use {{username}}. */
export function templateTextToFlowText(text: string): string {
  return text.replace(/(?<!\{)\{(username|name|first_name)\}(?!\})/g, "{{$1}}");
}

const URL_PATTERN = /https?:\/\/[^\s]+/;

/** Splits the first link out of a DM so it can become a button. */
export function splitFirstLink(text: string): { text: string; url: string | null } {
  const match = text.match(URL_PATTERN);
  if (!match || match.index === undefined) return { text, url: null };
  const url = match[0].replace(/[.,;!?)]+$/, "");
  let before = text.slice(0, match.index).replace(/[\s:]+$/, "");
  const after = text.slice(match.index + url.length).replace(/^[.,;!?)]+/, "").trim();
  // "...the link you asked for: <url>" reads as a sentence without the link.
  if (before && !after && !/[.!?]$/.test(before)) before = `${before}.`;
  const rest = [before, after].filter(Boolean).join(" ").trim();
  return { text: rest || text, url };
}

export interface TemplateFlowDraft {
  name: string;
  graph: FlowGraph;
  triggers: CommentTrigger[];
}

export function flowFromTemplate(template: CampaignTemplate, id: IdFactory = randomFlowId): TemplateFlowDraft {
  const { text, url } = splitFirstLink(templateTextToFlowText(template.dmMessage));
  const nodeId = id("n");
  const message: MessageNode = {
    id: nodeId,
    type: "message",
    name: "Send Message",
    position: { x: 360, y: 0 },
    contents: [
      {
        id: id("c"),
        type: "text",
        text,
        ...(url ? { buttons: [{ id: id("b"), type: "url" as const, title: "Open link", url, track: true }] } : {}),
      },
    ],
  };
  return {
    name: template.title.slice(0, 100),
    graph: { startNodeId: nodeId, nodes: [message], triggerPosition: { x: 0, y: 0 } },
    triggers: [
      createCommentTrigger(id("t"), {
        keywords: template.keywords.slice(0, 10),
        wholeWordMatch: true,
      }),
    ],
  };
}

export function flowFromTemplateSlug(slug: string | null | undefined, id: IdFactory = randomFlowId): TemplateFlowDraft | null {
  const template = getCampaignTemplate(slug);
  return template ? flowFromTemplate(template, id) : null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Where /campaigns/new sends people now. null = stay on the classic
 * builder (only the CSV import queue still needs it).
 *
 * - ?template=<slug> (public template pages, through login) -> a new flow from that template
 * - ?flowId=<id> ("use in a campaign") -> that flow, with a new comment trigger
 * - anything else -> a new flow
 */
export function campaignNewRedirect(params: SearchParams): string | null {
  if (first(params.import) === "1") return null;
  const template = getCampaignTemplate(first(params.template));
  if (template) return `/flows/new?template=${encodeURIComponent(template.slug)}`;
  const flowId = first(params.flowId);
  if (flowId && FLOW_ID_PATTERN.test(flowId)) return `/flows/${flowId}?add=comment`;
  return "/flows/new";
}
