/**
 * Inbox contact routes: PATCH /api/inbox/contacts/[id] and
 * POST /api/inbox/contacts/[id]/flow-run stay inside the caller's
 * workspace, validate input, and retry when a flow writes mid-edit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  loadInboxContact: vi.fn(),
  prisma: {
    dmConversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    flowRun: { updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
}));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/inbox/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbox/server")>()),
  loadInboxContact: mocks.loadInboxContact,
}));

import { PATCH } from "../app/api/inbox/contacts/[conversationId]/route";
import { POST } from "../app/api/inbox/contacts/[conversationId]/flow-run/route";

const contact = { conversationId: "c1", tags: [], customFields: {}, flowRun: null };
const row = {
  id: "c1",
  email: null,
  phone: null,
  tags: ["VIP"],
  customFields: {},
  updatedAt: new Date("2026-10-12T10:00:00Z"),
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/inbox/contacts/c1", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ conversationId: "c1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", role: "MEMBER" });
  mocks.loadInboxContact.mockResolvedValue(contact);
});

describe("PATCH /api/inbox/contacts/[conversationId]", () => {
  it("requires a session", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue(null);
    expect((await PATCH(request({ email: "a@b.co" }), params)).status).toBe(401);
  });

  it("rejects invalid bodies with a readable error", async () => {
    const res = await PATCH(request({ email: "nope" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter a valid email address.");
    expect((await PATCH(request("{"), params)).status).toBe(400);
  });

  it("404s for a conversation in another workspace", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(null);
    expect((await PATCH(request({ email: "a@b.co" }), params)).status).toBe(404);
    expect(mocks.prisma.dmConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", instagramAccount: { workspaceId: "ws1" } } })
    );
  });

  it("updates only when the row is unchanged since it was read", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(row);
    mocks.prisma.dmConversation.updateMany.mockResolvedValue({ count: 1 });
    const res = await PATCH(request({ addTags: ["lead"], email: "a@b.co" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).data.contact).toEqual(contact);
    const call = mocks.prisma.dmConversation.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "c1", updatedAt: row.updatedAt });
    expect(call.data).toMatchObject({ email: "a@b.co", tags: ["VIP", "lead"] });
    expect(call.data.emailCapturedAt).toBeInstanceOf(Date);
  });

  it("retries on a concurrent write and gives up with 409", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(row);
    mocks.prisma.dmConversation.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    expect((await PATCH(request({ addTags: ["lead"] }), params)).status).toBe(200);
    expect(mocks.prisma.dmConversation.updateMany).toHaveBeenCalledTimes(2);

    mocks.prisma.dmConversation.updateMany.mockReset();
    mocks.prisma.dmConversation.updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(request({ addTags: ["lead"] }), params)).status).toBe(409);
  });

  it("skips the write when nothing changes", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(row);
    expect((await PATCH(request({ addTags: ["vip"] }), params)).status).toBe(200);
    expect(mocks.prisma.dmConversation.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/inbox/contacts/[conversationId]/flow-run", () => {
  function stop(body: unknown) {
    return POST(
      new NextRequest("http://localhost/api/inbox/contacts/c1/flow-run", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      params
    );
  }

  it("only accepts the stop action", async () => {
    expect((await stop({ action: "pause" })).status).toBe(400);
  });

  it("cancels running and waiting runs of the conversation", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue({ id: "c1" });
    mocks.prisma.flowRun.updateMany.mockResolvedValue({ count: 1 });
    const res = await stop({ action: "stop" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.stopped).toBe(1);
    const call = mocks.prisma.flowRun.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ conversationId: "c1", status: { in: ["RUNNING", "WAITING"] } });
    expect(call.data.status).toBe("CANCELLED");
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });

  it("404s outside the workspace", async () => {
    mocks.prisma.dmConversation.findFirst.mockResolvedValue(null);
    expect((await stop({ action: "stop" })).status).toBe(404);
    expect(mocks.prisma.flowRun.updateMany).not.toHaveBeenCalled();
  });
});
