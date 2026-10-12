/**
 * Caps failed password logins per email: after MAX_FAILURES within the
 * window, further attempts are refused until it expires. Lives in Redis
 * so it holds across web restarts. If Redis is unreachable the check is
 * skipped (logged): Redis is required for the app anyway, and locking the
 * owner out of their own instance is worse than an unthrottled minute.
 */

import Redis from "ioredis";

const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  }
  return redis;
}

function key(email: string): string {
  return `login:failures:${email}`;
}

export async function isLoginThrottled(email: string): Promise<boolean> {
  try {
    const count = await getRedis()?.get(key(email));
    return Number(count ?? 0) >= MAX_FAILURES;
  } catch (error) {
    console.warn("[login-throttle] Redis unavailable, skipping check:", error);
    return false;
  }
}

export async function recordLoginFailure(email: string): Promise<void> {
  try {
    const client = getRedis();
    if (!client) return;
    const count = await client.incr(key(email));
    if (count === 1) await client.expire(key(email), WINDOW_SECONDS);
  } catch (error) {
    console.warn("[login-throttle] Redis unavailable, failure not counted:", error);
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await getRedis()?.del(key(email));
  } catch {
    // Expires on its own.
  }
}

export const LOGIN_THROTTLE_MINUTES = WINDOW_SECONDS / 60;
