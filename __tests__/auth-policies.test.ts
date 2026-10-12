import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn() },
  workspaceInvitation: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));

const { safeCallbackUrl } = await import("@/lib/safe-redirect");
const { isEmailAllowedToSignIn } = await import("@/lib/signup-policy");

describe("login callback URL", () => {
  it("keeps same-site paths", () => {
    expect(safeCallbackUrl("/flows?x=1#a", "/dashboard")).toBe("/flows?x=1#a");
    expect(safeCallbackUrl(undefined, "/dashboard")).toBe("/dashboard");
  });

  it("refuses everything a browser would send to another host", () => {
    for (const raw of ["//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "/%0a/evil.com".replace("%0a", "\n")]) {
      expect(safeCallbackUrl(raw, "/dashboard")).toBe("/dashboard");
    }
  });
});

describe("who gets an email sign-in link", () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.count.mockResolvedValue(3);
    db.workspaceInvitation.findFirst.mockResolvedValue(null);
    delete process.env.OPENSETTER_ALLOWED_EMAILS;
    delete process.env.OPENSETTER_OPERATOR_EMAILS;
  });

  it("refuses strangers on an instance that already has users", async () => {
    expect(await isEmailAllowedToSignIn("stranger@example.com")).toBe(false);
  });

  it("allows existing users, invitees and listed addresses", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: "u1" });
    expect(await isEmailAllowedToSignIn("Owner@Example.com")).toBe(true);
    db.workspaceInvitation.findFirst.mockResolvedValueOnce({ id: "i1" });
    expect(await isEmailAllowedToSignIn("invitee@example.com")).toBe(true);
    process.env.OPENSETTER_ALLOWED_EMAILS = "a@b.de, Friend@Example.com";
    expect(await isEmailAllowedToSignIn("friend@example.com")).toBe(true);
  });

  it("lets the very first user in on a fresh local install, but not in production", async () => {
    db.user.count.mockResolvedValue(0);
    expect(await isEmailAllowedToSignIn("installer@example.com")).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(await isEmailAllowedToSignIn("installer@example.com")).toBe(false);
    vi.unstubAllEnvs();
  });
});
