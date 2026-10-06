/**
 * Contact-scoped voice corrections, ported from wa-bridge's feedback
 * store. A correction only ever reaches drafts for the conversation it
 * was recorded in; it is never a global training signal.
 */

export const MAX_CORRECTIONS_PER_PROMPT = 8;
const MAX_CORRECTION_CHARS = 240;

export interface VoiceCorrectionInput {
  avoidText: string | null;
  preferText: string | null;
  note: string | null;
}

function clean(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CORRECTION_CHARS);
}

/** Render rows (oldest first) as prompt lines, keeping the newest `limit`. */
export function formatVoiceCorrections(
  rows: readonly VoiceCorrectionInput[],
  limit: number = MAX_CORRECTIONS_PER_PROMPT
): string[] {
  const rendered = rows.flatMap((row) => {
    const avoid = clean(row.avoidText);
    const prefer = clean(row.preferText);
    const note = clean(row.note);
    const lines: string[] = [];
    if (avoid && prefer) lines.push(`Avoid: ${avoid}\nPrefer: ${prefer}`);
    else if (avoid) lines.push(`Avoid: ${avoid}`);
    else if (prefer) lines.push(`Prefer: ${prefer}`);
    if (note) {
      if (lines.length > 0) lines[0] = `${lines[0]}\nNote: ${note}`;
      else lines.push(`Note: ${note}`);
    }
    return lines;
  });
  return rendered.slice(-Math.max(0, limit));
}
