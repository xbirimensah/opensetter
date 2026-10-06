/**
 * AI Provider Credentials - Security Tests
 *
 * Provider API keys are write-only from the browser's point of view:
 * encrypted at rest with a dedicated env key bound to workspace and
 * provider, never returned after save, never logged, and the whole
 * feature fails closed when the encryption key is missing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    aiProviderCredential: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));

import {
  CREDENTIALS_KEY_ENV,
  decryptCredential,
  encryptCredential,
  fingerprintCredential,
  getCredentialEncryptionReadiness,
} from "../lib/ai-setter/providers/credential-crypto";
import {
  PROVIDER_CATALOG,
  isProviderId,
} from "../lib/ai-setter/providers/catalog";
import {
  isPrivateAddress,
  validateProviderBaseUrl,
} from "../lib/ai-setter/providers/base-url";
import { rejectPrivateResolution } from "../lib/ai-setter/providers/guarded-request";
import {
  listProviderStatuses,
  saveProviderCredential,
} from "../lib/ai-setter/providers/credentials";
import {
  LlmConfigurationError,
  resolveLlmTarget,
} from "../lib/ai-setter/providers/resolve";
import { redactSecret } from "../lib/ai-setter/llm";

const TEST_KEY = "a".repeat(64);
const SECRET = "sk-ant-api03-SUPERSECRETVALUE1234567890";
const context = { workspaceId: "ws_1", provider: "anthropic" as const };

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = { ...process.env };
  process.env[CREDENTIALS_KEY_ENV] = TEST_KEY;
});

afterEach(() => {
  process.env = savedEnv;
});

describe("credential encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptCredential(SECRET, context);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain(SECRET);
    expect(decryptCredential(sealed, context)).toBe(SECRET);
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptCredential(SECRET, context)).not.toBe(encryptCredential(SECRET, context));
  });

  it("refuses to decrypt a ciphertext moved to another workspace or provider", () => {
    const sealed = encryptCredential(SECRET, context);
    expect(() => decryptCredential(sealed, { ...context, workspaceId: "ws_2" })).toThrow();
    expect(() => decryptCredential(sealed, { ...context, provider: "openai" })).toThrow();
  });

  it("fails closed with an actionable status when the key is missing", () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    const readiness = getCredentialEncryptionReadiness();
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) {
      expect(readiness.reason).toBe("missing");
      expect(readiness.message).toContain(CREDENTIALS_KEY_ENV);
      expect(readiness.message).toContain("openssl rand -hex 32");
    }
    expect(() => encryptCredential(SECRET, context)).toThrow(CREDENTIALS_KEY_ENV);
  });

  it("rejects a malformed key", () => {
    process.env[CREDENTIALS_KEY_ENV] = "too-short";
    const readiness = getCredentialEncryptionReadiness();
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) expect(readiness.reason).toBe("malformed");
  });

  it("fingerprints without revealing any characters of the key", () => {
    const fingerprint = fingerprintCredential(SECRET);
    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(SECRET).not.toContain(fingerprint);
    expect(SECRET.slice(-4)).not.toBe(fingerprint.slice(-4));
  });
});

describe("provider catalog", () => {
  it("covers every required provider", () => {
    for (const id of ["anthropic", "openai", "gemini", "xai", "openrouter", "openai-compatible"]) {
      expect(isProviderId(id)).toBe(true);
    }
    expect(isProviderId("evil")).toBe(false);
    expect(PROVIDER_CATALOG.openai.suggestedModels.some((m) => m.includes("codex"))).toBe(true);
    expect(PROVIDER_CATALOG["openai-compatible"].requiresBaseUrl).toBe(true);
  });
});

describe("base URL safety", () => {
  it("requires https and rejects embedded credentials", () => {
    expect(validateProviderBaseUrl("http://api.example.com/v1", { allowPrivate: false }).ok).toBe(false);
    expect(validateProviderBaseUrl("https://user:pw@api.example.com/v1", { allowPrivate: false }).ok).toBe(false);
    expect(validateProviderBaseUrl("not a url", { allowPrivate: false }).ok).toBe(false);
    expect(validateProviderBaseUrl("https://api.example.com/v1", { allowPrivate: false }).ok).toBe(true);
  });

  it("blocks private and metadata addresses unless explicitly allowed", () => {
    for (const url of [
      "https://169.254.169.254/latest",
      "https://10.0.0.5/v1",
      "https://192.168.1.10/v1",
      "https://localhost:11434/v1",
      "https://[::1]/v1",
    ]) {
      expect(validateProviderBaseUrl(url, { allowPrivate: false }).ok).toBe(false);
    }
    expect(validateProviderBaseUrl("http://localhost:11434/v1", { allowPrivate: true }).ok).toBe(true);
  });

  it("blocks IPv6 forms that embed a private IPv4 address", () => {
    for (const url of [
      "https://[::ffff:169.254.169.254]/v1",
      "https://[::ffff:7f00:1]/v1",
      "https://[64:ff9b::a9fe:a9fe]/v1",
      "https://[2002:a9fe:a9fe::1]/v1",
      "https://[fec0::1]/v1",
    ]) {
      expect(validateProviderBaseUrl(url, { allowPrivate: false }).ok).toBe(false);
    }
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("192.0.0.8")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("rejects DNS answers that point at private addresses (rebinding)", () => {
    expect(rejectPrivateResolution(["93.184.216.34"], false)).toBeNull();
    expect(rejectPrivateResolution(["93.184.216.34", "169.254.169.254"], false)).toBeInstanceOf(Error);
    expect(rejectPrivateResolution(["127.0.0.1"], true)).toBeNull();
  });

  it("classifies addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.20.1.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

describe("credential store", () => {
  it("saves encrypted material only and returns a public view", async () => {
    mocks.prisma.aiProviderCredential.upsert.mockImplementation(async (args) => ({
      provider: "anthropic",
      keyFingerprint: args.create.keyFingerprint,
      baseUrl: null,
      defaultModel: "claude-opus-5-5",
      updatedAt: new Date("2026-10-01"),
      encryptedKey: args.create.encryptedKey,
    }));

    const result = await saveProviderCredential({
      workspaceId: "ws_1",
      provider: "anthropic",
      apiKey: `  ${SECRET}  `,
      baseUrl: null,
      defaultModel: "claude-opus-5-5",
      userId: "user_1",
    });

    const args = mocks.prisma.aiProviderCredential.upsert.mock.calls[0][0];
    expect(JSON.stringify(args)).not.toContain(SECRET);
    expect(decryptCredential(args.create.encryptedKey, context)).toBe(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).not.toHaveProperty("encryptedKey");
    expect(result.configured).toBe(true);
  });

  it("refuses to save when encryption is unavailable", async () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    await expect(
      saveProviderCredential({
        workspaceId: "ws_1",
        provider: "anthropic",
        apiKey: SECRET,
        baseUrl: null,
        defaultModel: null,
        userId: "user_1",
      })
    ).rejects.toThrow(CREDENTIALS_KEY_ENV);
    expect(mocks.prisma.aiProviderCredential.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unsafe base URL for the generic provider", async () => {
    await expect(
      saveProviderCredential({
        workspaceId: "ws_1",
        provider: "openai-compatible",
        apiKey: SECRET,
        baseUrl: "https://169.254.169.254/v1",
        defaultModel: "llama",
        userId: "user_1",
      })
    ).rejects.toThrow();
  });

  it("lists every provider without any secret material", async () => {
    mocks.prisma.aiProviderCredential.findMany.mockResolvedValue([
      {
        provider: "openai",
        keyFingerprint: "abc123abc123",
        encryptedKey: encryptCredential(SECRET, { workspaceId: "ws_1", provider: "openai" }),
        baseUrl: null,
        defaultModel: "gpt-5-codex",
        updatedAt: new Date("2026-10-01"),
      },
    ]);
    const statuses = await listProviderStatuses("ws_1");
    expect(statuses).toHaveLength(Object.keys(PROVIDER_CATALOG).length);
    const openai = statuses.find((status) => status.provider === "openai");
    expect(openai?.configured).toBe(true);
    expect(openai?.keyFingerprint).toBe("abc123abc123");
    const serialized = JSON.stringify(statuses);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("v1:");
  });
});

describe("runtime resolution", () => {
  it("returns null so the env-based provider stays the fallback", async () => {
    expect(await resolveLlmTarget({ workspaceId: "ws_1", provider: null, model: null })).toBeNull();
  });

  it("decrypts the selected provider's key and applies the model choice", async () => {
    mocks.prisma.aiProviderCredential.findUnique.mockResolvedValue({
      provider: "gemini",
      encryptedKey: encryptCredential(SECRET, { workspaceId: "ws_1", provider: "gemini" }),
      baseUrl: null,
      defaultModel: "gemini-2.5-pro",
    });
    const target = await resolveLlmTarget({ workspaceId: "ws_1", provider: "gemini", model: "gemini-2.5-flash" });
    expect(target).toMatchObject({
      kind: "api",
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: SECRET,
      apiStyle: "openai-chat",
    });
    expect(target?.kind === "api" ? target.baseUrl : null).toContain("generativelanguage.googleapis.com");
  });

  it("fails closed when the selected provider has no saved key", async () => {
    mocks.prisma.aiProviderCredential.findUnique.mockResolvedValue(null);
    await expect(
      resolveLlmTarget({ workspaceId: "ws_1", provider: "xai", model: null })
    ).rejects.toBeInstanceOf(LlmConfigurationError);
  });

  it("fails closed when the encryption key is missing", async () => {
    delete process.env[CREDENTIALS_KEY_ENV];
    await expect(
      resolveLlmTarget({ workspaceId: "ws_1", provider: "anthropic", model: null })
    ).rejects.toThrow(CREDENTIALS_KEY_ENV);
    expect(mocks.prisma.aiProviderCredential.findUnique).not.toHaveBeenCalled();
  });
});

describe("log hygiene", () => {
  it("redacts the key from provider error text", () => {
    expect(redactSecret(`401: invalid key ${SECRET}`, SECRET)).toBe("401: invalid key [redacted]");
    expect(redactSecret("no secret here", SECRET)).toBe("no secret here");
  });
});
