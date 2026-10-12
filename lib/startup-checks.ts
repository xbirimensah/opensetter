/**
 * Environment checks at process start (web via instrumentation.ts, and the
 * worker). Errors stop a production start: a missing secret or a value
 * copied from .env.example is a security hole, not a degraded mode.
 * Warnings are logged and the process continues.
 */

import { serverEnvSchema } from "@/lib/env";

/** Values shipped in .env.example; running with them means anyone can forge sessions. */
const EXAMPLE_VALUES = new Set([
  "replace-with-a-strong-random-secret",
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
]);
const SECRET_NAMES = ["NEXTAUTH_SECRET", "CRON_SECRET", "ENCRYPTION_KEY", "AI_CREDENTIALS_ENCRYPTION_KEY", "WEBHOOK_VERIFY_TOKEN", "HEALTH_TOKEN"];

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

export function checkEnvironment(env: Record<string, string | undefined> = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  for (const name of SECRET_NAMES) {
    if (env[name] && EXAMPLE_VALUES.has(env[name] as string)) {
      errors.push(`${name} still has the example value from .env.example; generate a real one`);
    }
  }
  if ((env.NEXTAUTH_SECRET ?? "").length > 0 && (env.NEXTAUTH_SECRET ?? "").length < 32) {
    warnings.push("NEXTAUTH_SECRET is shorter than 32 characters; it signs every session");
  }
  if (env.NODE_ENV === "production" && !env.OPENSETTER_OPERATOR_EMAILS?.trim()) {
    errors.push(
      "OPENSETTER_OPERATOR_EMAILS is not set: name the instance operator's email (they alone may use the server's CLI login, env API key and knowledge base)"
    );
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) {
    warnings.push("CRON_SECRET is not set (16+ characters): token refresh and the other cron routes refuse to run");
  }
  if (env.NEXTAUTH_URL && !env.NEXTAUTH_URL.startsWith("https://") && env.NODE_ENV === "production") {
    warnings.push("NEXTAUTH_URL is not https: sign-in links and cookies should only travel over https");
  }
  return { errors, warnings };
}

/** Log the report; in production, refuse to start on errors. */
export function enforceEnvironment(processName: string): void {
  const { errors, warnings } = checkEnvironment();
  for (const warning of warnings) console.warn(`[startup:${processName}] ${warning}`);
  if (errors.length === 0) return;
  for (const error of errors) console.error(`[startup:${processName}] ${error}`);
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${processName} refused to start: ${errors.length} environment problem(s), see the log above`);
  }
}
