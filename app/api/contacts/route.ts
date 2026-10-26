import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { resolveSetterAccount } from "@/lib/ai-setter/route-access";
import { conversationWhere, parseContactFilter, withoutInboxStatus } from "@/lib/inbox/filters";
import { CONTACT_ROW_SELECT, toContactRow } from "@/lib/inbox/contacts-list";
import { parseCustomFields } from "@/lib/inbox/contact";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Distinct tags and field names are read from this many contacts at most. */
const FACET_SCAN_MAX = 2_000;

function positiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/**
 * Contacts of one account (every mirrored conversation), newest activity
 * first, with tag, field and free-text filters (lib/inbox/filters.ts).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const access = await resolveSetterAccount(params.get("instagramAccountId"));
  if (!access.ok) return access.response;
  const { account } = access;

  const contactFilter = withoutInboxStatus(parseContactFilter(params));
  const page = positiveInt(params.get("page"), 1, 10_000);
  const limit = positiveInt(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const where = conversationWhere(account.id, contactFilter);

  try {
    const [total, rows, facets] = await Promise.all([
      prisma.dmConversation.count({ where }),
      prisma.dmConversation.findMany({
        where,
        select: CONTACT_ROW_SELECT,
        orderBy: [{ lastInboundAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.dmConversation.findMany({
        where: { instagramAccountId: account.id },
        select: { tags: true, customFields: true },
        orderBy: { updatedAt: "desc" },
        take: FACET_SCAN_MAX,
      }),
    ]);

    const tags = new Set<string>();
    const fieldKeys = new Set<string>();
    for (const row of facets) {
      for (const tag of row.tags) tags.add(tag);
      for (const key of Object.keys(parseCustomFields(row.customFields))) fieldKeys.add(key);
    }

    return NextResponse.json({
      success: true,
      data: {
        contacts: rows.map(toContactRow),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        availableTags: [...tags].sort((a, b) => a.localeCompare(b)),
        fieldKeys: [...fieldKeys].sort((a, b) => a.localeCompare(b)),
      },
    });
  } catch (error) {
    console.error("[Contacts] list failed:", error);
    return NextResponse.json({ success: false, error: "Failed to load contacts" }, { status: 500 });
  }
}
