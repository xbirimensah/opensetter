/**
 * Flow engine behaviour with an in-memory IO: no database, no Meta.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FlowExecutor, SKIP_BUTTON_ID, type EngineIO, type RunState } from "@/lib/flows/engine";
import type { BuiltMessage } from "@/lib/flows/message-builder";
import { decodeFlowPayload, type FlowGraph } from "@/lib/flows/types";
import type { FlowContact } from "@/lib/flows/variables";

const NOW = new Date("2026-10-12T10:00:00Z");

interface Sent {
  body: Record<string, unknown>;
  text: string;
  viaComment: string | null;
  nodeId: string;
  prepaid: boolean;
}

function makeIO(overrides: Partial<EngineIO> = {}) {
  const sent: Sent[] = [];
  const events: { type: string; nodeId: string; detail?: Record<string, unknown> }[] = [];
  const resumes: { nodeId: string; delayMs: number }[] = [];
  const requests: { url: string; body?: string }[] = [];
  const contactPatches: unknown[] = [];
  const otherFlows: string[] = [];
  let now = NOW;
  const io: EngineIO = {
    now: () => now,
    random: () => 0.1,
    sleep: async () => {},
    send: async (message: BuiltMessage, opts) => {
      sent.push({ body: message.body, text: message.mirror.text, ...opts });
    },
    followsAccount: async () => null,
    updateContact: async (patch) => {
      contactPatches.push(patch);
    },
    setAiEnabled: async () => {},
    request: async (action, body) => {
      requests.push({ url: action.url, body });
      return { ok: true, status: 200, json: { lead: { id: "L1" } } };
    },
    notify: async () => {},
    record: async (type, nodeId, detail) => {
      events.push({ type, nodeId, detail });
    },
    scheduleResume: async (nodeId, delayMs) => {
      resumes.push({ nodeId, delayMs });
    },
    startOtherFlow: async (flowId) => {
      otherFlows.push(flowId);
    },
    mediaUrl: async (id) => `https://app.test/api/media/${id}/file.pdf`,
    linkUrl: async (_nodeId, buttonId, url) => `https://app.test/f/${buttonId}?u=${encodeURIComponent(url)}`,
    ...overrides,
  };
  return {
    io,
    sent,
    events,
    resumes,
    requests,
    contactPatches,
    otherFlows,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function contact(overrides: Partial<FlowContact> = {}): FlowContact {
  return {
    conversationId: "conv1",
    participantId: "igsid1",
    username: "lena.coach",
    name: null,
    email: null,
    phone: null,
    tags: [],
    customFields: {},
    lastInput: null,
    lastInboundAt: null,
    aiEnabled: true,
    ...overrides,
  };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run1",
    flowId: "flow1",
    status: "RUNNING",
    currentNodeId: null,
    waiting: null,
    retries: 0,
    context: { trigger: "comment", commentId: "c1", commentText: "Matrix", interacted: false },
    sends: 0,
    lastError: null,
    completedAt: null,
    ...overrides,
  };
}

/** The Ad-Matrix funnel: opener with button, email capture, link card. */
const AD_MATRIX: FlowGraph = {
  startNodeId: "opener",
  nodes: [
    {
      id: "opener",
      type: "message",
      contents: [
        {
          id: "t1",
          type: "text",
          text: "Hey {{username}}, die Ad-Matrix ist fertig.",
          buttons: [{ id: "b1", type: "next", title: "Schick her", next: "ask" }],
        },
      ],
    },
    {
      id: "ask",
      type: "input",
      prompt: "Wohin darf ich sie schicken? Deine E-Mail:",
      inputType: "email",
      saveTo: "email",
      retryMessage: "Das sieht nicht nach einer E-Mail aus.",
      maxRetries: 1,
      next: "save",
      onFail: "link",
    },
    {
      id: "save",
      type: "action",
      actions: [
        { id: "a1", type: "add_tag", tag: "ad-matrix" },
        {
          id: "a2",
          type: "webhook",
          url: "https://n8n.example.com/webhook/lead",
          body: '{"email":"{{email}}","name":"{{username}}","lead_magnet":"ad-matrix"}',
          saveResponse: [{ path: "lead.id", key: "lead_id" }],
        },
      ],
      next: "link",
    },
    {
      id: "link",
      type: "message",
      contents: [
        {
          id: "t2",
          type: "text",
          text: "Hier ist sie:",
          buttons: [{ id: "u1", type: "url", title: "SOP öffnen", url: "https://docs.google.com/x", track: true }],
        },
      ],
    },
  ],
};

