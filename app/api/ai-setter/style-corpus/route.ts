import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import {
  getStyleCorpusStatus,
  rebuildStyleCorpus,
} from "@/lib/ai-setter/style-corpus";

const rebuildSchema = z.object({
  instagramAccountId: z.string().optional().nullable(),
});

// One rebuild per account at a time. A second click while one runs gets
// 409 rebuild_in_progress, and GET reports `rebuilding` so the client can
// wait for the running one instead of showing a failure.
const rebuildsInFlight = new Set<string>();

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// Corpus freshness and coverage for the Sprachprofil.
export async function GET(request: NextRequest) {
  const resolved = await resolveSetterAccount(request.nextUrl.searchParams.get("instagramAccountId"));
  if (!resolved.ok) return resolved.response;
  const accountId = resolved.account.id;
  const status = await getStyleCorpusStatus(accountId);
  return json({
    success: true,
    data: { status: { ...status, rebuilding: rebuildsInFlight.has(accountId) } },
  });
}

// Rebuild the corpus from the locally mirrored DMs of this account only.
export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof rebuildSchema>;
  try {
    parsed = rebuildSchema.parse(await request.json());
  } catch {
    return json({ success: false, error: "Invalid request body", code: "invalid_request" }, 400);
  }

  const resolved = await resolveSetterAccount(parsed.instagramAccountId);
  if (!resolved.ok) return resolved.response;

  const accountId = resolved.account.id;
  if (rebuildsInFlight.has(accountId)) {
    return json(
      {
        success: false,
        error: "A rebuild is already running for this account.",
        code: "rebuild_in_progress",
      },
      409
    );
  }

  rebuildsInFlight.add(accountId);
  try {
    const { status, summary } = await rebuildStyleCorpus(accountId);
    // Counts only: corpus text never goes to the logs.
    console.info(
      `[ai-setter] style corpus rebuilt for ${accountId}: ${summary.entryCount} examples ` +
        `(was ${summary.previousEntryCount}) from ${summary.scannedMessages} mirrored messages in ${summary.durationMs}ms`
    );
    return json({ success: true, data: { status: { ...status, rebuilding: false }, summary } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-setter] style corpus rebuild failed for ${accountId}:`, message.slice(0, 300));
    return json(
      { success: false, error: "Rebuilding the style corpus failed", code: "rebuild_failed" },
      500
    );
  } finally {
    rebuildsInFlight.delete(accountId);
  }
}
