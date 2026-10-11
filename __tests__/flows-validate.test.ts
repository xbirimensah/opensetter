/**
 * Flow validation - Unit Tests
 *
 * Shape parsing, Meta limits, graph integrity, trigger rules and the lint
 * warnings the editor shows next to each step.
 */

import { describe, it, expect } from "vitest";
import type { FlowGraph, FlowNode, FlowTrigger } from "../lib/flows/types";
import {
  FIRST_MESSAGE_WARNING,
  isHttpUrl,
  isJsonTemplate,
  lintFlow,
  mediaRuleFor,
  nodeDisplayName,
  nodeEdges,
  parseFlowGraph,
  parseFlowGraphShape,
  parseFlowTriggers,
  parseFlowTriggersShape,
  referencedFlowIds,
  referencedMedia,
  validateFlowGraph,
  validateFlowTriggers,
} from "../lib/flows/validate";

function message(id: string, overrides: Partial<Extract<FlowNode, { type: "message" }>> = {}): FlowNode {
  return {
    id,
    type: "message",
    contents: [{ id: `${id}_t`, type: "text", text: "Hi there" }],
    ...overrides,
  };
}

function graph(nodes: FlowNode[], startNodeId: string | null = nodes[0]?.id ?? null): FlowGraph {
  return { startNodeId, nodes };
}

function errorsOf(g: FlowGraph): string[] {
  return validateFlowGraph(g).map((issue) => issue.message);
}