describe("FlowExecutor: Ad-Matrix comment funnel", () => {
  let t: ReturnType<typeof makeIO>;
  beforeEach(() => {
    t = makeIO();
  });

  it("sends the opener as the private reply, then waits for the tap", async () => {
    const ex = new FlowExecutor({ id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX }, run(), contact(), t.io);
    await ex.start();

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ viaComment: "c1", prepaid: true, nodeId: "opener" });
    const payload = (t.sent[0].body.attachment as { payload: { text: string; buttons: { payload: string }[] } }).payload;
    expect(payload.text).toBe("Hey lena.coach, die Ad-Matrix ist fertig.");
    expect(decodeFlowPayload(payload.buttons[0].payload)).toEqual({ flowId: "flow1", nodeId: "opener", buttonId: "b1" });
    expect(ex.getState()).toMatchObject({ status: "WAITING", waiting: { kind: "buttons", nodeId: "opener" }, sends: 1 });
  });

  it("collects the email (with one retry), saves it, calls the webhook and sends the tracked link", async () => {
    const ex = new FlowExecutor({ id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX }, run(), contact(), t.io);
    await ex.start();

    // The tap opens the window (the worker sets lastInboundAt on taps).
    const afterTap = new FlowExecutor(
      { id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX },
      ex.getState(),
      contact({ lastInboundAt: NOW }),
      t.io
    );
    await afterTap.onTap("opener", "b1");
    expect(t.sent[1]).toMatchObject({ viaComment: null, text: "Wohin darf ich sie schicken? Deine E-Mail:" });
    expect(afterTap.getState().waiting).toMatchObject({ kind: "input", nodeId: "ask" });

    expect(await afterTap.onInput("ähm keine ahnung")).toBe(true);
    expect(t.sent[2].text).toBe("Das sieht nicht nach einer E-Mail aus.");
    expect(afterTap.getState().waiting).toMatchObject({ kind: "input" });

    expect(await afterTap.onInput("klar: Lena@Coach.de")).toBe(true);
    expect(afterTap.getContact().email).toBe("lena@coach.de");
    expect(afterTap.getContact().tags).toEqual(["ad-matrix"]);
    expect(afterTap.getContact().customFields).toEqual({ lead_id: "L1" });
    expect(t.requests[0].body).toBe('{"email":"lena@coach.de","name":"lena.coach","lead_magnet":"ad-matrix"}');

    const link = t.sent[3].body.attachment as { payload: { buttons: { url: string; type: string }[] } };
    expect(link.payload.buttons[0]).toMatchObject({ type: "web_url", url: expect.stringContaining("https://app.test/f/u1") });
    expect(afterTap.getState()).toMatchObject({ status: "COMPLETED", waiting: null });
    expect(t.events.map((e) => e.type)).toEqual([
      "STARTED",
      "SENT",
      "CLICKED",
      "SENT",
      "INPUT_INVALID",
      "SENT",
      "INPUT_VALID",
      "ACTION",
      "ACTION",
      "SENT",
      "COMPLETED",
    ]);
  });

  it("treats a typed yes as the tap on a single-button comment opener", async () => {
    const ex = new FlowExecutor({ id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX }, run(), contact(), t.io);
    await ex.start();
    const replied = new FlowExecutor(
      { id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX },
      ex.getState(),
      contact({ lastInboundAt: NOW }),
      t.io
    );
    expect(await replied.onFreeTextWhileWaitingForTap()).toBe(true);
    expect(t.sent[1].text).toBe("Wohin darf ich sie schicken? Deine E-Mail:");
    expect(replied.getState().waiting).toMatchObject({ kind: "input", nodeId: "ask" });
  });

  it("takes onFail after too many invalid answers", async () => {
    const ex = new FlowExecutor(
      { id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX },
      run({ status: "WAITING", waiting: { kind: "input", nodeId: "ask", expiresAt: "2026-10-13T00:00:00Z" }, context: { trigger: "comment", commentId: "c1", interacted: true }, sends: 2 }),
      contact({ lastInboundAt: NOW }),
      t.io
    );
    await ex.onInput("nope");
    await ex.onInput("still nope");
    expect(t.sent.map((s) => s.text)).toEqual(["Das sieht nicht nach einer E-Mail aus.", expect.stringContaining("Hier ist sie:")]);
    expect(ex.getState().status).toBe("COMPLETED");
  });
});

