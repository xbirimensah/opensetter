import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: { set: vi.fn(), del: vi.fn() },
}));

vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => mocks.redis }));

import { alertChannelsFromEnv, sendOpsAlert } from "@/lib/ops/alerts";
import { FAILURES_BEFORE_ALERT, nextWatchStep } from "@/lib/ops/health-watch";
import type { HealthReport } from "@/lib/ops/health-checks";

const alert = { key: "health:degraded", level: "error" as const, title: "Health check failing", message: "Worker: no heartbeat" };

function report(healthy: boolean): HealthReport {
  return {
    healthy,
    checks: {
      database: { status: "ok" },
      redis: { status: "ok" },
      queue: { status: "ok" },
      worker: { healthy, heartbeat: null, ageMs: healthy ? 1000 : null },
    },
  };
}

describe("alert channels", () => {
  it("reads every configured channel from env", () => {
    const channels = alertChannelsFromEnv({
      ALERT_NTFY_URL: "https://ntfy.sh/topic",
      ALERT_TELEGRAM_BOT_TOKEN: "123:abc",
      ALERT_TELEGRAM_CHAT_ID: "42",
      ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/x",
      ALERT_EMAIL_TO: "a@example.com, b@example.com",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "OpenSetter <login@example.com>",
    });
    expect(channels.map((channel) => channel.kind)).toEqual(["ntfy", "telegram", "webhook", "email"]);
    expect(channels[3]).toMatchObject({ to: ["a@example.com", "b@example.com"], from: "OpenSetter <login@example.com>" });
  });

  it("needs both halves of telegram and a Resend key for email", () => {
    expect(alertChannelsFromEnv({ ALERT_TELEGRAM_BOT_TOKEN: "123:abc", ALERT_EMAIL_TO: "a@example.com" })).toEqual([]);
  });
});

describe("sendOpsAlert", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    mocks.redis.set.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing without a channel", async () => {
    expect(await sendOpsAlert(alert, {})).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to ntfy and telegram once, then drops repeats", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    mocks.redis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    const env = { ALERT_NTFY_URL: "https://ntfy.sh/topic", ALERT_TELEGRAM_BOT_TOKEN: "123:abc", ALERT_TELEGRAM_CHAT_ID: "42" };

    expect(await sendOpsAlert(alert, env)).toBe(2);
    expect(await sendOpsAlert(alert, env)).toBe(0);

    expect(mocks.redis.set).toHaveBeenCalledWith("alerts:sent:health:degraded", "1", "EX", 3600, "NX");
    const [ntfyUrl, ntfyInit] = fetchMock.mock.calls[0];
    expect(ntfyUrl).toBe("https://ntfy.sh/topic");
    expect(ntfyInit.headers.Title).toBe("[OpenSetter] Health check failing");
    expect(ntfyInit.body).toBe("Worker: no heartbeat");
    const [telegramUrl, telegramInit] = fetchMock.mock.calls[1];
    expect(telegramUrl).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(telegramInit.body)).toMatchObject({ chat_id: "42" });
  });

  it("never throws and keeps the bot token out of the log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error("fetch failed for https://api.telegram.org/bot123:abc/sendMessage"));
    mocks.redis.set.mockResolvedValue("OK");

    await expect(
      sendOpsAlert(alert, { ALERT_TELEGRAM_BOT_TOKEN: "123:abc", ALERT_TELEGRAM_CHAT_ID: "42" })
    ).resolves.toBe(0);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("123:abc");
    errorSpy.mockRestore();
  });

  it("falls back to in-process dedupe when Redis is down", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    mocks.redis.set.mockRejectedValue(new Error("ECONNREFUSED"));
    const env = { ALERT_WEBHOOK_URL: "https://hooks.example.com/x" };
    const redisDown = { ...alert, key: "redis-down-test" };
    expect(await sendOpsAlert(redisDown, env)).toBe(1);
    expect(await sendOpsAlert(redisDown, env)).toBe(0);
  });
});

describe("health watch", () => {
  it("alerts only after consecutive failures, once, then on recovery", () => {
    let state = { consecutiveFailures: 0, alerted: false };
    const actions: string[] = [];
    for (const healthy of [false, ...Array(FAILURES_BEFORE_ALERT).fill(false), false, true, true]) {
      const step = nextWatchStep(state, report(healthy));
      state = step.state;
      actions.push(step.action.kind);
    }
    expect(actions).toEqual(["none", "degraded", "none", "none", "recovered", "none"]);
  });

  it("does not page for a single blip", () => {
    const first = nextWatchStep({ consecutiveFailures: 0, alerted: false }, report(false));
    const second = nextWatchStep(first.state, report(true));
    expect([first.action.kind, second.action.kind]).toEqual(["none", "none"]);
  });

  it("names the failing check in the alert", () => {
    const step = nextWatchStep({ consecutiveFailures: 1, alerted: false }, report(false));
    expect(step.action).toEqual({ kind: "degraded", failures: ["Worker: no heartbeat (the DM worker is not running)"] });
  });
});
