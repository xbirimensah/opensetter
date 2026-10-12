import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db/client", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
// next-auth itself doesn't load under vitest; the config and callbacks are what's tested.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: Record<string, unknown>) => ({ id: options.id, type: "credentials", options }),
}));
vi.mock("next-auth/providers/resend", () => ({
  default: (options: Record<string, unknown>) => ({ id: "resend", type: "email", options }),
}));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: vi.fn(), getPrimaryWorkspace: vi.fn() }));
const throttle = { throttled: false };
const recordLoginFailure = vi.fn();
vi.mock("@/lib/login-throttle", () => ({
  isLoginThrottled: async () => throttle.throttled,
  recordLoginFailure,
  clearLoginFailures: vi.fn(),
  LOGIN_THROTTLE_MINUTES: 15,
}));

const { hashPassword, verifyPassword, passwordProblem } = await import("@/lib/password");
const { authConfig } = await import("@/lib/auth");

type Jwt = (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
const jwt = authConfig.callbacks.jwt as unknown as Jwt;
const passwordProvider = authConfig.providers[0] as unknown as {
  options: { authorize: (c: Record<string, unknown>) => Promise<unknown> };
};
const authorize = (c: Record<string, unknown>) => passwordProvider.options.authorize(c);

beforeEach(() => {
  findUnique.mockReset();
  recordLoginFailure.mockReset();
  throttle.throttled = false;
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("enforces length limits", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("a".repeat(201))).toMatch(/at most 200/);
    expect(passwordProblem("long enough pw")).toBeNull();
  });
});

describe("password authorize", () => {
  it("signs in with a matching email (any case) and password", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "max@example.de", name: null, image: null,
      passwordHash: await hashPassword("a strong password"),
    });
    const user = await authorize({ email: " Max@Example.de ", password: "a strong password" });
    expect(user).toMatchObject({ id: "u1" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "max@example.de" } }));
  });

  it("rejects wrong passwords, users without a password, and throttled emails", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "max@example.de", name: null, image: null,
      passwordHash: await hashPassword("a strong password"),
    });
    expect(await authorize({ email: "max@example.de", password: "wrong password" })).toBeNull();
    expect(recordLoginFailure).toHaveBeenCalledWith("max@example.de");

    findUnique.mockResolvedValue({ id: "u2", email: "a@b.de", name: null, image: null, passwordHash: null });
    expect(await authorize({ email: "a@b.de", password: "anything at all" })).toBeNull();

    throttle.throttled = true;
    expect(await authorize({ email: "max@example.de", password: "a strong password" })).toBeNull();
  });
});

describe("session rules", () => {
  it("stamps the sign-in time on login", async () => {
    const token = await jwt({ token: {}, user: { id: "u1" } });
    expect(token).toMatchObject({ sub: "u1" });
    expect(typeof token?.authAt).toBe("number");
  });

  it("ends sessions that started before a password change", async () => {
    findUnique.mockResolvedValue({ passwordUpdatedAt: new Date(2_000) });
    expect(await jwt({ token: { sub: "u1", authAt: 1_000 } })).toBeNull();
    expect(await jwt({ token: { sub: "u1", authAt: 3_000 } })).toMatchObject({ sub: "u1" });
  });

  it("ends sessions of deleted users and keeps the device that changed the password", async () => {
    findUnique.mockResolvedValue(null);
    expect(await jwt({ token: { sub: "gone", authAt: 1 } })).toBeNull();
    const updated = await jwt({ token: { sub: "u1", authAt: 1 }, trigger: "update" });
    expect((updated?.authAt as number) > 1).toBe(true);
  });
});
