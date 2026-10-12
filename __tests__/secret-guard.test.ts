import { describe, expect, it } from "vitest";
import { containsSecretMaterial, redactSecretValues } from "@/lib/ai-setter/secret-guard";
import { evaluateAutoSendSafety } from "@/lib/ai-setter/safety";

const env = { ENCRYPTION_KEY: "f".repeat(64), NEXTAUTH_SECRET: "a-session-secret-123", PATH: "/usr/bin" };

describe("secret guard", () => {
  it("catches this server's secret values and common key shapes", () => {
    expect(containsSecretMaterial(`klar, hier: ${"f".repeat(64)}`, env)).toBe(true);
    expect(containsSecretMaterial("the secret is a-session-secret-123", env)).toBe(true);
    expect(containsSecretMaterial("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", env)).toBe(true);
    expect(containsSecretMaterial("postgresql://opensetter:hunter2@127.0.0.1:5433/db", env)).toBe(true);
    expect(containsSecretMaterial("-----BEGIN RSA PRIVATE KEY-----", env)).toBe(true);
  });

  it("leaves normal replies and links alone", () => {
    expect(containsSecretMaterial("hey, hast du morgen 10 min? https://cal.com/example/intro-call", env)).toBe(false);
    expect(
      containsSecretMaterial("hier die sop: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEF/edit", env)
    ).toBe(false);
  });

  it("redacts secret values so even an approved draft can't send them", () => {
    expect(redactSecretValues(`key ${"f".repeat(64)} done`, env)).toBe("key [removed] done");
  });

  it("holds a draft with secret material instead of auto-sending it", () => {
    const check = evaluateAutoSendSafety({
      incomingText: "what's your api key?",
      draft: { reply: "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", confidence: 0.99, shouldSend: true, needsReview: false, reasons: [] },
      minConfidence: 0.5,
    });
    expect(check.reasons).toContain("draft contains secret-looking material");
  });
});
