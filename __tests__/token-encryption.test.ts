import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "crypto";
import { decryptToken, encryptToken, needsReencryption } from "@/lib/meta/oauth";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

/** The format used before rotation support: base64(iv | tag | ciphertext). */
function legacyEncrypt(plain: string, keyHex: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

afterEach(() => {
  delete process.env.ENCRYPTION_KEYS_PREVIOUS;
});

describe("Instagram token encryption", () => {
  it("round-trips and labels new tokens with the key", () => {
    process.env.ENCRYPTION_KEY = NEW;
    const stored = encryptToken("IGAAtoken");
    expect(stored.startsWith("v2:")).toBe(true);
    expect(decryptToken(stored)).toBe("IGAAtoken");
    expect(needsReencryption(stored)).toBe(false);
  });

  it("still reads tokens stored before rotation support", () => {
    process.env.ENCRYPTION_KEY = OLD;
    expect(decryptToken(legacyEncrypt("IGAAold", OLD))).toBe("IGAAold");
  });

  it("decrypts with a previous key after rotation, and flags it for re-encryption", () => {
    process.env.ENCRYPTION_KEY = OLD;
    const labelled = encryptToken("IGAAlabelled");
    const legacy = legacyEncrypt("IGAAlegacy", OLD);
    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEYS_PREVIOUS = OLD;
    expect(decryptToken(labelled)).toBe("IGAAlabelled");
    expect(decryptToken(legacy)).toBe("IGAAlegacy");
    expect(needsReencryption(labelled)).toBe(true);
  });

  it("fails clearly when the old key is gone", () => {
    process.env.ENCRYPTION_KEY = OLD;
    const labelled = encryptToken("IGAAx");
    process.env.ENCRYPTION_KEY = NEW;
    expect(() => decryptToken(labelled)).toThrow(/no longer configured/);
  });
});
