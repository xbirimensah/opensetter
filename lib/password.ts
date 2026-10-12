/**
 * Password hashing for email + password login. scrypt from Node's crypto,
 * so no native dependency; the parameters live in the stored string, so
 * they can be raised later without breaking existing hashes.
 *
 * Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto";

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// scrypt needs 128 * N * r bytes (32 MiB here); Node's default cap is 32 MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;
/** Long inputs make scrypt slow on purpose; cap them so login can't be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 200;

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: SCRYPT_MAXMEM }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const expected = Buffer.from(hashB64, "base64");
  const key = await deriveKey(password, Buffer.from(saltB64, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * Same cost as a real check, for logins with an unknown email, so response
 * time doesn't reveal which emails have an account.
 */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}
