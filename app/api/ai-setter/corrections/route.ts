import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import { prisma } from "@/lib/db/client";

const MAX_TEXT = 500;
const LIST_LIMIT = 200;

const createSchema = z.object({
  instagramAccountId: z.string().optional().nullable(),
  participantId: z.string().min(1).max(64),
  avoidText: z.string().max(MAX_TEXT).optional().nullable(),
  preferText: z.string().max(MAX_TEXT).optional().nullable(),
  note: z.string().max(MAX_TEXT).optional().nullable(),
});

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Contact-scoped voice corrections for one account, newest first.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const resolved = await resolveSetterAccount(params.get("instagramAccountId"));
  if (!resolved.ok) return resolved.response;

  const participantId = params.get("participantId");
  const corrections = await prisma.voiceCorrection.findMany({
    where: {
      instagramAccountId: resolved.account.id,
      ...(participantId ? { conversation: { participantId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      kind: true,
      avoidText: true,
      preferText: true,
      note: true,
      createdAt: true,
      conversation: { select: { participantId: true, participantUsername: true } },
    },
  });

  return NextResponse.json({ success: true, data: { corrections } });
}

// Add a manual correction for one contact (thread).
export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ success: false, error: "Invalid correction" }, { status: 400 });
  }

  const avoidText = clean(parsed.avoidText);
  const preferText = clean(parsed.preferText);
  const note = clean(parsed.note);
  if (!avoidText && !preferText && !note) {
    return NextResponse.json(
      { success: false, error: "Add what to avoid, what to say instead, or a note." },
      { status: 400 }
    );
  }

  const resolved = await resolveSetterAccount(parsed.instagramAccountId);
  if (!resolved.ok) return resolved.response;

  const conversation = await prisma.dmConversation.findFirst({
    where: { instagramAccountId: resolved.account.id, participantId: parsed.participantId },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json({ success: false, error: "Contact not found" }, { status: 404 });
  }

  const correction = await prisma.voiceCorrection.create({
    data: {
      instagramAccountId: resolved.account.id,
      conversationId: conversation.id,
      kind: "MANUAL",
      avoidText,
      preferText,
      note,
    },
  });
  return NextResponse.json({ success: true, data: { correction } });
}

// Delete one correction (scoped to the caller's account).
export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
  }
  const resolved = await resolveSetterAccount(params.get("instagramAccountId"));
  if (!resolved.ok) return resolved.response;

  const result = await prisma.voiceCorrection.deleteMany({
    where: { id, instagramAccountId: resolved.account.id },
  });
  if (result.count === 0) {
    return NextResponse.json({ success: false, error: "Correction not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { removed: true } });
}
