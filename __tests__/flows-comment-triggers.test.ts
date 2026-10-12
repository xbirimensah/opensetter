/**
 * Comment triggers: a flow's "Comment on a post or reel" triggers are its
 * Automation rows. Shape, activation rules, row mapping (the live
 * Ad-Matrix row must round-trip without a single changed column) and the
 * create / update / delete plan the flow API applies.
 */

import { describe, expect, it } from "vitest";
import {
  automationActiveFor,
  changedCommentData,
  commentOverlapWarnings,
  commentTriggerData,
  commentTriggerFromRow,
  commentTriggerName,
  createCommentTrigger,
  isInstagramPostUrl,
  parseEditorTriggersShape,
  planCommentTriggerSync,
  triggersForCopy,
  validateCommentTriggers,
  withPostScope,
  type CommentAutomationRow,
} from "../lib/flows/comment-triggers";
import type { CommentTrigger } from "../lib/flows/types";

/** The live campaign behind "Ad-Matrix SOP (Kommentar Matrix)". */
const adMatrixRow: CommentAutomationRow = {
  id: "cmatrix0001",
  name: "Ad-Matrix: Kommentar Matrix",
  isActive: true,
  postId: null,
  postUrl: null,
  matchAnyPost: true,
  pendingNextReel: false,
  keywords: ["matrix"],
  matchAnyWord: false,
  wholeWordMatch: true,
  publicReplyEnabled: true,
  publicReplyMessage: null,
  publicReplyMessages: [
    "Ist raus, schau in deine DMs",
    "Hab dir geschrieben, check deine Nachrichten",
    "Kommt gerade bei dir an, schau in die DMs",
  ],
  updatedAt: new Date("2026-10-12T08:00:00.000Z"),
};

function trigger(overrides: Partial<CommentTrigger> = {}): CommentTrigger {
  return createCommentTrigger("t_new1", { keywords: ["GUIDE"], matchAnyPost: true, ...overrides });
}

