/**
 * Campaign templates become flows, and old /campaigns/new links (public
 * template pages link to them through login) land on the right flow page.
 */

import { describe, expect, it } from "vitest";
import {
  campaignNewRedirect,
  flowFromTemplate,
  flowFromTemplateSlug,
  splitFirstLink,
  templateTextToFlowText,
} from "../lib/flows/template-flow";
import { parseEditorTriggersShape, validateCommentTriggers } from "../lib/flows/comment-triggers";
import { parseFlowGraph } from "../lib/flows/validate";
import { CAMPAIGN_TEMPLATES, getCampaignTemplate } from "../lib/templates/campaign-templates";

let counter = 0;
const ids = (prefix: string) => `${prefix}_${++counter}`;

describe("campaignNewRedirect", () => {
  it("sends template links to a new flow from that template", () => {
    expect(campaignNewRedirect({ template: "dtc-product-link" })).toBe("/flows/new?template=dtc-product-link");
    expect(campaignNewRedirect({ template: ["fitness-plan", "x"] })).toBe("/flows/new?template=fitness-plan");
  });

  it("ignores unknown templates and opens a blank new flow", () => {
    expect(campaignNewRedirect({ template: "../../etc" })).toBe("/flows/new");
    expect(campaignNewRedirect({})).toBe("/flows/new");
  });

  it("opens a flow with a new comment trigger for ?flowId=", () => {
    expect(campaignNewRedirect({ flowId: "cflow123" })).toBe("/flows/cflow123?add=comment");
    expect(campaignNewRedirect({ flowId: "bad/id?x" })).toBe("/flows/new");
  });

  it("keeps the classic builder for the CSV import queue", () => {
    expect(campaignNewRedirect({ import: "1" })).toBeNull();
  });
});

describe("flowFromTemplate", () => {
  it("turns {username} into a flow variable", () => {
    expect(templateTextToFlowText("Hey {username}, {{name}} {first_name}")).toBe("Hey {{username}}, {{name}} {{first_name}}");
  });

  it("moves the first link onto a button", () => {
    expect(splitFirstLink("Hey there, here is the link you asked for: https://yourstore.com/product")).toEqual({
      text: "Hey there, here is the link you asked for.",
      url: "https://yourstore.com/product",
    });
    expect(splitFirstLink("No link here")).toEqual({ text: "No link here", url: null });
  });

  it("builds a valid draft: a comment trigger with the keywords and one message with a link button", () => {
    const template = getCampaignTemplate("dtc-product-link")!;
    const draft = flowFromTemplate(template, ids);
    expect(draft.name).toBe("DTC Product Link Drop");
    expect(parseFlowGraph(draft.graph).ok).toBe(true);
    const [message] = draft.graph.nodes;
    expect(draft.graph.startNodeId).toBe(message.id);
    expect(message.type === "message" && message.contents[0]).toMatchObject({
      type: "text",
      text: "Hey {{username}}, here is the product link you asked for.",
      buttons: [{ type: "url", title: "Open link", url: "https://yourstore.com/product", track: true }],
    });
    expect(draft.triggers).toHaveLength(1);
    expect(draft.triggers[0]).toMatchObject({ type: "comment", keywords: ["LINK", "SHOP", "BUY"], wholeWordMatch: true, publicReplyEnabled: false });
    expect(parseEditorTriggersShape(draft.triggers).ok).toBe(true);
    // The post is still to choose, so it cannot go live as is.
    expect(validateCommentTriggers(draft.triggers).map((i) => i.message)).toEqual([
      "Comment trigger 1: choose a post or reel, any post, or your next reel.",
    ]);
  });

  it("works for every shipped template", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const draft = flowFromTemplateSlug(template.slug, ids);
      expect(draft, template.slug).not.toBeNull();
      expect(parseFlowGraph(draft!.graph).ok, template.slug).toBe(true);
      expect(parseEditorTriggersShape(draft!.triggers).ok, template.slug).toBe(true);
    }
    expect(flowFromTemplateSlug("missing")).toBeNull();
  });
});
