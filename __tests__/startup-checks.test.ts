import { describe, expect, it } from "vitest";
import { checkEnvironment } from "@/lib/startup-checks";

const good = {
  NEXTAUTH_URL: "https://app.example.com",
  NEXTAUTH_SECRET: "x".repeat(40),
  CRON_SECRET: "c".repeat(32),
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/db",
  REDIS_URL: "redis://127.0.0.1:6380",
  ENCRYPTION_KEY: "f".repeat(64),
  INSTAGRAM_APP_ID: "1",
  INSTAGRAM_APP_SECRET: "s",
  FACEBOOK_APP_SECRET: "s",
  WEBHOOK_VERIFY_TOKEN: "v",
  OPENSETTER_OPERATOR_EMAILS: "owner@example.com",
};

describe("startup environment checks", () => {
  it("passes a complete environment", () => {
    expect(checkEnvironment(good)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses example secrets and missing core values", () => {
    const report = checkEnvironment({
      ...good,
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      NEXTAUTH_SECRET: "replace-with-a-strong-random-secret",
      DATABASE_URL: undefined,
    });
    expect(report.errors.join("\n")).toMatch(/ENCRYPTION_KEY still has the example value/);
    expect(report.errors.join("\n")).toMatch(/NEXTAUTH_SECRET still has the example value/);
    expect(report.errors.join("\n")).toMatch(/DATABASE_URL/);
  });

  it("requires a named operator in production", () => {
    const report = checkEnvironment({ ...good, NODE_ENV: "production", OPENSETTER_OPERATOR_EMAILS: undefined });
    expect(report.errors.join()).toMatch(/OPENSETTER_OPERATOR_EMAILS/);
  });

  it("warns when cron routes can't run", () => {
    expect(checkEnvironment({ ...good, CRON_SECRET: undefined }).warnings.join()).toMatch(/CRON_SECRET/);
  });
});
