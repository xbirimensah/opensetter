/**
 * The instance operator: the person who runs this server. Only their
 * workspaces may use server-level resources that aren't tied to a
 * workspace: the local CLI login (claude/codex under the server's user),
 * the env API key fallback, and the knowledge base. Everyone else brings
 * their own provider key, so a teammate's or invitee's workspace can never
 * spend the operator's subscription or read their private notes.
 *
 * OPENSETTER_OPERATOR_EMAILS (comma-separated) names the operators. In
 * production it is required (lib/startup-checks.ts): "oldest account"
 * would silently move to someone else after a restore or a deleted user.
 * Outside production, the first account on the instance is the operator.
 */

import { prisma } from "@/lib/db/client";

const CACHE_MS = 60_000;
const cache = new Map<string, { value: boolean; at: number }>();

function configuredOperatorEmails(): string[] | null {
  const raw = process.env.OPENSETTER_OPERATOR_EMAILS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function lookup(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { owner: { select: { id: true, email: true } } },
  });
  if (!workspace?.owner) return false;

  const emails = configuredOperatorEmails();
  if (emails) return Boolean(workspace.owner.email && emails.includes(workspace.owner.email.toLowerCase()));
  if (process.env.NODE_ENV === "production") return false;

  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return firstUser?.id === workspace.owner.id;
}

export async function isOperatorWorkspace(workspaceId: string | null | undefined): Promise<boolean> {
  if (!workspaceId) return false;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await lookup(workspaceId);
  cache.set(workspaceId, { value, at: Date.now() });
  return value;
}
