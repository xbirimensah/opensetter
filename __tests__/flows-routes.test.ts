/**
 * Flow API with comment triggers: GET merges a flow's Automation rows into
 * its trigger list; PUT syncs them back (create / update / delete in one
 * transaction, isActive following the flow status, stale rows refused);
 * DELETE removes the flow and its comment triggers together; POST builds
 * a flow from a campaign template.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const prisma = {
    flow: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    flowRun: { count: vi.fn(), groupBy: vi.fn() },
    automation: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    mediaAsset: { findMany: vi.fn() },
    instagramAccount: { findFirst: vi.fn(), findMany: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return { prisma, getCurrentWorkspaceContext: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { DELETE, GET, PUT } from "../app/api/flows/[id]/route";
import { POST } from "../app/api/flows/route";

const VERSION = new Date("2026-10-12T08:00:00.000Z");

const adMatrixRow = {
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
  publicReplyMessages: ["Ist raus, schau in deine DMs", "Hab dir geschrieben, check deine Nachrichten"],
  aiPersonalizeDm: false,
  updatedAt: VERSION,
};

const graph = {
  startNodeId: "opener",
  nodes: [
    {
      id: "opener",
      type: "message",
      contents: [{ id: "t1", type: "text", text: "Hey", buttons: [{ id: "b1", type: "next", title: "Ja", next: null }] }],
    },
  ],
};

function flowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "flow1",
    workspaceId: "ws1",
    instagramAccountId: "acc1",
    name: "Ad-Matrix SOP (Kommentar Matrix)",
    status: "ACTIVE",
    graph,
    triggers: [],
    instagramAccount: { id: "acc1", username: "example.creator", name: null },
    automations: [adMatrixRow],
    createdAt: VERSION,
    updatedAt: VERSION,
    ...overrides,
  };
}

function request(body: unknown, method = "PUT") {
  return new NextRequest("http://localhost/api/flows/flow1", { method, body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ id: "flow1" }) };

const loadedTrigger = {
  id: "cmatrix0001",
  type: "comment",
  automationId: "cmatrix0001",
  postId: null,
  postUrl: null,
  matchAnyPost: true,
  pendingNextReel: false,
  keywords: ["matrix"],
  matchAnyWord: false,
  wholeWordMatch: true,
  publicReplyEnabled: true,
  publicReplyMessages: ["Ist raus, schau in deine DMs", "Hab dir geschrieben, check deine Nachrichten"],
  aiPersonalizeOpener: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", role: "OWNER" });
  mocks.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(mocks.prisma) : Promise.all(arg as Promise<unknown>[])
  );
  mocks.prisma.flow.findFirst.mockResolvedValue(flowRow());
  mocks.prisma.flow.findMany.mockResolvedValue([]);
  mocks.prisma.flow.update.mockResolvedValue({});
  mocks.prisma.flowRun.count.mockResolvedValue(0);
  // Inside the save transaction the route re-reads the flow's comment rows
  // (under a row lock): by default they are still the ones it loaded.
  mocks.prisma.automation.findMany.mockImplementation(async (args?: { where?: { flowId?: string } }) => {
    if (!args?.where?.flowId) return [];
    const results = mocks.prisma.flow.findFirst.mock.results;
    const loaded = results.length ? await results[0].value : null;
    return ((loaded?.automations ?? []) as { id: string }[]).map((row) => ({ id: row.id }));
  });
  mocks.prisma.automation.create.mockResolvedValue({ id: "cnew0002" });
  mocks.prisma.automation.update.mockResolvedValue({});
  mocks.prisma.automation.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.automation.deleteMany.mockResolvedValue({ count: 1 });
  mocks.prisma.mediaAsset.findMany.mockResolvedValue([]);
});

describe("GET /api/flows/:id", () => {
  it("merges the comment campaign into the trigger list", async () => {
    const res = await GET(request(undefined, "GET"), params);
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload.data.triggers).toEqual([{ ...loadedTrigger, version: VERSION.toISOString() }]);
    expect(payload.data.triggerVersions).toEqual({ cmatrix0001: VERSION.toISOString() });
    expect(payload.validation.errors).toEqual([]);
  });

  it("stays inside the caller's workspace", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(null);
    expect((await GET(request(undefined, "GET"), params)).status).toBe(404);
    expect(mocks.prisma.flow.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "flow1", workspaceId: "ws1" } }));
  });
});

describe("PUT /api/flows/:id", () => {
  it("saving the Ad-Matrix flow unchanged writes nothing to its comment trigger", async () => {
    const res = await PUT(request({ graph, triggers: [loadedTrigger], triggerVersions: { cmatrix0001: VERSION.toISOString() } }), params);
    expect(res.status).toBe(200);
    expect(mocks.prisma.automation.create).not.toHaveBeenCalled();
    expect(mocks.prisma.automation.update).not.toHaveBeenCalled();
    expect(mocks.prisma.automation.deleteMany).not.toHaveBeenCalled();
    // isActive is only touched on rows that disagree with the (still live) flow.
    expect(mocks.prisma.automation.updateMany).toHaveBeenCalledWith({
      where: { flowId: "flow1", isActive: false },
      data: { isActive: true },
    });
    expect((await res.json()).data.idMap).toEqual({ cmatrix0001: "cmatrix0001" });
  });

  it("creates, updates and deletes comment trigger rows in one transaction", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(
      flowRow({ status: "DRAFT", automations: [adMatrixRow, { ...adMatrixRow, id: "cold0003", name: "Old" }] })
    );
    const fresh = { ...loadedTrigger, id: "t_new", automationId: undefined, keywords: ["GUIDE"], publicReplyEnabled: false, publicReplyMessages: [] };
    const res = await PUT(
      request({ graph, triggers: [{ ...loadedTrigger, keywords: ["matrix", "ads"] }, fresh] }),
      params
    );
    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.automation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["cold0003"] }, flowId: "flow1" } });
    expect(mocks.prisma.automation.update).toHaveBeenCalledWith({ where: { id: "cmatrix0001" }, data: { keywords: ["matrix", "ads"] } });
    expect(mocks.prisma.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Ad-Matrix SOP (Kommentar Matrix) (comment 2)",
        keywords: ["GUIDE"],
        matchAnyPost: true,
        dmMessage: "",
        flowId: "flow1",
        isActive: false,
        workspaceId: "ws1",
        instagramAccountId: "acc1",
      }),
      select: { id: true },
    });
    expect((await res.json()).data.idMap).toEqual({ cmatrix0001: "cmatrix0001", t_new: "cnew0002" });
  });

  it("turns every comment trigger off when the flow is paused", async () => {
    const res = await PUT(request({ status: "PAUSED" }), params);
    expect(res.status).toBe(200);
    expect(mocks.prisma.flow.update).toHaveBeenCalledWith({ where: { id: "flow1" }, data: { status: "PAUSED" } });
    expect(mocks.prisma.automation.updateMany).toHaveBeenCalledWith({
      where: { flowId: "flow1", isActive: true },
      data: { isActive: false },
    });
  });

  it("refuses to go live while a comment trigger is incomplete", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(flowRow({ status: "DRAFT", automations: [] }));
    const incomplete = { ...loadedTrigger, id: "t_x", automationId: undefined, matchAnyPost: false, keywords: [] };
    const res = await PUT(request({ status: "ACTIVE", graph, triggers: [incomplete] }), params);
    const payload = await res.json();
    expect(res.status).toBe(400);
    expect(payload.errors).toContain("Comment trigger 1: choose a post or reel, any post, or your next reel.");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("sends a stale comment trigger back for a refresh instead of overwriting it", async () => {
    const bound = { ...adMatrixRow, matchAnyPost: false, postId: "1789", updatedAt: new Date("2026-10-12T09:00:00.000Z") };
    mocks.prisma.flow.findFirst.mockResolvedValue(flowRow({ automations: [bound] }));
    const res = await PUT(
      request({ graph, triggers: [{ ...loadedTrigger, keywords: ["matrix", "x"] }], triggerVersions: { cmatrix0001: VERSION.toISOString() } }),
      params
    );
    const payload = await res.json();
    expect(res.status).toBe(409);
    expect(payload.conflicts[0]).toMatchObject({ clientId: "cmatrix0001", trigger: { postId: "1789", matchAnyPost: false } });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed comment triggers", async () => {
    const res = await PUT(request({ triggers: [{ ...loadedTrigger, keywords: ["x".repeat(60)] }] }), params);
    expect(res.status).toBe(400);
  });

  it("requires an owner or admin", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", role: "MEMBER" });
    expect((await PUT(request({ name: "x" }), params)).status).toBe(403);
  });
});

describe("DELETE /api/flows/:id", () => {
  it("deletes the flow and its comment triggers together", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue({ id: "flow1", name: "Ad-Matrix" });
    mocks.prisma.flow.delete.mockResolvedValue({});
    const res = await DELETE(request(undefined, "DELETE"), params);
    expect(res.status).toBe(200);
    expect(mocks.prisma.automation.deleteMany).toHaveBeenCalledWith({ where: { flowId: "flow1", workspaceId: "ws1" } });
    expect(mocks.prisma.flow.delete).toHaveBeenCalledWith({ where: { id: "flow1" } });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((await res.json()).data).toEqual({ deleted: true, commentTriggers: 1 });
  });

  it("still refuses while another flow starts this one", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue({ id: "flow1", name: "Ad-Matrix" });
    mocks.prisma.flow.findMany.mockResolvedValue([
      { id: "flow2", name: "Other", graph: { startNodeId: "s", nodes: [{ id: "s", type: "start_flow", flowId: "flow1" }] } },
    ]);
    expect((await DELETE(request(undefined, "DELETE"), params)).status).toBe(409);
    expect(mocks.prisma.automation.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/flows", () => {
  it("builds a draft flow from a campaign template with an inactive comment trigger", async () => {
    mocks.prisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc1" });
    mocks.prisma.flow.create.mockResolvedValue({ id: "flowT" });
    mocks.prisma.flow.findFirstOrThrow.mockResolvedValue(flowRow({ id: "flowT", status: "DRAFT", automations: [] }));
    const res = await POST(
      new NextRequest("http://localhost/api/flows", { method: "POST", body: JSON.stringify({ template: "fitness-plan" }) })
    );
    expect(res.status).toBe(201);
    expect(mocks.prisma.instagramAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws1" } }));
    expect(mocks.prisma.flow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Fitness Plan Download", status: "DRAFT", instagramAccountId: "acc1" }),
    });
    expect(mocks.prisma.automation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ flowId: "flowT", isActive: false, dmMessage: "", name: "Fitness Plan Download" }),
    });
  });

  it("rejects unknown templates", async () => {
    const res = await POST(new NextRequest("http://localhost/api/flows", { method: "POST", body: JSON.stringify({ template: "nope" }) }));
    expect(res.status).toBe(400);
  });
});

describe("concurrent flow saves", () => {
  it("answers 409 instead of creating duplicate triggers when another save got there first", async () => {
    mocks.prisma.automation.findMany.mockImplementation(async (args?: { where?: { flowId?: string } }) =>
      args?.where?.flowId ? [{ id: "cmatrix0001" }, { id: "row-another-save-created" }] : []
    );
    const response = await PUT(request({ status: "PAUSED" }), params);
    expect(response.status).toBe(409);
    expect(mocks.prisma.flow.update).not.toHaveBeenCalled();
  });
});
