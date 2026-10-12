/**
 * The flow canvas model: output handles, connecting handles, edges, the
 * left-to-right auto-layout, the undo history and the trigger summaries.
 */

import { describe, expect, it } from "vitest";
import {
  autoLayout,
  connectOutput,
  graphEdges,
  LAYOUT,
  moveNodes,
  nodeOutputs,
  outputTarget,
  parseEdgeId,
  positionAfter,
  TRIGGER_NODE_ID,
} from "../components/flows/canvas/model";
import {
  draftSnapshot,
  historyCommit,
  historyInit,
  historyRedo,
  historyReplace,
  historyUndo,
} from "../components/flows/canvas/draft";
import { createCommentTrigger } from "../lib/flows/comment-triggers";
import { describeEditorTrigger, summarizeEditorTriggers } from "../lib/flows/trigger-summary";
import type { FlowGraph } from "../lib/flows/types";

/** The Ad-Matrix SOP flow without positions (as the setup script stores it). */
const adMatrix: FlowGraph = {
  startNodeId: "opener",
  nodes: [
    {
      id: "opener",
      type: "message",
      contents: [
        { id: "t1", type: "text", text: "Soll ich sie dir schicken?", buttons: [{ id: "yes", type: "next", title: "Ja, schick her", next: "email" }] },
      ],
    },
    { id: "email", type: "input", prompt: "E-Mail?", inputType: "email", saveTo: "email", next: "save", onFail: "help" },
    {
      id: "help",
      type: "message",
      contents: [{ id: "t2", type: "text", text: "Nochmal?", buttons: [{ id: "retry", type: "next", title: "Nochmal", next: "email" }] }],
    },
    { id: "save", type: "action", actions: [{ id: "a", type: "add_tag", tag: "lead" }], next: "link" },
    {
      id: "link",
      type: "message",
      contents: [{ id: "t3", type: "text", text: "Da ist sie.", buttons: [{ id: "open", type: "url", title: "SOP", url: "https://x.y", track: true }] }],
    },
  ],
};

describe("nodeOutputs and connections", () => {
  it("gives routed buttons, quick replies and next their own handles; URL buttons none", () => {
    const opener = adMatrix.nodes[0];
    expect(nodeOutputs(opener).map((o) => [o.handle, o.target, o.waits])).toEqual([
      ["btn:yes", "email", true],
      ["next", null, false],
    ]);
    expect(nodeOutputs(adMatrix.nodes[4]).map((o) => o.handle)).toEqual(["next"]);
    expect(nodeOutputs(adMatrix.nodes[1]).map((o) => [o.handle, o.target])).toEqual([
      ["next", "save"],
      ["fail", "help"],
    ]);
  });

  it("connects a handle to a step and back to end-of-flow", () => {
    const linked = connectOutput(adMatrix, "link", "next", "opener");
    expect(outputTarget(linked, "link", "next")).toBe("opener");
    const unlinked = connectOutput(linked, "email", "fail", null);
    expect(outputTarget(unlinked, "email", "fail")).toBeNull();
    // The original graph is untouched.
    expect(outputTarget(adMatrix, "email", "fail")).toBe("help");
  });

  it("connects the trigger card to the start step and ignores unknown targets", () => {
    expect(connectOutput(adMatrix, TRIGGER_NODE_ID, "then", "email").startNodeId).toBe("email");
    expect(connectOutput(adMatrix, "opener", "next", "missing")).toBe(adMatrix);
  });

  it("routes quick replies, condition branches and randomizer branches", () => {
    const graph: FlowGraph = {
      startNodeId: "m",
      nodes: [
        { id: "m", type: "message", contents: [], quickReplies: [{ id: "q1", title: "Yes", next: null }] },
        { id: "c", type: "condition", match: "all", rules: [], next: null, elseNext: null },
        { id: "r", type: "randomizer", branches: [{ id: "b1", weight: 50, next: null }, { id: "b2", weight: 50, next: null }] },
      ],
    };
    let g = connectOutput(graph, "m", "qr:q1", "c");
    g = connectOutput(g, "c", "else", "r");
    g = connectOutput(g, "r", "branch:b2", "m");
    expect(outputTarget(g, "m", "qr:q1")).toBe("c");
    expect(outputTarget(g, "c", "else")).toBe("r");
    expect(outputTarget(g, "r", "branch:b2")).toBe("m");
  });

  it("draws one edge per routed output plus the trigger edge", () => {
    const edges = graphEdges(adMatrix);
    expect(edges.map((e) => e.id)).toEqual([
      "__trigger__:then",
      "opener:btn:yes",
      "email:next",
      "email:fail",
      "help:btn:retry",
      "save:next",
    ]);
    expect(parseEdgeId("opener:btn:yes")).toEqual({ source: "opener", handle: "btn:yes" });
  });
});

