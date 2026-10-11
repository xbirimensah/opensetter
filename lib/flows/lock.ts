/**
 * Per-conversation mutex in Redis. The DM worker runs 5 jobs at once, and
 * a button tap, a message and a delay can land for one contact together;
 * flow state for a conversation must only change under this lock.
 */

import { randomUUID } from "crypto";
import { getRedisConnection } from "@/lib/queue/client";

const TTL_MS = 60_000;
const RENEW_EVERY_MS = 15_000;
const WAIT_MS = 30_000;
const POLL_MS = 150;

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

export class FlowLockBusyError extends Error {
  constructor(conversationId: string) {
    super(`Flow lock busy for conversation ${conversationId}`);
    this.name = "FlowLockBusyError";
  }
}

export async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedisConnection();
  const key = `opensetter:flowlock:${conversationId}`;
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;

  while ((await redis.set(key, token, "PX", TTL_MS, "NX")) !== "OK") {
    if (Date.now() > deadline) throw new FlowLockBusyError(conversationId);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  // Keep the lock alive while the holder works (sends, typing pauses), so
  // it cannot expire under a slow pass and let a second job in.
  const renew = setInterval(() => {
    void redis.eval(RENEW, 1, key, token, String(TTL_MS)).catch(() => {});
  }, RENEW_EVERY_MS);

  try {
    return await fn();
  } finally {
    clearInterval(renew);
    await redis.eval(RELEASE, 1, key, token).catch(() => {});
  }
}