describe("FlowExecutor: Instagram messaging rules", () => {
  it("parks after the private reply and resumes the same node once the contact replies", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "m",
      nodes: [
        {
          id: "m",
          type: "message",
          contents: [
            { id: "a", type: "text", text: "first" },
            { id: "b", type: "text", text: "second" },
          ],
        },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(), contact(), t.io);
    await ex.start();
    expect(t.sent.map((s) => s.text)).toEqual(["first"]);
    expect(ex.getState().waiting).toEqual({ kind: "interaction", nodeId: "m", contentIndex: 1 });

    const resumed = new FlowExecutor({ id: "f", name: "F", graph }, ex.getState(), contact({ lastInboundAt: NOW }), t.io);
    expect(await resumed.onInteraction()).toBe(true);
    expect(t.sent.map((s) => s.text)).toEqual(["first", "second"]);
    expect(resumed.getState().status).toBe("COMPLETED");
  });

  it("expires instead of sending when the 24h window is closed", async () => {
    const t = makeIO();
    const graph: FlowGraph = { startNodeId: "m", nodes: [{ id: "m", type: "message", contents: [{ id: "a", type: "text", text: "hi" }] }] };
    const ex = new FlowExecutor(
      { id: "f", name: "F", graph },
      run({ context: { trigger: "dm_keyword", interacted: true } }),
      contact({ lastInboundAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) }),
      t.io
    );
    await ex.start();
    expect(t.sent).toHaveLength(0);
    expect(ex.getState()).toMatchObject({ status: "EXPIRED" });
  });

  it("schedules a delay, waits, and continues when it fires", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "d",
      nodes: [
        { id: "d", type: "delay", seconds: 3600, next: "m" },
        { id: "m", type: "message", contents: [{ id: "a", type: "audio", mediaId: "asset1" }] },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run({ context: { trigger: "dm_keyword", interacted: true } }), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    expect(t.resumes).toEqual([{ nodeId: "d", delayMs: 3_600_000 }]);
    expect(ex.getState().waiting).toMatchObject({ kind: "delay", nodeId: "d" });

    await ex.onResume("d");
    expect(t.sent[0].body).toEqual({ attachment: { type: "audio", payload: { url: "https://app.test/api/media/asset1/file.pdf" } } });
    expect(t.sent[0].text).toBe("[Voice message]");
  });

  it("stops a runaway loop", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "a",
      nodes: [
        { id: "a", type: "action", actions: [], next: "b" },
        { id: "b", type: "action", actions: [], next: "a" },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(), contact(), t.io);
    await ex.start();
    expect(ex.getState()).toMatchObject({ status: "FAILED", lastError: expect.stringContaining("loop") });
  });

  it("fails the run with SEND_FAILED when Meta rejects a send", async () => {
    const t = makeIO({
      send: async () => {
        throw new Error("(#10) This message is sent outside of allowed window");
      },
    });
    const graph: FlowGraph = { startNodeId: "m", nodes: [{ id: "m", type: "message", contents: [{ id: "a", type: "text", text: "hi" }] }] };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(), contact(), t.io);
    await ex.start();
    expect(ex.getState()).toMatchObject({ status: "FAILED", sends: 0 });
    expect(t.events.map((e) => e.type)).toContain("SEND_FAILED");
  });
});

