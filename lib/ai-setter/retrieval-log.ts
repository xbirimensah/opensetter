/**
 * Loud, greppable log lines for second-brain retrieval.
 *
 * Retrieval fails open by design (a reply goes out even when the
 * knowledge base is down), which makes breakage silent unless it is
 * logged. Every backend reports through these helpers so one grep over
 * logs/worker*.log shows trouble:
 *
 *   grep -E "RETRIEVAL_(ERROR|EMPTY)|HEALTH" logs/worker*.log
 *
 * Never pass query text, message text, or credentials in here.
 */

const PREFIX = "[ai-setter][retrieval]";
const MAX_REASON_CHARS = 200;

export type RetrievalKind = "knowledge" | "style";

/** Short single-line reason for an unknown thrown value. */
export function describeError(error: unknown): string {
  let raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // fetch() hides the useful part (ECONNREFUSED, timeouts) in `cause`.
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  if (cause && typeof cause.code === "string") raw += ` (${cause.code})`;
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS);
}

export function logRetrievalError(
  backend: string,
  kind: RetrievalKind,
  reason: string
): void {
  console.error(
    `${PREFIX} RETRIEVAL_ERROR backend=${backend} kind=${kind} reason=${reason}`
  );
}

export function logRetrievalEmpty(backend: string, kind: RetrievalKind): void {
  console.warn(`${PREFIX} RETRIEVAL_EMPTY backend=${backend} kind=${kind}`);
}

export function logRetrievalHealth(
  backend: string,
  ok: boolean,
  detail: string
): void {
  const line = `${PREFIX} HEALTH backend=${backend} ok=${ok} ${detail}`;
  if (ok) console.log(line);
  else console.error(line);
}

export function logRetrievalConfigError(detail: string): void {
  console.error(`${PREFIX} CONFIG_ERROR ${detail}`);
}
