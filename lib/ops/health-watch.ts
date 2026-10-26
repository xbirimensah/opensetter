/**
 * Health watcher: runs the /api/health checks on an interval inside the
 * web server and pushes an alert when the instance turns degraded, plus
 * one when it recovers. Two failed checks in a row are needed, so a
 * worker restart (heartbeat gap) does not page anyone.
 *
 * It cannot report the whole machine going down; point an external
 * uptime monitor at /api/health for that (docs/operations.md).
 */

import { clearAlertSlot, sendOpsAlert, alertsConfigured } from "@/lib/ops/alerts";
import { describeFailures, runHealthChecks, type HealthReport } from "@/lib/ops/health-checks";

const DEFAULT_INTERVAL_MS = 120_000;
/** Consecutive failed checks before the degraded alert goes out. */
export const FAILURES_BEFORE_ALERT = 2;
const DEGRADED_KEY = "health:degraded";

export interface WatchState {
  consecutiveFailures: number;
  alerted: boolean;
}

export type WatchAction = { kind: "none" } | { kind: "degraded"; failures: string[] } | { kind: "recovered" };

/** Pure transition: what to do after one check, and the next state. */
export function nextWatchStep(
  state: WatchState,
  report: HealthReport
): { state: WatchState; action: WatchAction } {
  if (report.healthy) {
    return {
      state: { consecutiveFailures: 0, alerted: false },
      action: state.alerted ? { kind: "recovered" } : { kind: "none" },
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (!state.alerted && consecutiveFailures >= FAILURES_BEFORE_ALERT) {
    return {
      state: { consecutiveFailures, alerted: true },
      action: { kind: "degraded", failures: describeFailures(report) },
    };
  }
  return { state: { consecutiveFailures, alerted: state.alerted }, action: { kind: "none" } };
}

function instanceLabel(): string {
  return process.env.NEXTAUTH_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "this instance";
}

async function act(action: WatchAction): Promise<void> {
  if (action.kind === "degraded") {
    await sendOpsAlert({
      key: DEGRADED_KEY,
      level: "error",
      title: "Health check failing",
      message: `${instanceLabel()} is degraded:\n${action.failures.join("\n")}\n\nDetails: Diagnostics page or /api/health on the server.`,
    });
  } else if (action.kind === "recovered") {
    await clearAlertSlot(DEGRADED_KEY);
    await sendOpsAlert({
      key: "health:recovered",
      level: "recovered",
      title: "Health check passing again",
      message: `${instanceLabel()} is healthy again.`,
    });
    await clearAlertSlot("health:recovered");
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start once per process; a no-op when no alert channel is configured. */
export function startHealthWatch(): boolean {
  if (timer || !alertsConfigured() || process.env.ALERT_HEALTH_WATCH === "off") return false;
  const interval = Number(process.env.ALERT_HEALTH_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  let state: WatchState = { consecutiveFailures: 0, alerted: false };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const step = nextWatchStep(state, await runHealthChecks());
      state = step.state;
      await act(step.action);
    } catch (error) {
      console.error("[health-watch] check failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  console.log(`[health-watch] alerting on health changes every ${Math.round(interval / 1000)} s`);
  return true;
}