describe("FlowExecutor: review fixes", () => {
  it("ignores a double tap so a branch never sends twice", async () => {
    const t = makeIO();
    const ex = new FlowExecutor({ id: "flow1", name: "Ad-Matrix", graph: AD_MATRIX }, run(), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    expect(await ex.onTap("opener", "b1")).toBe(true);
    expect(await ex.onTap("opener", "b1")).toBe(false);
    expect(t.sent.map((s) => s.nodeId)).toEqual(["opener", "ask"]);
    t.advance(61_000);
    expect(await ex.onTap("opener", "b1")).toBe(true);
  });

  it("caps typing pauses per pass because the conversation lock is held", async () => {
    const slept: number[] = [];
    const t = makeIO({ sleep: async (ms) => void slept.push(ms) });
    const graph: FlowGraph = {
      startNodeId: "m",
      nodes: [
        {
          id: "m",
          type: "message",
          contents: [
            { id: "p1", type: "typing", seconds: 15 },
            { id: "a", type: "text", text: "one" },
            { id: "p2", type: "typing", seconds: 15 },
            { id: "b", type: "text", text: "two" },
          ],
        },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run({ context: { trigger: "dm_keyword", interacted: true } }), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    expect(slept).toEqual([15_000, 5_000]);
    expect(t.sent.map((s) => s.text)).toEqual(["one", "two"]);
  });
});

describe("FlowExecutor: routing", () => {
  const open = { context: { trigger: "dm_keyword" as const, interacted: true } };

  it("routes quick replies and attaches them to the last plain text block", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "q",
      nodes: [
        {
          id: "q",
          type: "message",
          contents: [{ id: "a", type: "text", text: "Coach oder Agentur?" }],
          quickReplies: [
            { id: "qa", title: "Coach", next: "coach" },
            { id: "qb", title: "Agentur", next: "agency" },
          ],
        },
        { id: "coach", type: "action", actions: [{ id: "x", type: "add_tag", tag: "coach" }] },
        { id: "agency", type: "action", actions: [{ id: "y", type: "add_tag", tag: "agency" }] },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(open), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    const replies = t.sent[0].body.quick_replies as { title: string; payload: string }[];
    expect(replies.map((r) => r.title)).toEqual(["Coach", "Agentur"]);
    await ex.onTap("q", "qb");
    expect(ex.getContact().tags).toEqual(["agency"]);
    expect(ex.getState().status).toBe("COMPLETED");
  });

  it("offers Skip on input steps and routes it to onFail", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "i",
      nodes: [
        { id: "i", type: "input", prompt: "Telefon?", inputType: "phone", saveTo: "phone", skipLabel: "Lieber nicht", next: null, onFail: "bye" },
        { id: "bye", type: "message", contents: [{ id: "a", type: "text", text: "Kein Problem." }] },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(open), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    const skip = (t.sent[0].body.quick_replies as { payload: string }[])[0];
    expect(decodeFlowPayload(skip.payload)?.buttonId).toBe(SKIP_BUTTON_ID);
    await ex.onTap("i", SKIP_BUTTON_ID);
    expect(t.sent[1].text).toBe("Kein Problem.");
  });

  it("evaluates conditions (follow status fails open) and sticks randomizer branches", async () => {
    const t = makeIO();
    const graph: FlowGraph = {
      startNodeId: "c",
      nodes: [
        {
          id: "c",
          type: "condition",
          match: "all",
          rules: [
            { id: "r1", subject: "follows", op: "is_true" },
            { id: "r2", subject: "email", op: "is_not_set" },
          ],
          next: "rand",
          elseNext: null,
        },
        {
          id: "rand",
          type: "randomizer",
          branches: [
            { id: "A", weight: 50, next: "tagA" },
            { id: "B", weight: 50, next: "tagB" },
          ],
        },
        { id: "tagA", type: "action", actions: [{ id: "x", type: "add_tag", tag: "A" }] },
        { id: "tagB", type: "action", actions: [{ id: "y", type: "add_tag", tag: "B" }] },
      ],
    };
    const ex = new FlowExecutor({ id: "f", name: "F", graph }, run(open), contact({ lastInboundAt: NOW }), t.io);
    await ex.start();
    expect(ex.getContact().tags).toEqual(["A"]);
    expect(ex.getState().context.randomizer).toEqual({ rand: "A" });
  });
});

describe("message builder limits", () => {
  it("trims plain text to Meta's 1000-byte cap, counting umlauts as two bytes", async () => {
    const { buildContentMessage } = await import("@/lib/flows/message-builder");
    const built = await buildContentMessage(
      { id: "t", type: "text", text: "ä".repeat(800) },
      {
        flowId: "f",
        nodeId: "n",
        mediaUrl: async () => null,
        linkUrl: async (_b, url) => url,
        render: (text) => text,
      }
    );
    const text = (built?.body as { text: string }).text;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(1000);
    expect(text.endsWith("…")).toBe(true);
  });
});
