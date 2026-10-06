/**
 * Browser side of the Sprachprofil corpus rebuild.
 *
 * The rebuild is one long request. Its response can be lost while the
 * server finishes fine: a proxy answers with an HTML timeout page, a
 * phone backgrounds the tab, or a second click hits the per-account lock.
 * Instead of reporting those as failures, the helper asks the server for
 * the corpus status until the outcome is known: a newer build time means
 * it worked, `rebuilding` means wait, neither means it did not happen.
 */

export interface CorpusSampleView {
  id: string;
  text: string;
  language: string;
  sentAt: string;
}

export interface CorpusStatusView {
  entryCount: number;
  conversationCount: number;
  mirroredConversations: number;
  mirroredMessageCount: number;
  humanMessageCount: number;
  coveragePercent: number;
  languages: Record<string, number>;
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
  builtAt: string | null;
  lastMirroredAt: string | null;
  newHumanMessagesSinceBuild: number;
  isStale: boolean;
  rebuilding: boolean;
  samples: CorpusSampleView[];
}

export interface CorpusRebuildSummaryView {
  previousEntryCount: number;
  entryCount: number;
  scannedMessages: number;
  durationMs: number;
}

export type CorpusRebuildOutcome =
  | {
      kind: "success";
      status: CorpusStatusView;
      /** Null when the result was recovered from the status endpoint. */
      summary: CorpusRebuildSummaryView | null;
      recovered: boolean;
    }
  | { kind: "error"; message: string; status: CorpusStatusView | null };

export interface RebuildDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
  pollIntervalMs?: number;
  /** Give up on the POST before typical proxy timeouts (~100 s) and poll instead. */
  requestTimeoutMs?: number;
}

const ENDPOINT = "/api/ai-setter/style-corpus";
const DEFAULT_MAX_POLLS = 60;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

interface ApiBody {
  success?: boolean;
  error?: string;
  code?: string;
  data?: { status?: CorpusStatusView; summary?: CorpusRebuildSummaryView };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parse a JSON API body; null for HTML error pages and other non-JSON. */
async function readApiBody(response: Response): Promise<ApiBody | null> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  try {
    return (await response.json()) as ApiBody;
  } catch {
    return null;
  }
}

export async function fetchCorpusStatus(
  accountId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ status: CorpusStatusView } | { error: string }> {
  try {
    const response = await fetchImpl(`${ENDPOINT}?instagramAccountId=${encodeURIComponent(accountId)}`, {
      cache: "no-store",
    });
    const body = await readApiBody(response);
    if (body?.success && body.data?.status) return { status: body.data.status };
    return { error: body?.error ?? `Could not load the style corpus (HTTP ${response.status})` };
  } catch {
    return { error: "Could not load the style corpus: the server is unreachable" };
  }
}

function isNewerBuild(builtAt: string | null, previousBuiltAt: string | null): boolean {
  if (!builtAt) return false;
  if (!previousBuiltAt) return true;
  return new Date(builtAt).getTime() > new Date(previousBuiltAt).getTime();
}

async function waitForOutcome(
  accountId: string,
  previousBuiltAt: string | null,
  deps: Required<Pick<RebuildDeps, "fetchImpl" | "sleep" | "maxPolls" | "pollIntervalMs">>
): Promise<CorpusRebuildOutcome> {
  let latest: CorpusStatusView | null = null;
  for (let attempt = 0; attempt < deps.maxPolls; attempt++) {
    if (attempt > 0) await deps.sleep(deps.pollIntervalMs);
    const result = await fetchCorpusStatus(accountId, deps.fetchImpl);
    if (!("status" in result)) continue;
    latest = result.status;
    if (latest.rebuilding) continue;
    if (isNewerBuild(latest.builtAt, previousBuiltAt)) {
      return { kind: "success", status: latest, summary: null, recovered: true };
    }
    return {
      kind: "error",
      message: "The rebuild did not finish, so the corpus is unchanged. Try again.",
      status: latest,
    };
  }
  return {
    kind: "error",
    message: latest
      ? "The rebuild is still running on the server. The numbers update when it finishes; check back or try again later."
      : "Could not reach the server to confirm the rebuild. Check your connection and try again.",
    status: latest,
  };
}

