import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: mocks.create };
  }
  return { default: Anthropic };
});

import { cachedSystemBlocks, completeSetterPrompt } from "@/lib/ai-setter/llm";

const ENV_KEYS = ["AI_SETTER_PROVIDER", "AI_SETTER_MODEL", "ANTHROPIC_API_KEY"] as const;

describe("Anthropic prompt caching", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.AI_SETTER_PROVIDER = "anthropic";
    process.env.AI_SETTER_MODEL = "claude-sonnet-5";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] });
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("marks the stable system block for caching", () => {
    expect(cachedSystemBlocks("persona")).toEqual([
      { type: "text", text: "persona", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("sends the system prompt as a cached block, the conversation uncached", async () => {
    await completeSetterPrompt("You are the setter.", "<untrusted>hey</untrusted>");
    const [body, options] = mocks.create.mock.calls[0];
    expect(body.system).toEqual(cachedSystemBlocks("You are the setter."));
    expect(body.messages).toEqual([{ role: "user", content: "<untrusted>hey</untrusted>" }]);
    expect(options).toEqual({ timeout: 120_000 });
  });

  it("passes a short deadline through without retries", async () => {
    await completeSetterPrompt("system", "user", null, { timeoutMs: 8_000 });
    expect(mocks.create.mock.calls[0][1]).toEqual({ timeout: 8_000, maxRetries: 0 });
  });

  it("uses the cached block for a UI-selected Anthropic key too", async () => {
    await completeSetterPrompt("system", "user", {
      kind: "api",
      provider: "anthropic",
      apiStyle: "anthropic",
      apiKey: "sk-ant-ui",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-sonnet-5",
    } as never);
    expect(mocks.create.mock.calls[0][0].system).toEqual(cachedSystemBlocks("system"));
  });
});
