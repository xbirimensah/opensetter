/**
 * Who may get an email sign-in link. Without this, the email provider
 * creates an account (and an OWNER workspace) for any address. Allowed:
 *   - people who already have an account,
 *   - people with a pending, unexpired workspace invitation,
 *   - addresses in OPENSETTER_ALLOWED_EMAILS or OPENSETTER_OPERATOR_EMAILS,
 *   - outside production, anyone while the instance has no users yet
 *     (local first run). In production the first account must be listed
 *     in the env, so a fresh deploy can't be claimed by whoever is first.
 */

import { prisma } from "@/lib/db/client";

function envEmails(): string[] {
  return [process.env.OPENSETTER_ALLOWED_EMAILS, process.env.OPENSETTER_OPERATOR_EMAILS]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isEmailAllowedToSignIn(rawEmail: string | null | undefined): Promise<boolean> {
  const email = (rawEmail ?? "").trim().toLowerCase();
  if (!email) return false;
  if (envEmails().includes(email)) return true;

  const [user, invitation, userCount] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.workspaceInvitation.findFirst({
      where: { email, status: "PENDING", expiresAt: { gt: new Date() } },
      select: { id: true },
    }),
    prisma.user.count(),
  ]);
  const firstRun = userCount === 0 && process.env.NODE_ENV !== "production";
  return Boolean(user || invitation || firstRun);
}
