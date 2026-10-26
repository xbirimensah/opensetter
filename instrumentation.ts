/** Runs once when the web server starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceEnvironment } = await import("@/lib/startup-checks");
  enforceEnvironment("web");
  // Push an alert when /api/health turns degraded (only with an alert
  // channel configured, see lib/ops/alerts.ts).
  const { startHealthWatch } = await import("@/lib/ops/health-watch");
  startHealthWatch();
}
