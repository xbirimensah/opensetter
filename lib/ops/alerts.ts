/**
 * Push alerts for the operator: a failing health check, worker job
 * failures and token refresh errors reach a phone instead of waiting on
 * the Diagnostics page. Channels come from env (all optional, any mix):
 *
 *  - ALERT_NTFY_URL (+ ALERT_NTFY_TOKEN)        ntfy topic URL
 *  - ALERT_TELEGRAM_BOT_TOKEN + _CHAT_ID       Telegram bot message
 *  - ALERT_WEBHOOK_URL                         Slack-style JSON {text}
 *  - ALERT_EMAIL_TO (+ RESEND_API_KEY)         email through Resend
 *
 * Sending never throws: an alert path that crashes the worker would be
 * worse than a missed alert. Repeats of one alert key are dropped for
 * ALERT_DEDUPE_SECONDS (default one hour).
 */

import { getRedisConnection } from "@/lib/queue/client";

type EnvMap = Record<string, string | undefined>;

export type AlertLevel = "error" | "warning" | "recovered";

export interface OpsAlert {
  /** Stable identity for dedupe, e.g. "health:degraded" or "token-refresh:<id>". */
  key: string;
  level: AlertLevel;
  title: string;
  message: string;
}

export type AlertChannel =
  | { kind: "ntfy"; url: string; token?: string }
  | { kind: "telegram"; botToken: string; chatId: string }
  | { kind: "webhook"; url: string }
  | { kind: "email"; to: string[]; from: string; apiKey: string };

const SEND_TIMEOUT_MS = 10_000;
const DEFAULT_DEDUPE_SECONDS = 3_600;
const DEDUPE_PREFIX = "alerts:sent:";
const LEVEL_TAG: Record<AlertLevel, string> = {
  error: "[OpenSetter] ",
  warning: "[OpenSetter] Warning: ",
  recovered: "[OpenSetter] Recovered: ",
};

export function alertChannelsFromEnv(env: EnvMap = process.env): AlertChannel[] {
  const channels: AlertChannel[] = [];
  const ntfy = env.ALERT_NTFY_URL?.trim();
  if (ntfy) channels.push({ kind: "ntfy", url: ntfy, token: env.ALERT_NTFY_TOKEN?.trim() || undefined });
  const botToken = env.ALERT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.ALERT_TELEGRAM_CHAT_ID?.trim();
  if (botToken && chatId) channels.push({ kind: "telegram", botToken, chatId });
  const webhook = env.ALERT_WEBHOOK_URL?.trim();
  if (webhook) channels.push({ kind: "webhook", url: webhook });
  const to = (env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const apiKey = env.RESEND_API_KEY?.trim();
  if (to.length > 0 && apiKey) {
    channels.push({
      kind: "email",
      to,
      apiKey,
      from: env.ALERT_EMAIL_FROM?.trim() || env.EMAIL_FROM?.trim() || "OpenSetter <alerts@example.com>",
    });
  }
  return channels;
}

export function alertsConfigured(env: EnvMap = process.env): boolean {
  return alertChannelsFromEnv(env).length > 0;
}

function dedupeSeconds(env: EnvMap = process.env): number {
  const value = Number(env.ALERT_DEDUPE_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEDUPE_SECONDS;
}

/** In-process fallback when Redis is the thing that is down. */
const recentlySent = new Map<string, number>();

async function claimAlertSlot(key: string, ttlSeconds: number): Promise<boolean> {
  if (ttlSeconds === 0) return true;
  try {
    const claimed = await getRedisConnection().set(`${DEDUPE_PREFIX}${key}`, "1", "EX", ttlSeconds, "NX");
    return claimed === "OK";
  } catch {
    const now = Date.now();
    const last = recentlySent.get(key);
    if (last && now - last < ttlSeconds * 1000) return false;
    recentlySent.set(key, now);
    return true;
  }
}

/** Let a recovery alert re-arm the matching failure alert. */
export async function clearAlertSlot(key: string): Promise<void> {
  recentlySent.delete(key);
  try {
    await getRedisConnection().del(`${DEDUPE_PREFIX}${key}`);
  } catch {
    // Redis down: the in-memory slot is already cleared.
  }
}

async function post(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${body.slice(0, 200)}`);
  }
}

export async function deliverToChannel(channel: AlertChannel, alert: OpsAlert): Promise<void> {
  const subject = `${LEVEL_TAG[alert.level]}${alert.title}`;
  switch (channel.kind) {
    case "ntfy":
      return post(channel.url, {
        method: "POST",
        headers: {
          // ntfy reads the title from a header; headers must stay ASCII.
          Title: subject.replace(/[^\x20-\x7E]/g, "?"),
          Priority: alert.level === "error" ? "high" : "default",
          Tags: alert.level === "recovered" ? "white_check_mark" : "warning",
          ...(channel.token ? { Authorization: `Bearer ${channel.token}` } : {}),
        },
        body: alert.message,
      });
    case "telegram":
      return post(`https://api.telegram.org/bot${channel.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channel.chatId,
          text: `${subject}\n\n${alert.message}`,
          disable_web_page_preview: true,
        }),
      });
    case "webhook":
      return post(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${subject}\n${alert.message}` }),
      });
    case "email":
      return post("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${channel.apiKey}` },
        body: JSON.stringify({ from: channel.from, to: channel.to, subject, text: alert.message }),
      });
  }
}

/** Never print a bot token or API key that a fetch error may echo. */
function scrub(message: string, channel: AlertChannel): string {
  const secret = channel.kind === "telegram" ? channel.botToken : channel.kind === "email" ? channel.apiKey : channel.kind === "ntfy" ? channel.token : undefined;
  return secret ? message.split(secret).join("[redacted]") : message;
}

/**
 * Send an alert to every configured channel. Returns how many channels
 * accepted it (0 when nothing is configured or the alert was a repeat).
 */
export async function sendOpsAlert(alert: OpsAlert, env: EnvMap = process.env): Promise<number> {
  const channels = alertChannelsFromEnv(env);
  if (channels.length === 0) return 0;
  if (!(await claimAlertSlot(alert.key, dedupeSeconds(env)))) return 0;

  const results = await Promise.allSettled(channels.map((channel) => deliverToChannel(channel, alert)));
  let delivered = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      delivered += 1;
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`[alerts] ${channels[index].kind} failed: ${scrub(reason, channels[index])}`);
  });
  return delivered;
}
