import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AiSetterMode } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const patchSchema = z.object({
  instagramAccountId: z.string().optional().nullable(),
  participantId: z.string().min(1),
  aiEnabled: z.boolean().optional(),
  /**
   * Per-thread mode: OFF, DRAFT, or AUTO. null resets the thread to the
   * account's default. Omitted leaves the current value alone.
   */
  modeOverride: z.enum(["OFF", "DRAFT", "AUTO"]).nullable().optional(),
});

// Per-thread AI state for the inbox: mode, toggle, and any held draft
// waiting for review, keyed by the participant's IGSID.
export async function GET(request: NextRequest) {
  const access = await resolveSetterAccount(
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!access.ok) return access.response;
  const { account } = access;

  const conversations = await prisma.dmConversation.findMany({
    where: { instagramAccountId: account.id },
    select: {
      participantId: true,
      participantUsername: true,
      aiEnabled: true,
      modeOverride: true,
      humanTakeoverAt: true,
      lastInboundAt: true,
      aiReplies: {
        where: { status: "HELD" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          draftText: true,
          confidence: true,
          reasons: true,
          createdAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      conversations: conversations.map((conversation) => ({
        participantId: conversation.participantId,
        participantUsername: conversation.participantUsername,
        aiEnabled: conversation.aiEnabled,
        modeOverride: conversation.modeOverride,
        humanTakeoverAt: conversation.humanTakeoverAt,
        lastInboundAt: conversation.lastInboundAt,
        heldDraft: conversation.aiReplies[0] ?? null,
      })),
    },
  });
}

type ThreadState = {
  aiEnabled: boolean;
  modeOverride: AiSetterMode | null;
};

/** True when the thread would send unattended under this state. */
function autoSends(thread: ThreadState, accountMode: AiSetterMode): boolean {
  return thread.aiEnabled && (thread.modeOverride ?? accountMode) === "AUTO";
}

/**
 * Why a member may not apply this change, or null when it is safe.
 * Members may pause, kill, or move a thread to drafts, but nothing that
 * makes it auto-send: no AUTO pin (it would survive an admin switching
 * the account off autopilot), no reset or re-enable that lands on an
 * AUTO account default.
 */
function memberAutopilotViolation(
  current: ThreadState,
  next: ThreadState,
  accountMode: AiSetterMode
): string | null {
  if (next.modeOverride === "AUTO" && current.modeOverride !== "AUTO") {
    return "Only workspace owners and admins can put a thread on auto-send.";
  }
  if (autoSends(next, accountMode) && !autoSends(current, accountMode)) {
    return "Only workspace owners and admins can resume auto-send on a thread.";
  }
  return null;
}

// Update a thread's AI state. When an owner or admin sets a mode (or
// re-enables the thread) the human takeover pause is cleared so the
// setter resumes immediately; a member's change never clears it.
export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    context.workspaceId,
    parsed.instagramAccountId ?? null
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }
  const canManage = canManageWorkspace(context.role);

  const where = {
    instagramAccountId_participantId: {
      instagramAccountId: account.id,
      participantId: parsed.participantId,
    },
  };

  if (!canManage) {
    // Fails closed: without a stored config the account mode is OFF,
    // matching the worker, which never acts without one.
    const [config, stored] = await Promise.all([
      prisma.aiSetterConfig.findUnique({
        where: { instagramAccountId: account.id },
        select: { mode: true },
      }),
      prisma.dmConversation.findUnique({
        where,
        select: { aiEnabled: true, modeOverride: true },
      }),
    ]);
    const current: ThreadState = stored ?? { aiEnabled: true, modeOverride: null };
    const next: ThreadState = {
      aiEnabled: parsed.aiEnabled ?? current.aiEnabled,
      modeOverride:
        parsed.modeOverride === undefined ? current.modeOverride : parsed.modeOverride,
    };
    const violation = memberAutopilotViolation(current, next, config?.mode ?? "OFF");
    if (violation) {
      return NextResponse.json({ success: false, error: violation }, { status: 403 });
    }
  }

  const resumesAi =
    canManage &&
    (parsed.aiEnabled === true ||
      parsed.modeOverride === "DRAFT" ||
      parsed.modeOverride === "AUTO");

  const changes = {
    ...(parsed.aiEnabled !== undefined ? { aiEnabled: parsed.aiEnabled } : {}),
    ...(parsed.modeOverride !== undefined
      ? { modeOverride: parsed.modeOverride }
      : {}),
    ...(resumesAi ? { humanTakeoverAt: null } : {}),
  };

  const conversation = await prisma.dmConversation.upsert({
    where,
    create: {
      instagramAccountId: account.id,
      participantId: parsed.participantId,
      aiEnabled: parsed.aiEnabled ?? true,
      modeOverride: parsed.modeOverride ?? null,
    },
    update: changes,
  });

  return NextResponse.json({ success: true, data: { conversation } });
}
