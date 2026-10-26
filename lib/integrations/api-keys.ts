/**
 * API keys for the inbound integration API (/api/v1): generation, the
 * stored hash, request authentication and a per-key rate limit.
 */

import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";

const KEY_PREFIX = "os_";
const PREFIX_SHOWN = 10;
/** Requests per key per minute. */
export const API_RATE_LIMIT_PER_MINUTE = 60;
/** lastUsedAt is written at most this often per key. */
const LAST_USED_RESOLUTION_MS = 60_000;

export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = `${KEY_PREFIX}${randomBytes(30).toString("base64url")}`;
  return { key, prefix: key.slice(0, PREFIX_SHOWN), keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The key from "Authorization: Bearer os_..." (or X-API-Key), if well formed. */
export function readApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const key = bearer ?? request.headers.get("x-api-key")?.trim() ?? null;
  return key && key.startsWith(KEY_PREFIX) && key.length <= 100 ? key : null;
}

export interface ApiCaller {
  workspaceId: string;
  keyId: string;
}

function deny(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ success: false, error }, { status, headers });
}

/** Fixed one-minute window per key; Redis down means no limit rather than an outage. */
async function withinRateLimit(keyId: string, now: Date): Promise<boolean> {
  try {
    const bucket = `ratelimit:apikey:${keyId}:${Math.floor(now.getTime() / 60_000)}`;
    const redis = getRedisConnection();
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, 70);
    return count <= API_RATE_LIMIT_PER_MINUTE;
  } catch {
    return true;
  }
}

/**
 * Authenticate an /api/v1 request. Session cookies never count here:
 * only an unrevoked API key, within its rate limit.
 */
export async function authenticateApiRequest(
  request: Request,
  now: Date = new Date()
): Promise<{ ok: true; caller: ApiCaller } | { ok: false; response: NextResponse }> {
  const key = readApiKey(request);
  if (!key) return { ok: false, response: deny(401, "Send an API key: Authorization: Bearer os_...") };
  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: { id: true, workspaceId: true, revokedAt: true, lastUsedAt: true },
  });
  if (!row || row.revokedAt) return { ok: false, response: deny(401, "Invalid or revoked API key") };
  if (!(await withinRateLimit(row.id, now))) {
    return { ok: false, response: deny(429, "Rate limit reached, try again in a minute", { "Retry-After": "60" }) };
  }
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return { ok: true, caller: { workspaceId: row.workspaceId, keyId: row.id } };
}