describe("parseEditorTriggersShape", () => {
  it("splits comment triggers from Flow.triggers entries", () => {
    const result = parseEditorTriggersShape([
      commentTriggerFromRow(adMatrixRow),
      { id: "t_dm", type: "dm_keyword", keywords: ["hi"], match: "whole_word" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commentTriggers).toHaveLength(1);
    expect(result.value.commentTriggers[0].automationId).toBe("cmatrix0001");
    expect(result.value.flowTriggers).toEqual([{ id: "t_dm", type: "dm_keyword", keywords: ["hi"], match: "whole_word" }]);
  });

  it("rejects malformed comment triggers the way the campaign API does", () => {
    const tooMany = parseEditorTriggersShape([trigger({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) })]);
    expect(tooMany.ok).toBe(false);
    const tooLong = parseEditorTriggersShape([trigger({ keywords: ["x".repeat(51)] })]);
    expect(tooLong.ok).toBe(false);
    const badUrl = parseEditorTriggersShape([trigger({ matchAnyPost: false, postId: "123", postUrl: "javascript:alert(1)" })]);
    expect(badUrl.ok).toBe(false);
    const replies = parseEditorTriggersShape([trigger({ publicReplyEnabled: true, publicReplyMessages: Array(11).fill("hi") })]);
    expect(replies.ok).toBe(false);
    expect(parseEditorTriggersShape("nope").ok).toBe(false);
  });

  it("rejects duplicate trigger ids across both kinds", () => {
    const result = parseEditorTriggersShape([trigger({ id: "same" }), { id: "same", type: "welcome" }]);
    expect(result.ok).toBe(false);
  });

  it("only accepts https Instagram post links", () => {
    expect(isInstagramPostUrl("https://www.instagram.com/reel/abc/")).toBe(true);
    expect(isInstagramPostUrl("http://www.instagram.com/reel/abc/")).toBe(false);
    expect(isInstagramPostUrl("https://evil.example/instagram.com")).toBe(false);
  });
});

describe("validateCommentTriggers", () => {
  it("needs a post choice, a keyword (or any comment) and reply text when replies are on", () => {
    const issues = validateCommentTriggers([
      createCommentTrigger("t_a", { publicReplyEnabled: true, publicReplyMessages: [" "] }),
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "Comment trigger 1: choose a post or reel, any post, or your next reel.",
      "Comment trigger 1: add at least one keyword, or reply to every comment.",
      "Comment trigger 1: write at least one public reply, or turn public replies off.",
    ]);
    expect(issues.every((i) => i.triggerId === "t_a")).toBe(true);
  });

  it("passes the Ad-Matrix trigger", () => {
    expect(validateCommentTriggers([commentTriggerFromRow(adMatrixRow)])).toEqual([]);
  });

  it("accepts any comment on the next reel", () => {
    expect(validateCommentTriggers([createCommentTrigger("t", { matchAnyWord: true, pendingNextReel: true })])).toEqual([]);
  });
});

describe("row mapping", () => {
  it("round-trips the Ad-Matrix row with no changed column", () => {
    const loaded = commentTriggerFromRow(adMatrixRow);
    expect(loaded).toMatchObject({ id: "cmatrix0001", keywords: ["matrix"], matchAnyPost: true, wholeWordMatch: true });
    expect(changedCommentData(adMatrixRow, commentTriggerData(loaded))).toEqual({});
  });

  it("reads the legacy single public reply", () => {
    const row = { ...adMatrixRow, publicReplyMessages: [], publicReplyMessage: "Check your DMs" };
    expect(commentTriggerFromRow(row).publicReplyMessages).toEqual(["Check your DMs"]);
    expect(changedCommentData(row, commentTriggerData(commentTriggerFromRow(row)))).toEqual({});
  });

  it("normalizes like the campaign API: any word clears keywords, any post clears the post", () => {
    const data = commentTriggerData(
      createCommentTrigger("t", { matchAnyWord: true, keywords: ["X"], matchAnyPost: true, postId: "1", postUrl: "https://instagram.com/p/1" })
    );
    expect(data).toMatchObject({ keywords: [], postId: null, postUrl: null, pendingNextReel: false });
    const replies = commentTriggerData(createCommentTrigger("t", { publicReplyEnabled: false, publicReplyMessages: ["a"] }));
    expect(replies).toMatchObject({ publicReplyMessages: [], publicReplyMessage: null });
  });

  it("switches the post scope consistently", () => {
    const specific = createCommentTrigger("t", { postId: "17", postUrl: "https://www.instagram.com/p/x/" });
    expect(withPostScope(specific, "next_reel")).toMatchObject({ pendingNextReel: true, matchAnyPost: false, postId: null, postUrl: null });
    expect(withPostScope(specific, "any")).toMatchObject({ matchAnyPost: true, pendingNextReel: false, postId: null });
  });

  it("names rows after the flow and numbers them when there are several", () => {
    expect(commentTriggerName("Lead magnet", 0, 1)).toBe("Lead magnet");
    expect(commentTriggerName("Lead magnet", 1, 2)).toBe("Lead magnet (comment 2)");
    expect(commentTriggerName("x".repeat(120), 0, 1)).toHaveLength(100);
  });

  it("isActive follows the flow status", () => {
    expect(automationActiveFor("ACTIVE")).toBe(true);
    expect(automationActiveFor("DRAFT")).toBe(false);
    expect(automationActiveFor("PAUSED")).toBe(false);
  });
});

describe("planCommentTriggerSync", () => {
  const existing = [adMatrixRow, { ...adMatrixRow, id: "cother0002", name: "Old", keywords: ["guide"] }];

  it("creates new triggers, updates changed rows and deletes dropped rows", () => {
    const changed = { ...commentTriggerFromRow(adMatrixRow), keywords: ["matrix", "ads"] };
    const plan = planCommentTriggerSync({
      existing,
      submitted: [changed, trigger()],
      flowName: "Ad-Matrix SOP",
      renamed: false,
    });
    expect(plan.updates).toEqual([{ id: "cmatrix0001", clientId: "cmatrix0001", data: { keywords: ["matrix", "ads"] } }]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ clientId: "t_new1", name: "Ad-Matrix SOP (comment 2)" });
    expect(plan.creates[0].data.keywords).toEqual(["GUIDE"]);
    expect(plan.deletes).toEqual(["cother0002"]);
    expect(plan.matches).toEqual([{ clientId: "cmatrix0001", id: "cmatrix0001" }]);
    expect(plan.conflicts).toEqual([]);
  });

  it("leaves an untouched row alone, name included", () => {
    const plan = planCommentTriggerSync({
      existing: [adMatrixRow],
      submitted: [commentTriggerFromRow(adMatrixRow)],
      flowName: "Ad-Matrix SOP (Kommentar Matrix)",
      renamed: false,
    });
    expect(plan).toMatchObject({ creates: [], updates: [], deletes: [], conflicts: [] });
  });

  it("renames rows only when the flow is renamed", () => {
    const plan = planCommentTriggerSync({
      existing: [adMatrixRow],
      submitted: [commentTriggerFromRow(adMatrixRow)],
      flowName: "Ad-Matrix",
      renamed: true,
    });
    expect(plan.updates).toEqual([{ id: "cmatrix0001", clientId: "cmatrix0001", data: { name: "Ad-Matrix" } }]);
  });

  it("never claims a row that is not linked to this flow", () => {
    const foreign = { ...trigger(), automationId: "someone-elses-row" };
    const plan = planCommentTriggerSync({ existing: [adMatrixRow], submitted: [foreign], flowName: "F", renamed: false });
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual(["cmatrix0001"]);
  });

  it("does not let two triggers claim the same row", () => {
    const loaded = commentTriggerFromRow(adMatrixRow);
    const plan = planCommentTriggerSync({
      existing: [adMatrixRow],
      submitted: [loaded, { ...loaded, id: "t_copy" }],
      flowName: "F",
      renamed: false,
    });
    expect(plan.matches).toEqual([{ clientId: "cmatrix0001", id: "cmatrix0001" }]);
    expect(plan.creates.map((c) => c.clientId)).toEqual(["t_copy"]);
  });

  it("flags a stale edit of a row that changed elsewhere (a next reel got bound)", () => {
    const bound = { ...adMatrixRow, matchAnyPost: false, postId: "1789", updatedAt: new Date("2026-10-12T09:00:00.000Z") };
    const stale = { ...commentTriggerFromRow(adMatrixRow), matchAnyPost: false, pendingNextReel: true };
    const plan = planCommentTriggerSync({
      existing: [bound],
      submitted: [stale],
      flowName: "F",
      renamed: false,
      versions: { cmatrix0001: "2026-10-12T08:00:00.000Z" },
    });
    expect(plan.conflicts).toEqual([{ id: "cmatrix0001", clientId: "cmatrix0001" }]);
    expect(plan.updates).toEqual([]);
  });
});

describe("helpers", () => {
  it("copies comment triggers without their rows", () => {
    let n = 0;
    const copied = triggersForCopy([commentTriggerFromRow(adMatrixRow), { id: "t_w", type: "welcome" }], () => `t_${++n}`);
    expect(copied[0]).toMatchObject({ id: "t_1", type: "comment", keywords: ["matrix"] });
    expect(copied[0]).not.toHaveProperty("automationId");
    expect(copied[0]).not.toHaveProperty("version");
    expect(copied[1]).toEqual({ id: "t_w", type: "welcome" });
  });

  it("warns when another live automation answers the same comments", () => {
    const warnings = commentOverlapWarnings(
      [trigger({ keywords: ["Matrix"] })],
      [{ id: "a", name: "Old campaign", postId: null, matchAnyPost: true, keywords: ["matrix"], matchAnyWord: false, flow: null }]
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('the live campaign "Old campaign"');
    expect(
      commentOverlapWarnings(
        [trigger({ keywords: ["guide"], matchAnyPost: false, postId: "1" })],
        [{ id: "a", name: "Old", postId: "2", matchAnyPost: false, keywords: ["guide"], matchAnyWord: false }]
      )
    ).toEqual([]);
  });
});
