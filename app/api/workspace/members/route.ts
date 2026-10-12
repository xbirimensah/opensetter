import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  buildInvitationUrl,
  generateInvitationToken,
  getInvitationExpiry,
  normalizeInvitationEmail,
} from "@/lib/workspace-invitations";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

const updateMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

const deleteSchema = z.object({
  memberId: z.string().min(1).optional(),
  invitationId: z.string().min(1).optional(),
});

async function getMemberPayload(
  workspaceId: string,
  currentUserRole?: "OWNER" | "ADMIN" | "MEMBER"
) {
  const [members, invitations] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
    prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  // Invite links are bearer links: only people who manage the workspace see them.
  const canSeeLinks = currentUserRole ? canManageWorkspace(currentUserRole) : false;
  return {
    ...(currentUserRole ? { currentUserRole } : {}),
    members,
    invitations: invitations.map(({ token, ...invitation }) => ({
      ...invitation,
      ...(canSeeLinks ? { inviteUrl: buildInvitationUrl(token) } : {}),
    })),
  };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      ...(await getMemberPayload(context.workspaceId, context.role)),
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can invite members" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid invitation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.role === "ADMIN" && context.role !== "OWNER") {
    return NextResponse.json(
      { success: false, error: "Only the owner can invite admins" },
      { status: 403 }
    );
  }

  const email = normalizeInvitationEmail(parsed.data.email);
  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId: context.workspaceId, user: { email } },
    select: { id: true },
  });
  if (existingMember) {
    // Never change an existing member's role here: that is how an admin
    // could demote the owner. Roles change through PATCH, with its checks.
    return NextResponse.json(
      { success: false, error: "Already a member. Change their role in the member list." },
      { status: 409 }
    );
  }

  // Everyone, existing users included, gets an invitation they must accept:
  // nobody is added to a workspace without saying yes.
  {
    await prisma.workspaceInvitation.upsert({
      where: {
        workspaceId_email: {
          workspaceId: context.workspaceId,
          email,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        email,
        role: parsed.data.role,
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
      },
      update: {
        role: parsed.data.role,
        status: "PENDING",
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
      },
    });
  }
  await audit({
    action: "workspace.member_invited",
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    detail: { email, role: parsed.data.role },
  });

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update roles" },
      { status: 403 }
    );
  }

  const parsed = updateMemberSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid member update" },
      { status: 400 }
    );
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
  });
  if (!member || member.role === "OWNER" || member.userId === context.userId) {
    return NextResponse.json(
      { success: false, error: "Member cannot be updated" },
      { status: 400 }
    );
  }
  if ((member.role === "ADMIN" || parsed.data.role === "ADMIN") && context.role !== "OWNER") {
    return NextResponse.json(
      { success: false, error: "Only the owner can grant or remove admin rights" },
      { status: 403 }
    );
  }

  await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
  });
  await audit({
    action: "workspace.member_role_changed",
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    detail: { memberUserId: member.userId, from: member.role, to: parsed.data.role },
  });

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can remove members" },
      { status: 403 }
    );
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.memberId && !parsed.data.invitationId)) {
    return NextResponse.json(
      { success: false, error: "Missing member or invitation ID" },
      { status: 400 }
    );
  }

  if (parsed.data.memberId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
    });
    if (!member || member.role === "OWNER" || member.userId === context.userId) {
      return NextResponse.json(
        { success: false, error: "Member cannot be removed" },
        { status: 400 }
      );
    }
    if (member.role === "ADMIN" && context.role !== "OWNER") {
      return NextResponse.json(
        { success: false, error: "Only the owner can remove an admin" },
        { status: 403 }
      );
    }

    await prisma.workspaceMember.delete({ where: { id: member.id } });
    await audit({
      action: "workspace.member_removed",
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      detail: { memberUserId: member.userId, role: member.role },
    });
  }

  if (parsed.data.invitationId) {
    await prisma.workspaceInvitation.updateMany({
      where: {
        id: parsed.data.invitationId,
        workspaceId: context.workspaceId,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });
    await audit({
      action: "workspace.invitation_revoked",
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      detail: { invitationId: parsed.data.invitationId },
    });
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}