describe("parseFlowGraph", () => {
  it("accepts a minimal valid flow", () => {
    const result = parseFlowGraph(graph([message("a")]));
    expect(result.ok).toBe(true);
  });

  it("accepts every node type when correctly filled", () => {
    const nodes: FlowNode[] = [
      message("m", {
        contents: [
          {
            id: "t1",
            type: "text",
            text: "Pick one",
            buttons: [
              { id: "b1", type: "next", title: "Yes", next: "i" },
              { id: "b2", type: "url", title: "Site", url: "https://example.com/?u={{username}}", track: true },
              { id: "b3", type: "flow", title: "Other", flowId: "cflow123" },
            ],
          },
          { id: "img", type: "image", mediaId: "casset1" },
          { id: "typ", type: "typing", seconds: 3 },
          {
            id: "cards",
            type: "cards",
            cards: [{ id: "c1", title: "Card", subtitle: "Sub", buttons: [{ id: "cb1", type: "next", title: "Go", next: "c" }] }],
          },
        ],
        quickReplies: [{ id: "q1", title: "Later", next: "d" }],
      }),
      {
        id: "i",
        type: "input",
        prompt: "Your email?",
        inputType: "email",
        saveTo: "email",
        maxRetries: 2,
        skipLabel: "Skip",
        timeoutMinutes: 60,
        next: "c",
        onFail: null,
      },
      {
        id: "c",
        type: "condition",
        match: "all",
        rules: [
          { id: "r1", subject: "tag", op: "has", value: "lead" },
          { id: "r2", subject: "field", key: "plan", op: "equals", value: "pro" },
          { id: "r3", subject: "follows", op: "is_true" },
        ],
        next: "a",
        elseNext: "r",
      },
      {
        id: "a",
        type: "action",
        actions: [
          { id: "x1", type: "add_tag", tag: "lead" },
          { id: "x2", type: "set_field", key: "source", value: "{{comment}}" },
          {
            id: "x3",
            type: "webhook",
            url: "https://hooks.example.com/in",
            method: "POST",
            body: '{"email": "{{email}}", "n": {{field.count}}}',
            headers: { "X-Token": "abc" },
            saveResponse: [{ path: "data.id", key: "crm_id" }],
          },
          { id: "x4", type: "pause_ai" },
        ],
        next: "d",
      },
      { id: "d", type: "delay", seconds: 3600, next: "h" },
      {
        id: "r",
        type: "randomizer",
        branches: [
          { id: "br1", weight: 50, next: "s" },
          { id: "br2", weight: 50, next: "h" },
        ],
      },
      { id: "s", type: "start_flow", flowId: "cother" },
      { id: "h", type: "ai_handoff" },
    ];
    const result = parseFlowGraph(graph(nodes, "m"));
    expect(result).toEqual({ ok: true, value: expect.any(Object) });
  });

  it("names the step in shape errors", () => {
    const result = parseFlowGraphShape({
      startNodeId: "a",
      nodes: [{ id: "a", type: "message", name: "Welcome", contents: [{ id: "x", type: "banner" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^"Welcome", block 1/);
  });

  it("rejects unknown node types and malformed ids", () => {
    expect(parseFlowGraphShape({ startNodeId: null, nodes: [{ id: "a", type: "teleport" }] }).ok).toBe(false);
    expect(parseFlowGraphShape(graph([message("bad|id")])).ok).toBe(false);
    expect(parseFlowGraphShape("nope").ok).toBe(false);
  });

  it("strips unknown keys", () => {
    const result = parseFlowGraphShape({ ...graph([message("a")]), extra: true });
    expect(result.ok && "extra" in result.value).toBe(false);
  });

  it("returns readable rule errors", () => {
    const result = parseFlowGraph(graph([message("a", { name: "Hello", next: "ghost" })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('"Hello": next points to a step that no longer exists.');
  });
});

describe("validateFlowGraph: graph integrity", () => {
  it("requires at least one step", () => {
    expect(errorsOf(graph([], null))).toContain("Add at least one step.");
  });

  it("requires an existing start step", () => {
    expect(errorsOf(graph([message("a")], null))).toContain("Choose which step the flow starts with.");
    expect(errorsOf(graph([message("a")], "zzz"))[0]).toMatch(/start step no longer exists/);
  });

  it("flags duplicate node ids", () => {
    expect(errorsOf(graph([message("a"), message("a")])).join(" ")).toMatch(/same id/);
  });

  it("flags every kind of dangling reference", () => {
    const nodes: FlowNode[] = [
      message("m", {
        contents: [{ id: "t", type: "text", text: "Hi", buttons: [{ id: "b", type: "next", title: "Go", next: "gone1" }] }],
        quickReplies: [{ id: "q", title: "Q", next: "gone2" }],
        next: "gone3",
      }),
      { id: "i", type: "input", prompt: "?", inputType: "text", saveTo: "field:answer", next: "gone4", onFail: "gone5" },
      { id: "c", type: "condition", match: "any", rules: [{ id: "r", subject: "email", op: "is_set" }], next: "gone6", elseNext: "gone7" },
      { id: "r", type: "randomizer", branches: [{ id: "x", weight: 1, next: "gone8" }, { id: "y", weight: 1, next: null }] },
    ];
    const dangling = errorsOf(graph(nodes, "m")).filter((e) => e.includes("no longer exists"));
    expect(dangling).toHaveLength(8);
  });

  it("allows null routing (end flow)", () => {
    const nodes: FlowNode[] = [
      { id: "c", type: "condition", match: "all", rules: [{ id: "r", subject: "phone", op: "is_not_set" }], next: null, elseNext: null },
    ];
    expect(errorsOf(graph(nodes))).toEqual([]);
  });
});

describe("validateFlowGraph: Meta limits", () => {
  it("allows 1000 characters without buttons, 640 with buttons", () => {
    const plain = message("a", { contents: [{ id: "t", type: "text", text: "x".repeat(1000) }] });
    expect(errorsOf(graph([plain]))).toEqual([]);

    const tooLong = message("a", { contents: [{ id: "t", type: "text", text: "x".repeat(1001) }] });
    expect(errorsOf(graph([tooLong]))[0]).toMatch(/1001 characters, the limit is 1000/);

    const withButton = message("a", {
      contents: [{ id: "t", type: "text", text: "x".repeat(641), buttons: [{ id: "b", type: "url", title: "Go", url: "https://a.com" }] }],
    });
    expect(errorsOf(graph([withButton]))[0]).toMatch(/With buttons Instagram allows 640/);
  });

  it("rejects empty text and empty messages", () => {
    expect(errorsOf(graph([message("a", { contents: [{ id: "t", type: "text", text: "  " }] })]))[0]).toMatch(/text is empty/);
    expect(errorsOf(graph([message("a", { contents: [] })]))[0]).toMatch(/at least one block/);
  });

  it("limits buttons to 3 with titles up to 20 characters", () => {
    const buttons = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, type: "next" as const, title: `B${n}`, next: null }));
    const errs = errorsOf(graph([message("a", { contents: [{ id: "t", type: "text", text: "Hi", buttons }] })]));
    expect(errs.join(" ")).toMatch(/4 buttons, Instagram allows 3/);

    const long = errorsOf(
      graph([message("a", { contents: [{ id: "t", type: "text", text: "Hi", buttons: [{ id: "b", type: "next", title: "x".repeat(21), next: null }] }] })])
    );
    expect(long[0]).toMatch(/21 characters, the limit is 20/);
  });

  it("checks button URLs and flow targets", () => {
    const errs = errorsOf(
      graph([
        message("a", {
          contents: [
            {
              id: "t",
              type: "text",
              text: "Hi",
              buttons: [
                { id: "b1", type: "url", title: "A", url: "javascript:alert(1)" },
                { id: "b2", type: "flow", title: "B", flowId: "" },
              ],
            },
          ],
        }),
      ])
    );
    expect(errs.join(" ")).toMatch(/URL must start with https/);
    expect(errs.join(" ")).toMatch(/needs a flow to start/);
  });

  it("limits quick replies to 13", () => {
    const quickReplies = Array.from({ length: 14 }, (_, i) => ({ id: `q${i}`, title: `Q${i}`, next: null }));
    expect(errorsOf(graph([message("a", { quickReplies })])).join(" ")).toMatch(/14 quick replies, Instagram allows 13/);
  });

  it("flags button ids shared between blocks of one step", () => {
    const errs = errorsOf(
      graph([
        message("a", {
          contents: [{ id: "t", type: "text", text: "Hi", buttons: [{ id: "same", type: "next", title: "A", next: null }] }],
          quickReplies: [{ id: "same", title: "B", next: null }],
        }),
      ])
    );
    expect(errs.join(" ")).toMatch(/shares its id/);
  });

  it("limits cards to 10 and card titles to 80", () => {
    const cards = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, title: "T", buttons: [] }));
    expect(errorsOf(graph([message("a", { contents: [{ id: "g", type: "cards", cards }] })])).join(" ")).toMatch(/11 cards/);
    const longTitle = [{ id: "c", title: "x".repeat(81), buttons: [] }];
    expect(errorsOf(graph([message("a", { contents: [{ id: "g", type: "cards", cards: longTitle }] })]))[0]).toMatch(/81 characters/);
  });

  it("requires a file or https URL on media blocks", () => {
    expect(errorsOf(graph([message("a", { contents: [{ id: "v", type: "video" }] })]))[0]).toMatch(/needs a file or a URL/);
    expect(errorsOf(graph([message("a", { contents: [{ id: "v", type: "audio", url: "http://x.com/a.mp3" }] })]))[0]).toMatch(/https/);
    expect(errorsOf(graph([message("a", { contents: [{ id: "v", type: "file", url: "https://x.com/a.pdf" }] })]))).toEqual([]);
  });

  it("limits typing pauses to 20 seconds", () => {
    expect(errorsOf(graph([message("a", { contents: [{ id: "p", type: "typing", seconds: 21 }] })]))[0]).toMatch(/1 to 20 seconds/);
    expect(errorsOf(graph([message("a", { contents: [{ id: "p", type: "typing", seconds: 20 }] })]))).toEqual([]);
  });

  it("limits delays to 1 second up to 24 hours", () => {
    expect(errorsOf(graph([{ id: "d", type: "delay", seconds: 0 }]))[0]).toMatch(/between 1 second and 24 hours/);
    expect(errorsOf(graph([{ id: "d", type: "delay", seconds: 86_401 }]))[0]).toMatch(/between 1 second and 24 hours/);
    expect(errorsOf(graph([{ id: "d", type: "delay", seconds: 86_400 }]))).toEqual([]);
  });

  it("requires positive randomizer weights and two branches", () => {
    const errs = errorsOf(graph([{ id: "r", type: "randomizer", branches: [{ id: "x", weight: 0, next: null }] }]));
    expect(errs.join(" ")).toMatch(/at least 2 branches/);
    expect(errs.join(" ")).toMatch(/weight must be greater than 0/);
  });

  it("checks condition rules", () => {
    const errs = errorsOf(
      graph([
        {
          id: "c",
          type: "condition",
          match: "all",
          rules: [
            { id: "r1", subject: "email", op: "equals", value: "x" },
            { id: "r2", subject: "field", op: "is_set" },
            { id: "r3", subject: "tag", op: "has" },
          ],
          next: null,
          elseNext: null,
        },
      ])
    );
    expect(errs.join(" ")).toMatch(/rule 1 uses an operator/);
    expect(errs.join(" ")).toMatch(/rule 2 needs a custom field name/);
    expect(errs.join(" ")).toMatch(/rule 3 needs a tag/);
  });

  it("checks actions", () => {
    const errs = errorsOf(
      graph([
        {
          id: "a",
          type: "action",
          actions: [
            { id: "x1", type: "set_field", key: "bad name", value: "v" },
            { id: "x2", type: "webhook", url: "https://a.com", body: "{not json" },
            { id: "x3", type: "add_tag", tag: "" },
            { id: "x4", type: "webhook", url: "http://plain.example.com/hook" },
          ],
        },
      ])
    );
    expect(errs.join(" ")).toMatch(/action 1 needs a custom field name/);
    expect(errs.join(" ")).toMatch(/action 2 body is not valid JSON/);
    expect(errs.join(" ")).toMatch(/action 3 needs a tag/);
    expect(errs.join(" ")).toMatch(/action 4 URL must start with https/);
  });

  it("checks input steps", () => {
    const errs = errorsOf(
      graph([{ id: "i", type: "input", prompt: "", inputType: "email", saveTo: "somewhere", maxRetries: 9, timeoutMinutes: 5000 }])
    );
    expect(errs.join(" ")).toMatch(/question is empty/);
    expect(errs.join(" ")).toMatch(/where to save/);
    expect(errs.join(" ")).toMatch(/retries must be 0 to 5/);
    expect(errs.join(" ")).toMatch(/timeout must be 1 to 1440/);
  });
});

describe("triggers", () => {
  it("accepts every trigger type", () => {
    const triggers: FlowTrigger[] = [
      { id: "t1", type: "dm_keyword", keywords: ["PRICE"], match: "whole_word", excludeKeywords: ["refund"] },
      { id: "t2", type: "story_reply" },
      { id: "t3", type: "story_mention", oncePer24h: true },
      { id: "t4", type: "ref_link", ref: "bio-link_1" },
      { id: "t5", type: "welcome" },
      { id: "t6", type: "default_reply", oncePer24h: true },
      { id: "t7", type: "new_follower" },
    ];
    expect(parseFlowTriggers(triggers)).toEqual({ ok: true, value: triggers });
  });

  it("requires keywords and a valid ref", () => {
    const issues = validateFlowTriggers([
      { id: "a", type: "dm_keyword", keywords: [], match: "contains" },
      { id: "b", type: "ref_link", ref: "has space" },
    ]);
    expect(issues.map((i) => i.triggerId)).toEqual(["a", "b"]);
    expect(issues[0].message).toMatch(/at least one keyword/);
    expect(issues[1].message).toMatch(/letters, numbers, dashes/);
  });

  it("allows one welcome trigger per flow and unique refs", () => {
    const issues = validateFlowTriggers([
      { id: "a", type: "welcome" },
      { id: "b", type: "welcome" },
      { id: "c", type: "ref_link", ref: "x" },
      { id: "d", type: "ref_link", ref: "X" },
    ]);
    expect(issues.map((i) => i.message).join(" ")).toMatch(/only once/);
    expect(issues.map((i) => i.message).join(" ")).toMatch(/used twice/);
  });

  it("rejects unknown trigger types in the shape", () => {
    const result = parseFlowTriggersShape([{ id: "a", type: "comment" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^Trigger 1/);
  });
});

describe("lintFlow", () => {
  const withButton = (id: string, next: string | null = null): FlowNode =>
    message(id, {
      contents: [{ id: `${id}_t`, type: "text", text: "Want it?", buttons: [{ id: `${id}_b`, type: "next", title: "Yes", next }] }],
    });

  it("warns when a comment flow opens without a button", () => {
    const warnings = lintFlow(graph([message("a")]), { commentTriggered: true });
    expect(warnings.some((w) => w.nodeId === "a" && w.message.includes(FIRST_MESSAGE_WARNING))).toBe(true);
  });

  it("accepts a text with a button as the first comment reply", () => {
    const warnings = lintFlow(graph([withButton("a")]), { commentTriggered: true });
    expect(warnings).toEqual([]);
  });

  it("does not apply the private-reply rule to DM flows", () => {
    expect(lintFlow(graph([message("a")]), { commentTriggered: false })).toEqual([]);
  });

  it("looks through conditions and actions to find the first message", () => {
    const nodes: FlowNode[] = [
      { id: "act", type: "action", actions: [{ id: "x", type: "add_tag", tag: "lead" }], next: "m" },
      message("m"),
    ];
    const warnings = lintFlow(graph(nodes), { commentTriggered: true });
    expect(warnings.find((w) => w.nodeId === "m")?.message).toContain(FIRST_MESSAGE_WARNING);
  });

  it("warns about an input step inside the first message", () => {
    const first = lintFlow(
      graph([{ id: "i", type: "input", prompt: "Email?", inputType: "email", saveTo: "email" }]),
      { commentTriggered: true }
    );
    expect(first[0].message).toMatch(/input step inside the first message/);

    const chained = lintFlow(
      graph([
        { ...withButton("a"), next: "i" } as FlowNode,
        { id: "i", type: "input", prompt: "Email?", inputType: "email", saveTo: "email" },
      ]),
      { commentTriggered: true }
    );
    expect(chained.find((w) => w.nodeId === "i")?.message).toMatch(/input step inside the first message/);
  });

  it("warns about delays longer than 23 hours", () => {
    const warnings = lintFlow(graph([withButton("a", "d"), { id: "d", type: "delay", seconds: 23 * 3600 + 1 }]), {
      commentTriggered: false,
    });
    expect(warnings.find((w) => w.nodeId === "d")?.message).toMatch(/24h window will close/);
  });

  it("warns about unreachable steps", () => {
    const warnings = lintFlow(graph([message("a"), message("b")]), { commentTriggered: false });
    expect(warnings).toEqual([{ nodeId: "b", message: 'Step 2 (Message): no step leads here, so it never runs.' }]);
  });

  it("warns about loops without a wait", () => {
    const nodes: FlowNode[] = [
      { id: "a", type: "action", actions: [{ id: "x", type: "add_tag", tag: "t" }], next: "b" },
      { id: "b", type: "action", actions: [{ id: "y", type: "add_tag", tag: "u" }], next: "a" },
    ];
    const warnings = lintFlow(graph(nodes), { commentTriggered: false });
    expect(warnings.filter((w) => w.message.includes("loops back"))).toHaveLength(1);
  });

  it("does not flag loops that wait for a tap", () => {
    const warnings = lintFlow(graph([withButton("a", "a")]), { commentTriggered: false });
    expect(warnings.some((w) => w.message.includes("loops back"))).toBe(false);
  });

  it("warns about unknown variables and {{comment}} outside comment flows", () => {
    const node = message("a", { contents: [{ id: "t", type: "text", text: "Hi {{nickname}}, you said {{comment}}" }] });
    const warnings = lintFlow(graph([node]), { commentTriggered: false }).map((w) => w.message);
    expect(warnings.join(" ")).toMatch(/\{\{nickname\}\} is not a known variable/);
    expect(warnings.join(" ")).toMatch(/\{\{comment\}\} stays empty/);
  });
});

describe("helpers", () => {
  it("resolves upload rules by MIME type, with the extension as fallback", () => {
    expect(mediaRuleFor("image/png", "a.png")).toMatchObject({ kind: "IMAGE", maxBytes: 8 * 1024 * 1024 });
    expect(mediaRuleFor("", "voice.m4a")).toMatchObject({ kind: "AUDIO", mimeType: "audio/x-m4a" });
    expect(mediaRuleFor("application/octet-stream", "doc.pdf")).toMatchObject({ kind: "FILE" });
    expect(mediaRuleFor("image/gif", "a.gif")).toBeNull();
    expect(mediaRuleFor("text/html", "x.html")).toBeNull();
  });

  it("validates URLs and JSON templates with variables", () => {
    expect(isHttpUrl("https://a.com/?e={{email}}")).toBe(true);
    expect(isHttpUrl("ftp://a.com")).toBe(false);
    expect(isHttpUrl("http://a.com", { httpsOnly: true })).toBe(false);
    expect(isJsonTemplate('{"n": {{field.count}}, "e": "{{email}}"}')).toBe(true);
    expect(isJsonTemplate('{"n": ')).toBe(false);
  });

  it("lists edges with wait semantics", () => {
    const edges = nodeEdges({ id: "i", type: "input", prompt: "?", inputType: "text", saveTo: "field:x", next: "a", onFail: null });
    expect(edges).toEqual([
      { from: "i", to: "a", label: "next", immediate: false },
      { from: "i", to: null, label: "on fail", immediate: false },
    ]);
  });

  it("names steps by name or position", () => {
    expect(nodeDisplayName({ type: "delay", name: "" }, 2)).toBe("Step 3 (Delay)");
    expect(nodeDisplayName({ type: "delay", name: "Wait" }, 2)).toBe('"Wait"');
  });

  it("collects referenced flows and media", () => {
    const g = graph([
      message("a", {
        contents: [
          { id: "t", type: "text", text: "x", buttons: [{ id: "b", type: "flow", title: "F", flowId: "f1" }] },
          { id: "v", type: "video", mediaId: "m1" },
          { id: "g", type: "cards", cards: [{ id: "c", title: "T", imageMediaId: "m2", buttons: [] }] },
        ],
      }),
      { id: "s", type: "start_flow", flowId: "f2" },
    ]);
    expect(referencedFlowIds(g).map((r) => r.flowId)).toEqual(["f1", "f2"]);
    expect(referencedMedia(g).map((r) => [r.mediaId, r.kind])).toEqual([
      ["m1", "VIDEO"],
      ["m2", "IMAGE"],
    ]);
  });
});
