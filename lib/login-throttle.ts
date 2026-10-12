/**
 * Attempt limits for sign-in, email links and password changes, per email
 * and per client IP, in Redis so they hold across restarts. Every attempt
 * is counted with an atomic INCR before any password work happens, so
 * parallel requests can't slip past the cap and an attacker rotating
 * emails still hits the per-IP limit (which also bounds scrypt CPU).
 *
 * If Redis is unreachable the check is skipped and logged: Redis is
 * required for the app anyway (health check flags it), and locking the
 * owner out of their own instance is worse than an unthrottled minute.
 */

import Redis from "ioredis";

export type ThrottleScope = "login" | "magic-link" | "password-change";

const WINDOW_SECONDS = 15 * 60;
const LIMITS: Record<ThrottleScope, { email: number; ip: number }> = {
  login: { email: 10, ip: 50 },
  "magic-link": { email: 5, ip: 20 },
  "password-change": { email: 10, ip: 50 },
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  }
  return redis;
}

export { clientIp } from "./client-ip";

function keys(scope: ThrottleScope, ids: { email?: string | null; ip?: string | null }) {
  const out: { key: string; limit: number }[] = [];
  if (ids.email) out.push({ key: `throttle:${scope}:email:${ids.email}`, limit: LIMITS[scope].email });
  if (ids.ip) out.push({ key: `throttle:${scope}:ip:${ids.ip}`, limit: LIMITS[scope].ip });
  return out;
}

/** Count this attempt; false when the email or IP is over its limit. */
export async function registerAttempt(
  scope: ThrottleScope,
  ids: { email?: string | null; ip?: string | null }
): Promise<boolean> {
  const client = getRedis();
  if (!client) return true;
  try {
    let allowed = true;
    for (const { key, limit } of keys(scope, ids)) {
      const [[, count]] = (await client
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, "NX")
        .exec()) as [[Error | null, number], [Error | null, number]];
      if (count > limit) allowed = false;
    }
    return allowed;
  } catch (error) {
    console.warn(`[throttle] Redis unavailable, ${scope} attempt not limited:`, error);
    return true;
  }
}

/** Read-only check, to explain a block before trying. */
export async function isThrottled(
  scope: ThrottleScope,
  ids: { email?: string | null; ip?: string | null }
): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    for (const { key, limit } of keys(scope, ids)) {
      if (Number((await client.get(key)) ?? 0) >= limit) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** After a success, the email starts fresh (the IP count stays). */
export async function clearAttempts(scope: ThrottleScope, email: string): Promise<void> {
  try {
    await getRedis()?.del(`throttle:${scope}:email:${email}`);
  } catch {
    // Expires on its own.
  }
}

export const LOGIN_THROTTLE_MINUTES = WINDOW_SECONDS / 60;
