/** Runs once when the web server starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceEnvironment } = await import("@/lib/startup-checks");
  enforceEnvironment("web");
}
