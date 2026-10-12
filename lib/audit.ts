/**
 * Audit trail for security-relevant actions: sign-ins (and failed ones),
 * password changes, team and role changes, Instagram connections, model
 * provider keys. Stored as OperationalEvent rows with source AUDIT, so
 * Diagnostics can show them. Never throws: a failed audit write must not
 * break the action it records. Never pass secrets in `detail`.
 */

import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";

export type AuditAction =
  | "auth.password_login"
  | "auth.password_login_failed"
  | "auth.email_link_requested"
  | "auth.password_changed"
  | "workspace.member_invited"
  | "workspace.member_role_changed"
  | "workspace.member_removed"
  | "workspace.invitation_revoked"
  | "instagram.connected"
  | "instagram.disconnected"
  | "ai.provider_key_saved"
  | "ai.provider_key_removed"
  | "ai.setter_mode_changed";

export async function audit(event: {
  action: AuditAction;
  workspaceId?: string | null;
  actorUserId?: string | null;
  ip?: string | null;
  detail?: Record<string, string | number | boolean | null>;
  level?: "INFO" | "WARNING";
}): Promise<void> {
  try {
    await prisma.operationalEvent.create({
      data: {
        source: "AUDIT",
        level: event.level ?? "INFO",
        workspaceId: event.workspaceId ?? null,
        message: event.action,
        payload: {
          actorUserId: event.actorUserId ?? null,
          ip: event.ip ?? null,
          ...(event.detail ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.warn(`[audit] could not record ${event.action}:`, error);
  }
}
