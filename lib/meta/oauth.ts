import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { getEncryptionKeyHex, requireEnv } from "@/lib/env";

const INSTAGRAM_OAUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  workspaceId: string;
  ts: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signState(payload: string): string {
  return createHmac("sha256", requireEnv("NEXTAUTH_SECRET"))
    .update(payload)
    .digest("base64url");
}

export function createOAuthState(workspaceId: string): string {
  const payload = base64UrlEncode(
    JSON.stringify({ workspaceId, ts: Date.now() } satisfies OAuthStatePayload)
  );
  return `${payload}.${signState(payload)}`;
}

export function verifyOAuthState(state: string | null): OAuthStatePayload | null {
  if (!state) return null;

  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = signState(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as OAuthStatePayload;
    if (!parsed.workspaceId || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getAuthorizationUrl(
  redirectUri: string,
  state: string,
  options: { forceReauth?: boolean } = {}
): string {
  const params = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    redirect_uri: redirectUri,
    scope:
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights",
    response_type: "code",
    state,
  });
  // Instagram otherwise reuses whichever account is logged in on
  // instagram.com, so "Connect another account" would silently reconnect
  // the same one. force_reauth asks for the account's login every time.
  if (options.forceReauth) params.set("force_reauth", "true");

  return `${INSTAGRAM_OAUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Token exchange failed: ${error.error_message || JSON.stringify(error)}`
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    userId: String(data.user_id),
  };
}

/**
 * Instagram tokens are AES-256-GCM encrypted with ENCRYPTION_KEY. Keys can
 * be rotated: put the old key in ENCRYPTION_KEYS_PREVIOUS (comma-separated),
 * set a new ENCRYPTION_KEY, then run scripts/rotate-encryption-key.ts.
 * New ciphertexts are "v2:<key id>:<base64>", so the right key is picked
 * directly; older unlabelled ciphertexts are tried against every key.
 */
const KEY_ID_LENGTH = 8;

function keyId(key: Buffer): string {
  return createHmac("sha256", key).update("opensetter-token-key-id").digest("hex").slice(0, KEY_ID_LENGTH);
}

function getEncryptionKey(): Buffer {
  return Buffer.from(getEncryptionKeyHex(), "hex");
}

function previousEncryptionKeys(): Buffer[] {
  return (process.env.ENCRYPTION_KEYS_PREVIOUS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f]{64}$/i.test(value))
    .map((value) => Buffer.from(value, "hex"));
}

function decryptWith(key: Buffer, combined: Buffer): string {
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return `v2:${keyId(key)}:${combined.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const keys = [getEncryptionKey(), ...previousEncryptionKeys()];
  if (stored.startsWith("v2:")) {
    const [, id, data] = stored.split(":");
    const key = keys.find((candidate) => keyId(candidate) === id);
    if (!key) throw new Error("Token was encrypted with a key that is no longer configured");
    return decryptWith(key, Buffer.from(data ?? "", "base64"));
  }
  // Unlabelled tokens from before rotation support: the GCM tag tells us
  // which key fits.
  const combined = Buffer.from(stored, "base64");
  let lastError: unknown = null;
  for (const key of keys) {
    try {
      return decryptWith(key, combined);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Could not decrypt token");
}

/** True when a stored token is not yet labelled with the current key. */
export function needsReencryption(stored: string): boolean {
  return !stored.startsWith(`v2:${keyId(getEncryptionKey())}:`);
}
