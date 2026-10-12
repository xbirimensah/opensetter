/**
 * Cron routes are called by a scheduler with `Authorization: Bearer
 * <CRON_SECRET>`. Only CRON_SECRET counts: falling back to the session
 * secret would turn the key that signs every login into a bearer token
 * sent over HTTP. Without a CRON_SECRET the routes refuse to run.
 */

import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

const MIN_SECRET_LENGTH = 16;

/** Null when the request may run; otherwise the response to return. */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