describe("autoLayout", () => {
  it("lays out steps left to right by depth from the start", () => {
    const laid = autoLayout(adMatrix);
    const at = (id: string) => laid.nodes.find((n) => n.id === id)?.position;
    expect(laid.triggerPosition).toEqual({ x: 0, y: 0 });
    expect(at("opener")).toEqual({ x: LAYOUT.column, y: 0 });
    expect(at("email")?.x).toBe(2 * LAYOUT.column);
    // help and save are both one step after email: same column, stacked.
    expect(at("help")?.x).toBe(3 * LAYOUT.column);
    expect(at("save")?.x).toBe(3 * LAYOUT.column);
    expect(at("save")!.y).toBeGreaterThan(at("help")!.y);
    expect(at("link")?.x).toBe(4 * LAYOUT.column);
  });

  it("returns the same graph when everything has a position", () => {
    const laid = autoLayout(adMatrix);
    expect(autoLayout(laid)).toBe(laid);
  });

  it("never moves positioned steps and puts unreachable ones after the deepest column", () => {
    const graph: FlowGraph = {
      startNodeId: "a",
      triggerPosition: { x: 0, y: 0 },
      nodes: [
        { id: "a", type: "ai_handoff", position: { x: 500, y: 200 } },
        { id: "orphan", type: "delay", seconds: 60 },
      ],
    };
    const laid = autoLayout(graph);
    expect(laid.nodes[0].position).toEqual({ x: 500, y: 200 });
    expect(laid.nodes[1].position?.x).toBe(2 * LAYOUT.column);
  });

  it("places a new step one column after its source, below anything there", () => {
    const laid = autoLayout(adMatrix);
    const after = positionAfter(laid, "email");
    expect(after.x).toBe(3 * LAYOUT.column);
    const help = laid.nodes.find((n) => n.id === "help")!.position!;
    expect(after.y).toBeGreaterThan(help.y);
    expect(positionAfter(laid, TRIGGER_NODE_ID).x).toBe(LAYOUT.column);
  });

  it("moves steps and the trigger card, rounding to whole pixels", () => {
    const moved = moveNodes(autoLayout(adMatrix), new Map([["email", { x: 10.4, y: 20.6 }], [TRIGGER_NODE_ID, { x: -5.5, y: 1.2 }]]));
    expect(moved.nodes.find((n) => n.id === "email")?.position).toEqual({ x: 10, y: 21 });
    expect(moved.triggerPosition).toEqual({ x: -5, y: 1 });
  });
});

describe("undo history", () => {
  const a = { name: "a", graph: { startNodeId: null, nodes: [] }, triggers: [] };
  const b = { ...a, name: "b" };
  const c = { ...a, name: "c" };

  it("coalesces quick changes with the same key into one undo step", () => {
    let h = historyInit(a);
    h = historyCommit(h, b, "name", 1000);
    h = historyCommit(h, c, "name", 1500);
    expect(h.past).toEqual([a]);
    h = historyUndo(h);
    expect(h.present).toBe(a);
    h = historyRedo(h);
    expect(h.present).toBe(c);
  });

  it("starts a new step after a pause or for another key", () => {
    let h = historyInit(a);
    h = historyCommit(h, b, "name", 1000);
    h = historyCommit(h, c, "name", 5000);
    expect(h.past).toEqual([a, b]);
    h = historyCommit(historyInit(a), b, "x", 1000);
    h = historyCommit(h, c, "y", 1100);
    expect(h.past).toEqual([a, b]);
  });

  it("clears redo on a new change; replace keeps the stacks", () => {
    let h = historyCommit(historyInit(a), b, null, 0);
    h = historyUndo(h);
    h = historyCommit(h, c, null, 10);
    expect(h.future).toEqual([]);
    expect(historyReplace(h, b).past).toEqual(h.past);
    expect(historyUndo(historyInit(a)).present).toBe(a);
  });

  it("snapshots the save payload with a default name", () => {
    expect(draftSnapshot({ ...a, name: "  " })).toContain('"Untitled flow"');
  });
});

describe("trigger summaries", () => {
  it("describes comment and DM triggers in one line", () => {
    const comment = createCommentTrigger("t", { keywords: ["matrix"], matchAnyPost: true });
    expect(describeEditorTrigger(comment)).toBe("Comment: matrix on any post");
    expect(describeEditorTrigger({ id: "d", type: "dm_keyword", keywords: ["hi"], match: "is" })).toBe("DM keyword: hi");
    expect(describeEditorTrigger(createCommentTrigger("t", { matchAnyWord: true, pendingNextReel: true }))).toBe(
      "Comment: any comment on your next reel"
    );
    expect(describeEditorTrigger(createCommentTrigger("t", { keywords: ["a", "b", "c", "d"] }))).toBe(
      "Comment: a, b, c +1 on a post (not chosen yet)"
    );
    expect(describeEditorTrigger({ id: "r", type: "ref_link", ref: "bio" })).toBe("ig.me link: ?ref=bio");
  });

  it("lists comment triggers first", () => {
    const summary = summarizeEditorTriggers([
      { id: "w", type: "welcome" },
      createCommentTrigger("t", { keywords: ["matrix"], matchAnyPost: true }),
    ]);
    expect(summary).toBe("Comment: matrix on any post · Welcome message");
  });
});
