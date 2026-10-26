import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import { conversationWhere, parseContactFilter, withoutInboxStatus } from "@/lib/inbox/filters";
import { CONTACT_ROW_SELECT, contactsToCsv, toContactRow } from "@/lib/inbox/contacts-list";

/** One export holds at most this many contacts. */
const EXPORT_MAX = 50_000;

/** CSV of the contacts matching the same filters as the Contacts page. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const access = await resolveSetterAccount(params.get("instagramAccountId"));
  if (!access.ok) return access.response;
  const { account, context } = access;

  const filter = withoutInboxStatus(parseContactFilter(params));
  try {
    const rows = await prisma.dmConversation.findMany({
      where: conversationWhere(account.id, filter),
      select: CONTACT_ROW_SELECT,
      orderBy: [{ lastInboundAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: EXPORT_MAX,
    });
    // Contact data leaves the app here: keep a record of who took it.
    await audit({
      action: "contacts.exported",
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      detail: { instagramAccountId: account.id, rows: rows.length },
    });
    const date = new Date().toISOString().slice(0, 10);
    const name = `contacts-${(account.username || "instagram").replace(/[^\w.-]/g, "")}-${date}.csv`;
    // BOM so Excel reads UTF-8 (umlauts, emoji) correctly.
    return new NextResponse(`\uFEFF${contactsToCsv(rows.map(toContactRow))}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Contacts] export failed:", error);
    return NextResponse.json({ success: false, error: "Export failed" }, { status: 500 });
  }
}
