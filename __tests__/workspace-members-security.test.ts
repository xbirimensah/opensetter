import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ context: { workspaceId: "ws1", userId: "admin1", role: "ADMIN" as string } }));
const db = vi.hoisted(() => ({
  workspaceMember: { findFirst: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
  workspaceInvitation: { findMany: vi.fn(async () => []), upsert: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => state.context,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

const { POST, PATCH, DELETE } = await import("@/app/api/workspace/members/route");

function req(body: unknown) {
  return new Request("https://app.test/api/workspace/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.context = { workspaceId: "ws1", userId: "admin1", role: "ADMIN" };
});

describe("workspace member rules", () => {
  it("never changes an existing member's role through an invite (no owner demotion)", async () => {
    db.workspaceMember.findFirst.mockResolvedValue({ id: "m-owner" });
    const res = await POST(req({ email: "owner@example.com", role: "MEMBER" }));
    expect(res.status).toBe(409);
    expect(db.workspaceMember.upsert).not.toHaveBeenCalled();
    expect(db.workspaceMember.update).not.toHaveBeenCalled();
  });

  it("invites existing users instead of adding them without consent", async () => {
    db.workspaceMember.findFirst.mockResolvedValue(null);
    const res = await POST(req({ email: "someone@example.com", role: "MEMBER" }));
    expect(res.status).toBe(200);
    expect(db.workspaceInvitation.upsert).toHaveBeenCalled();
    expect(db.workspaceMember.upsert).not.toHaveBeenCalled();
  });

  it("lets only the owner grant, change or remove admin rights", async () => {
    expect((await POST(req({ email: "x@example.com", role: "ADMIN" }))).status).toBe(403);

    db.workspaceMember.findFirst.mockResolvedValue({ id: "m2", userId: "u2", role: "ADMIN" });
    expect((await PATCH(req({ memberId: "m2", role: "MEMBER" }))).status).toBe(403);
    expect((await DELETE(req({ memberId: "m2" }))).status).toBe(403);
    expect(db.workspaceMember.delete).not.toHaveBeenCalled();

    state.context = { workspaceId: "ws1", userId: "owner1", role: "OWNER" };
    expect((await PATCH(req({ memberId: "m2", role: "MEMBER" }))).status).toBe(200);
  });

  it("hides invite links from plain members", async () => {
    state.context = { workspaceId: "ws1", userId: "m1", role: "MEMBER" };
    db.workspaceInvitation.findMany.mockResolvedValue([
      { id: "i1", email: "a@b.de", role: "MEMBER", token: "secret-token", expiresAt: new Date(), createdAt: new Date() },
    ] as never);
    const { GET } = await import("@/app/api/workspace/members/route");
    const body = await (await GET()).json();
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });
});
