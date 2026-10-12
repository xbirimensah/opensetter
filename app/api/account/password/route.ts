import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUserId, unstable_update } from "@/lib/auth";
import { clearLoginFailures, isLoginThrottled, recordLoginFailure } from "@/lib/login-throttle";
import { hashPassword, MAX_PASSWORD_LENGTH, passwordProblem, verifyPassword } from "@/lib/password";

export const runtime = "nodejs";

const updateSchema = z.object({
  currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
  newPassword: z.string().max(MAX_PASSWORD_LENGTH),
});

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/** Whether the signed-in user has a password yet (Settings shows set vs change). */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return fail("Unauthorized", 401);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  return NextResponse.json({
    success: true,
    data: { hasPassword: Boolean(user?.passwordHash), email: user?.email ?? null },
  });
}

/**
 * Set or change the password. Changing needs the current one. Every other
 * session of this user ends (lib/auth.ts compares sign-in time with
 * passwordUpdatedAt); this device stays signed in.
 */
export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return fail("Unauthorized", 401);

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request", 400);
  const { currentPassword, newPassword } = parsed.data;

  const problem = passwordProblem(newPassword);
  if (problem) return fail(problem, 400);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return fail("Unauthorized", 401);

  if (user.passwordHash) {
    const email = user.email ?? userId;
    if (await isLoginThrottled(email)) return fail("Too many attempts. Try again later.", 429);
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      await recordLoginFailure(email);
      return fail("Your current password is not right.", 400);
    }
    await clearLoginFailures(email);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), passwordUpdatedAt: new Date() },
  });
  // Re-stamp this device's session after passwordUpdatedAt, so only the
  // other devices are signed out.
  await unstable_update({});

  return NextResponse.json({ success: true, data: { hasPassword: true } });
}
