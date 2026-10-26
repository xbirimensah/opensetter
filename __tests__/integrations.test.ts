/**
 * Integrations: signed outgoing webhooks, API keys, the Settings routes
 * (owners and admins only) and the inbound /api/v1 routes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  redis: { incr: vi.fn(), expire: vi.fn() },
  safeRequest: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  audit: vi.fn(),
  startFlowForConversation: vi.fn(),
  updateContact: vi.fn(),
  prisma: {
    webhookEndpoint: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    apiKey: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn() },
    dmConversation: { findUnique: vi.fn(), findFirst: vi.fn() },
    instagramAccount: { findMany: vi.fn() },
    flow: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mocks.queueAdd }),
  getRedisConnection: () => mocks.redis,
  WEBHOOK_JOB_NAME: "deliver-webhook",
}));
vi.mock("@/lib/flows/safe-http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flows/safe-http")>()),
  safeRequest: mocks.safeRequest,
}));
vi.mock("@/lib/meta/oauth", () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ""),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/flows/service", () => ({ startFlowForConversation: mocks.startFlowForConversation }));
vi.mock("@/lib/inbox/contact-update", () => ({ updateContact: mocks.updateContact }));

import { contactChangeEvents, signPayload, verifySignature } from "@/lib/integrations/events";
import { deliverWebhook, emitWebhookEvent } from "@/lib/integrations/webhooks";
import { authenticateApiRequest, generateApiKey, hashApiKey, readApiKey } from "@/lib/integrations/api-keys";
import { POST as createWebhook } from "../app/api/integrations/webhooks/route";
import { POST as createKey } from "../app/api/integrations/api-keys/route";
import { POST as startFlow } from "../app/api/v1/flows/start/route";
import { POST as updateContactRoute } from "../app/api/v1/contacts/route";
import { proxy } from "@/proxy";

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}

const KEY = "os_" + "a".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.incr.mockResolvedValue(1);
  mocks.prisma.apiKey.findUnique.mockResolvedValue({ id: "k1", workspaceId: "ws1", revokedAt: null, lastUsedAt: null });
  mocks.prisma.apiKey.update.mockResolvedValue({});
  mocks.prisma.webhookEndpoint.update.mockResolvedValue({});
});

describe("webhook signatures", () => {
  it("verifies its own signature and rejects tampering or replays", () => {
    const body = JSON.stringify({ id: "evt_1", type: "test" });
    const header = signPayload("whsec_x", body, 1_800_000_000);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature("whsec_x", body, header, 1_800_000_010)).toBe(true);
    expect(verifySignature("whsec_x", body + " ", header, 1_800_000_010)).toBe(false);
    expect(verifySignature("whsec_other", body, header, 1_800_000_010)).toBe(false);
    expect(verifySignature("whsec_x", body, header, 1_800_001_000)).toBe(false);
    expect(verifySignature("whsec_x", body, "garbage", 1_800_000_010)).toBe(false);
  });
});

describe("contact change events", () => {
  it("emits one event per real change", () => {
    const before = { email: null, phone: "+491", tags: ["Lead"], customFields: { budget: 1 } };
    const events = contactChangeEvents(before, {
      email: "a@b.de",
      phone: "+491",
      tags: ["Lead", "lead", "webinar"],
      customFields: { budget: 1, goal: "Kurs" },
    });
    expect(events).toEqual([
      { type: "contact.email_captured", data: { email: "a@b.de" } },
      { type: "contact.tag_added", data: { tag: "webinar" } },
      { type: "contact.field_set", data: { key: "goal", value: "Kurs" } },
    ]);
    expect(contactChangeEvents(before, { email: null })).toEqual([]);
  });
});

describe("emit and deliver", () => {
  it("queues one signed-body job per subscribed endpoint", async () => {
    mocks.prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    expect(await emitWebhookEvent("ws1", "flow.completed", { flow: { id: "f1" } })).toBe(2);
    expect(mocks.prisma.webhookEndpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws1", isActive: true, events: { has: "flow.completed" } } })
    );
    const [name, job, opts] = mocks.queueAdd.mock.calls[0];
    expect(name).toBe("deliver-webhook");
    expect(JSON.parse(job.body)).toMatchObject({ type: "flow.completed", workspaceId: "ws1", data: { flow: { id: "f1" } } });
    expect(opts).toMatchObject({ jobId: `webhook_${job.eventId}_e1`, attempts: 6 });
  });

  it("never throws when the queue is down", async () => {
    mocks.prisma.webhookEndpoint.findMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(emitWebhookEvent("ws1", "flow.completed", {})).resolves.toBe(0);
  });

  it("posts with a verifiable signature and throws on failure so BullMQ retries", async () => {
    mocks.prisma.webhookEndpoint.findUnique.mockResolvedValue({ id: "e1", url: "https://hooks.example.com/x", secret: "enc:whsec_s", isActive: true });
    const body = JSON.stringify({ id: "evt_9", type: "contact.tag_added" });
    mocks.safeRequest.mockResolvedValueOnce({ ok: true, status: 200, json: null });
    await deliverWebhook({ endpointId: "e1", body, eventId: "evt_9" });
    const [{ url, headers, body: sent }] = mocks.safeRequest.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/x");
    expect(sent).toBe(body);
    expect(headers["X-OpenSetter-Event"]).toBe("contact.tag_added");
    expect(verifySignature("whsec_s", body, headers["X-OpenSetter-Signature"])).toBe(true);
    expect(mocks.prisma.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 200, lastError: null }) })
    );

    mocks.safeRequest.mockResolvedValueOnce({ ok: false, status: 500, json: null });
    await expect(deliverWebhook({ endpointId: "e1", body, eventId: "evt_9" })).rejects.toThrow(/HTTP 500/);
  });

  it("drops events for removed or paused endpoints", async () => {
    mocks.prisma.webhookEndpoint.findUnique.mockResolvedValue({ id: "e1", url: "https://x.example", secret: "enc:s", isActive: false });
    await deliverWebhook({ endpointId: "e1", body: "{}", eventId: "evt_1" });
    expect(mocks.safeRequest).not.toHaveBeenCalled();
  });
});

describe("API keys", () => {
  it("stores only a hash and reads Bearer or X-API-Key", () => {
    const { key, prefix, keyHash } = generateApiKey();
    expect(key).toMatch(/^os_[\w-]{40}$/);
    expect(prefix).toBe(key.slice(0, 10));
    expect(keyHash).toBe(hashApiKey(key));
    expect(keyHash).not.toContain(key);
    expect(readApiKey(new Request("http://x", { headers: { authorization: `Bearer ${KEY}` } }))).toBe(KEY);
    expect(readApiKey(new Request("http://x", { headers: { "x-api-key": KEY } }))).toBe(KEY);
    expect(readApiKey(new Request("http://x", { headers: { authorization: "Bearer sk-not-ours" } }))).toBeNull();
  });

  it("rejects missing, revoked and over-limit keys", async () => {
    expect((await authenticateApiRequest(new Request("http://x"))).ok).toBe(false);

    mocks.prisma.apiKey.findUnique.mockResolvedValueOnce({ id: "k1", workspaceId: "ws1", revokedAt: new Date(), lastUsedAt: null });
    const revoked = await authenticateApiRequest(new Request("http://x", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(revoked.ok ? 200 : revoked.response.status).toBe(401);

    mocks.redis.incr.mockResolvedValueOnce(61);
    const limited = await authenticateApiRequest(new Request("http://x", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(limited.ok ? 200 : limited.response.status).toBe(429);

    const ok = await authenticateApiRequest(new Request("http://x", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(ok).toEqual({ ok: true, caller: { workspaceId: "ws1", keyId: "k1" } });
    expect(mocks.prisma.apiKey.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { keyHash: hashApiKey(KEY) } }));
  });
});

describe("Settings integration routes", () => {
  it("are for owners and admins only", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", userId: "u1", role: "MEMBER" });
    const res = await createWebhook(jsonRequest("http://localhost/api/integrations/webhooks", { url: "https://hooks.example.com", events: ["flow.completed"] }));
    expect(res.status).toBe(403);
  });

  it("creates an endpoint with an encrypted secret shown once", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", userId: "u1", role: "ADMIN" });
    mocks.prisma.webhookEndpoint.count.mockResolvedValue(0);
    mocks.prisma.webhookEndpoint.create.mockImplementation(async ({ data }) => ({
      id: "e1",
      url: data.url,
      events: data.events,
      isActive: true,
      lastDeliveryAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: new Date(),
    }));
    const res = await createWebhook(
      jsonRequest("http://localhost/api/integrations/webhooks", { url: "https://hooks.zapier.com/x", events: ["flow.completed", "flow.completed"] })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.secret).toMatch(/^whsec_/);
    expect(body.data.endpoint).not.toHaveProperty("secret");
    const stored = mocks.prisma.webhookEndpoint.create.mock.calls[0][0].data;
    expect(stored.secret).toBe(`enc:${body.data.secret}`);
    expect(stored.events).toEqual(["flow.completed"]);
  });

  it("refuses http, private and unknown-event endpoints", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", userId: "u1", role: "OWNER" });
    for (const payload of [
      { url: "http://hooks.example.com", events: ["flow.completed"] },
      { url: "https://127.0.0.1/hook", events: ["flow.completed"] },
      { url: "https://intranet.local/hook", events: ["flow.completed"] },
      { url: "https://hooks.example.com", events: ["contact.deleted"] },
      { url: "https://hooks.example.com", events: [] },
    ]) {
      expect((await createWebhook(jsonRequest("http://localhost/api/integrations/webhooks", payload))).status).toBe(400);
    }
  });

  it("creates an API key and stores only its hash", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", userId: "u1", role: "OWNER" });
    mocks.prisma.apiKey.count.mockResolvedValue(0);
    mocks.prisma.apiKey.create.mockImplementation(async ({ data }) => ({ id: "k1", name: data.name, prefix: data.prefix, lastUsedAt: null, createdAt: new Date() }));
    const res = await createKey(jsonRequest("http://localhost/api/integrations/api-keys", { name: "Zapier" }));
    const body = await res.json();
    const stored = mocks.prisma.apiKey.create.mock.calls[0][0].data;
    expect(stored.keyHash).toBe(hashApiKey(body.data.secret));
    expect(JSON.stringify(stored)).not.toContain(body.data.secret);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "api_keys.created" }));
  });
});

describe("/api/v1", () => {
  const auth = { authorization: `Bearer ${KEY}` };
  const flowRow = {
    id: "f1",
    status: "ACTIVE",
    instagramAccount: { id: "acc1", instagramId: "1784", workspaceId: "ws1", accessToken: "enc" },
  };

  it("needs an API key, never the session cookie", async () => {
    const res = await startFlow(jsonRequest("http://localhost/api/v1/flows/start", { flowId: "f1", contact: { contactId: "1" } }, { cookie: "authjs.session-token=abc" }));
    expect(res.status).toBe(401);
  });

  it("starts a flow for a known contact inside the key's workspace", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(flowRow);
    mocks.prisma.dmConversation.findFirst.mockResolvedValue({ id: "c1" });
    mocks.startFlowForConversation.mockResolvedValue({ id: "run1", status: "WAITING", sends: 1 });
    const res = await startFlow(jsonRequest("http://localhost/api/v1/flows/start", { flowId: "f1", contact: { username: "@Lena.Coach" } }, auth));
    expect(await res.json()).toEqual({ success: true, data: { runId: "run1", status: "WAITING", messagesSent: 1 } });
    expect(mocks.prisma.flow.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "f1", workspaceId: "ws1" } }));
    expect(mocks.prisma.dmConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { instagramAccountId: "acc1", participantUsername: { equals: "Lena.Coach", mode: "insensitive" } } })
    );
    expect(mocks.startFlowForConversation).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1", context: { trigger: "api" } }));
  });

  it("explains the 24h window instead of failing silently", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(flowRow);
    mocks.prisma.dmConversation.findFirst.mockResolvedValue({ id: "c1" });
    mocks.startFlowForConversation.mockResolvedValue({ id: "run1", status: "EXPIRED", sends: 0 });
    const res = await startFlow(jsonRequest("http://localhost/api/v1/flows/start", { flowId: "f1", contact: { contactId: "1789" } }, auth));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/24h messaging window/);
  });

  it("404s for a flow of another workspace", async () => {
    mocks.prisma.flow.findFirst.mockResolvedValue(null);
    const res = await startFlow(jsonRequest("http://localhost/api/v1/flows/start", { flowId: "f9", contact: { contactId: "1" } }, auth));
    expect(res.status).toBe(404);
  });

  it("updates a contact with the inbox's validation rules", async () => {
    mocks.prisma.instagramAccount.findMany.mockResolvedValue([{ id: "acc1", instagramId: "1", workspaceId: "ws1", accessToken: "x", username: "me" }]);
    mocks.prisma.dmConversation.findFirst.mockResolvedValue({ id: "c1" });
    mocks.prisma.dmConversation.findUnique.mockResolvedValue({
      id: "c1",
      instagramAccountId: "acc1",
      participantId: "1789",
      participantUsername: "lena",
      email: "a@b.de",
      phone: null,
      tags: ["paid"],
      customFields: {},
      instagramAccount: { workspaceId: "ws1" },
    });
    mocks.updateContact.mockResolvedValue({ ok: true, changed: true });
    const res = await updateContactRoute(
      jsonRequest("http://localhost/api/v1/contacts", { contact: { email: "a@b.de" }, update: { addTags: ["paid"] } }, auth)
    );
    const body = await res.json();
    expect(body.data).toMatchObject({ changed: true, contact: { participantId: "1789", tags: ["paid"] } });
    expect(body.data.contact).not.toHaveProperty("workspaceId");
    expect(mocks.updateContact).toHaveBeenCalledWith("c1", "ws1", { addTags: ["paid"] });

    const bad = await updateContactRoute(jsonRequest("http://localhost/api/v1/contacts", { contact: { email: "a@b.de" }, update: { email: "nope" } }, auth));
    expect(bad.status).toBe(400);
  });

  it("is not blocked by the browser CSRF guard (servers call it)", () => {
    const res = proxy(
      new NextRequest("http://127.0.0.1:8310/api/v1/flows/start", {
        method: "POST",
        headers: { host: "opensetter.example.com", origin: "https://hooks.zapier.com", "content-type": "application/json", "content-length": "2" },
        body: "{}",
      })
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