/**
 * Start a rebuild and resolve with its real outcome. `previousBuiltAt` is
 * the build time the card showed before the click.
 */
export async function rebuildCorpusWithRecovery(
  accountId: string,
  previousBuiltAt: string | null,
  deps: RebuildDeps = {}
): Promise<CorpusRebuildOutcome> {
  const resolved = {
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? defaultSleep,
    maxPolls: deps.maxPolls ?? DEFAULT_MAX_POLLS,
    pollIntervalMs: deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  };

  let response: Response;
  try {
    response = await resolved.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId: accountId }),
      signal: AbortSignal.timeout(deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network drop or our own timeout: the server may still be working.
    return waitForOutcome(accountId, previousBuiltAt, resolved);
  }

  const body = await readApiBody(response);
  if (body?.success && body.data?.status) {
    return {
      kind: "success",
      status: body.data.status,
      summary: body.data.summary ?? null,
      recovered: false,
    };
  }
  if (!body || body.code === "rebuild_in_progress") {
    return waitForOutcome(accountId, previousBuiltAt, resolved);
  }

  // The server answered with a real error: report it, but never leave
  // the card on numbers from before the click.
  const refreshed = await fetchCorpusStatus(accountId, resolved.fetchImpl);
  return {
    kind: "error",
    message: body.error ?? `Rebuild failed (HTTP ${response.status})`,
    status: "status" in refreshed ? refreshed.status : null,
  };
}

// ─── view model ─────────────────────────────────────────────────────────────

export type CorpusBadgeTone = "success" | "warning" | "neutral";

export interface CorpusStateView {
  badge: { tone: CorpusBadgeTone; label: string };
  /** Why the corpus is empty, when it is. */
  hint: string | null;
}

const EMPTY_MIRROR_HINT =
  "No DMs are mirrored for this account on this server yet, so a rebuild has nothing to learn from. " +
  "DMs appear once the Instagram webhook or the DM reconciler mirrors them; if that stays empty, " +
  "reconnect the Instagram account so its access token is valid.";

function emptyCorpusHint(status: CorpusStatusView): string | null {
  if (status.mirroredMessageCount === 0) return EMPTY_MIRROR_HINT;
  if (status.entryCount > 0) return null;
  if (status.humanMessageCount === 0) {
    return "None of the mirrored messages were hand-typed by you yet. AI, campaign and prospect messages never count.";
  }
  return `Your ${status.humanMessageCount} hand-typed messages were all filtered out (too short, only links or contact details, or matching agent-sent text).`;
}

export function describeCorpusState(status: CorpusStatusView): CorpusStateView {
  const hint = emptyCorpusHint(status);
  if (status.rebuilding) return { badge: { tone: "neutral", label: "Rebuilding…" }, hint };
  if (status.builtAt === null) return { badge: { tone: "warning", label: "Not built yet" }, hint };
  if (status.mirroredMessageCount === 0) {
    return { badge: { tone: "warning", label: "No mirrored DMs" }, hint };
  }
  if (status.entryCount === 0) return { badge: { tone: "warning", label: "No examples" }, hint };
  if (status.isStale) {
    return {
      badge: { tone: "warning", label: `${status.newHumanMessagesSinceBuild} new since rebuild` },
      hint,
    };
  }
  return { badge: { tone: "success", label: "Up to date" }, hint };
}

/** One-line confirmation for a finished rebuild. */
export function describeRebuildSuccess(
  outcome: Extract<CorpusRebuildOutcome, { kind: "success" }>
): string {
  const { summary, status } = outcome;
  const examples = (n: number) => `${n} example${n === 1 ? "" : "s"}`;
  if (!summary) {
    return `Rebuild finished on the server: ${examples(status.entryCount)} from ${status.conversationCount} chats.`;
  }
  return (
    `Rebuilt: ${examples(summary.entryCount)} (was ${summary.previousEntryCount}) ` +
    `from ${summary.scannedMessages} mirrored messages.`
  );
}
