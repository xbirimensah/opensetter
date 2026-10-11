import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { reconcileDms } from "@/lib/polling/dm-reconciler";
import { recoverInterruptedSends } from "@/lib/ai-setter/send";
import { logKnowledgeHealth } from "@/lib/ai-setter/knowledge";
import { sweepFlowRuns } from "@/lib/flows/service";
import os from "node:os";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);
// DM safety net: backfill messages missed by webhooks and hand missed
// prospects to the setter. Cheaper than the comment sweep, still gentle
// on Meta's limits at the default cadence.
const DM_POLL_INTERVAL_MS = Number(
  process.env.DM_POLL_INTERVAL_MS ?? 10 * 60_000
);

console.log("[DM Worker] Started");

// One loud line about the second-brain backend: retrieval fails open, so a
// dead knowledge base would otherwise only show up as blander replies.
void logKnowledgeHealth();

// Quarantine any sends interrupted by the previous shutdown before new
// jobs start flowing.
void recoverInterruptedSends()
  .then((count) => {
    if (count > 0) {
      console.log(
        `[DM Worker] Quarantined ${count} interrupted send(s) as HELD`
      );
    }
  })
  .catch((error) =>
    console.error("[DM Worker] Interrupted-send recovery failed:", error)
  );

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

async function pollDms() {
  try {
    await reconcileDms();
    await recoverInterruptedSends();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] DM reconciliation failed:", message);
  }
}

setTimeout(() => void pollDms(), 20_000);
const dmPollTimer = setInterval(() => void pollDms(), DM_POLL_INTERVAL_MS);

// Flow upkeep: expire timed-out input steps and re-arm lost delay jobs.
const FLOW_SWEEP_INTERVAL_MS = Number(process.env.FLOW_SWEEP_INTERVAL_MS ?? 60_000);

async function sweepFlows() {
  try {
    const { expired, rearmed } = await sweepFlowRuns();
    if (expired > 0 || rearmed > 0) {
      console.log(`[DM Worker] Flow sweep: ${expired} expired, ${rearmed} delay(s) re-armed`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Flow sweep failed:", message);
  }
}

setTimeout(() => void sweepFlows(), 30_000);
const flowSweepTimer = setInterval(() => void sweepFlows(), FLOW_SWEEP_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(dmPollTimer);
  clearInterval(flowSweepTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
