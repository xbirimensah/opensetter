/**
 * Encryption at rest for model-provider API keys.
 *
 * AES-256-GCM with a dedicated key (AI_CREDENTIALS_ENCRYPTION_KEY), kept
 * separate from the Instagram token key so either can be rotated alone.
 * The workspace id and provider are bound in as associated data, so a
 * ciphertext copied to another row or workspace fails to decrypt.
 * Without a valid key everything fails closed: nothing is saved and no
 * saved key is used.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export const CREDENTIALS_KEY_ENV = "AI_CREDENTIALS_ENCRYPTION_KEY";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = "v1:";
const HEX_32_BYTE = /^[a-f0-9]{64}$/i;
const FINGERPRINT_HEX_CHARS = 12;

export type EncryptionReadiness =
  | { ready: true }
  | { ready: false; reason: "missing" | "malformed"; message: string };

export interface CredentialContext {
  workspaceId: string;
  provider: string;
}

export class CredentialEncryptionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionUnavailableError";
  }
}

const SETUP_HINT = `Generate one with \`openssl rand -hex 32\`, set ${CREDENTIALS_KEY_ENV} in the server environment (.env or hosting secrets) for both the app and the worker, then restart them. Until then, saved provider keys cannot be stored or used.`;

export function getCredentialEncryptionReadiness(): EncryptionReadiness {
  const value = process.env[CREDENTIALS_KEY_ENV];
  if (!value) {
    return {
      ready: false,
      reason: "missing",
      message: `${CREDENTIALS_KEY_ENV} is not set. ${SETUP_HINT}`,
    };
  }
  if (!HEX_32_BYTE.test(value)) {
    return {
      ready: false,
      reason: "malformed",
      message: `${CREDENTIALS_KEY_ENV} must be 64 hex characters (32 bytes). ${SETUP_HINT}`,
    };
  }
  return { ready: true };
}

function requireKey(): Buffer {
  const readiness = getCredentialEncryptionReadiness();
  if (!readiness.ready) {
    throw new CredentialEncryptionUnavailableError(readiness.message);
  }
  return Buffer.from(process.env[CREDENTIALS_KEY_ENV] as string, "hex");
}

function associatedData(context: CredentialContext): Buffer {
  return Buffer.from(`opensetter:ai-provider:${context.workspaceId}:${context.provider}`, "utf8");
}

export function encryptCredential(plaintext: string, context: CredentialContext): string {
  const key = requireKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(associatedData(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  return `${VERSION_PREFIX}${sealed.toString("base64")}`;
}

export function decryptCredential(payload: string, context: CredentialContext): string {
  const key = requireKey();
  if (!payload.startsWith(VERSION_PREFIX)) {
    throw new Error("Unsupported credential format");
  }
  const sealed = Buffer.from(payload.slice(VERSION_PREFIX.length), "base64");
  const iv = sealed.subarray(0, IV_LENGTH);
  const authTag = sealed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = sealed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(associatedData(context));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Short SHA-256 fingerprint so the owner can tell which key is saved
 * without any character of the key itself leaving the server.
 */
export function fingerprintCredential(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, FINGERPRINT_HEX_CHARS);
}
