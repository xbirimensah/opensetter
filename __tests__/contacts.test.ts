/**
 * Contacts page and inbox search: filter parsing, the Prisma where clause,
 * CSV export (formula-safe) and the routes' account scoping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveSetterAccount: vi.fn(),
  audit: vi.fn(),
  prisma: {
    dmConversation: { count: vi.fn(), findMany: vi.fn() },
    dmMessage: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/ai-setter/route-access", () => ({ resolveSetterAccount: mocks.resolveSetterAccount }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));

import {
  coerceFieldValue,
  contactFilterParams,
  conversationWhere,
  hasActiveFilter,
  parseContactFilter,
} from "@/lib/inbox/filters";
import { contactsToCsv, csvCell, toContactRow, type ContactRowSource } from "@/lib/inbox/contacts-list";
import { GET as listContacts } from "../app/api/contacts/route";
import { GET as exportContacts } from "../app/api/contacts/export/route";
import { GET as listConversations } from "../app/api/inbox/conversations/route";

const source = (overrides: Partial<ContactRowSource> = {}): ContactRowSource => ({
  id: "conv1",
  participantId: "1789",
  participantUsername: "lena.coach",
  email: "lena@example.com",
  phone: null,
  tags: ["lead", "webinar"],
  customFields: { budget: 2000, goal: "Kurs launchen" },
  lastInboundAt: new Date("2026-10-20T10:00:00Z"),
  lastOutboundAt: null,
  createdAt: new Date("2026-10-01T08:00:00Z"),
  flowRuns: [{ flow: { name: "Ad-Matrix" } }],
  ...overrides,
});

describe("contact filters", () => {
  it("parses and round-trips known params, drops junk", () => {
    const params = new URLSearchParams({
      q: "  @lena ",
      tag: "lead",
      status: "held_draft",
      hasEmail: "1",
      fieldKey: "budget",
      fieldValue: "2000",
      evil: "x",
    });
    const filter = parseContactFilter(params);
    expect(filter).toEqual({ q: "@lena", tag: "lead", status: "held_draft", hasEmail: true, field: { key: "budget", value: "2000" } });
    expect(parseContactFilter(contactFilterParams(filter))).toEqual(filter);
    expect(parseContactFilter(new URLSearchParams({ status: "drop table", fieldKey: "a;b", fieldValue: "1" }))).toEqual({});
    expect(hasActiveFilter({})).toBe(false);
  });

  it("builds an account-scoped where clause", () => {
    const where = conversationWhere("acc1", { q: "@lena", tag: "lead", status: "active_flow" }, { searchMessages: true });
    const and = (where.AND as object[]) ?? [];
    expect(and[0]).toEqual({ instagramAccountId: "acc1" });
    expect(JSON.stringify(and[1])).toContain('"participantUsername":{"contains":"lena","mode":"insensitive"}');
    expect(JSON.stringify(and[1])).toContain('"messages"');
    expect(and).toContainEqual({ tags: { has: "lead" } });
    expect(and).toContainEqual({ flowRuns: { some: { status: { in: ["RUNNING", "WAITING"] } } } });
    expect(JSON.stringify(conversationWhere("acc1", { q: "x" }))).not.toContain('"messages"');
  });

  it("matches custom fields stored as text or as typed values", () => {
    expect(coerceFieldValue("2000")).toBe(2000);
    expect(coerceFieldValue("true")).toBe(true);
    expect(coerceFieldValue("01234 Berlin")).toBe("01234 Berlin");
    const and = conversationWhere("acc1", { field: { key: "budget", value: "2000" } }).AND as object[];
    expect(and[1]).toEqual({
      OR: [{ customFields: { path: ["budget"], equals: "2000" } }, { customFields: { path: ["budget"], equals: 2000 } }],
    });
  });
});

describe("contacts CSV", () => {
  it("defuses spreadsheet formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+49 151 234")).toBe("'+49 151 234");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });

  it("writes one column per custom field", () => {
    const csv = contactsToCsv([toContactRow(source()), toContactRow(source({ id: "c2", customFields: { city: "Köln" } }))]);
    const [header, first, second] = csv.trim().split("\r\n");
    expect(header).toBe(
      "username,instagram_id,email,phone,tags,first_seen,last_message_from_contact,last_message_from_you,active_flow,field:budget,field:goal,field:city"
    );
    expect(first).toBe("lena.coach,1789,lena@example.com,,lead; webinar,2026-10-01T08:00:00.000Z,2026-10-20T10:00:00.000Z,,Ad-Matrix,2000,Kurs launchen,");
    expect(second.endsWith(",,,Köln")).toBe(true);
  });
});

const account = { id: "acc1", username: "your.account", instagramId: "17841", accessToken: "enc" };
const context = { workspaceId: "ws1", userId: "u1", role: "MEMBER" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSetterAccount.mockResolvedValue({ ok: true, account, context });
});

describe("GET /api/contacts", () => {
  it("lists contacts of the caller's account with facets", async () => {
    mocks.prisma.dmConversation.count.mockResolvedValue(1);
    mocks.prisma.dmConversation.findMany
      .mockResolvedValueOnce([source()])
      .mockResolvedValueOnce([{ tags: ["webinar", "lead"], customFields: { budget: 1 } }]);
    const res = await listContacts(new NextRequest("http://localhost/api/contacts?instagramAccountId=acc1&tag=lead&status=needs_reply&page=2&limit=999"));
    const body = await res.json();
    expect(body.data.contacts[0]).toMatchObject({ username: "lena.coach", activeFlow: "Ad-Matrix", customFields: { budget: 2000 } });
    expect(body.data).toMatchObject({ availableTags: ["lead", "webinar"], fieldKeys: ["budget"], pagination: { page: 2, limit: 200 } });
    const query = mocks.prisma.dmConversation.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual([{ instagramAccountId: "acc1" }, { tags: { has: "lead" } }]);
    expect(query.skip).toBe(200);
  });

  it("refuses without access", async () => {
    mocks.resolveSetterAccount.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await listContacts(new NextRequest("http://localhost/api/contacts"))).status).toBe(401);
  });
});

describe("GET /api/contacts/export", () => {
  it("returns a CSV attachment and records who exported", async () => {
    mocks.prisma.dmConversation.findMany.mockResolvedValue([source()]);
    const res = await exportContacts(new NextRequest("http://localhost/api/contacts/export?instagramAccountId=acc1&hasEmail=1"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="contacts-your\.account-\d{4}-\d{2}-\d{2}\.csv"$/);
    // text() would strip the BOM while decoding; check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3, 12))).toBe("username,");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contacts.exported", workspaceId: "ws1", actorUserId: "u1", detail: { instagramAccountId: "acc1", rows: 1 } })
    );
  });
});

describe("GET /api/inbox/conversations with filters", () => {
  const message = (conversationId: string, direction: "IN" | "OUT") => ({
    conversationId,
    direction,
    source: direction === "IN" ? "PARTICIPANT" : "HUMAN",
    text: "hi",
    kind: "text",
    attachments: null,
    deletedAt: null,
    sentAt: new Date("2026-10-20T10:00:00Z"),
  });

  it("narrows to matching threads and keeps those waiting on a reply", async () => {
    mocks.prisma.dmConversation.findMany
      .mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]) // candidates
      .mockResolvedValueOnce([
        { id: "c1", participantId: "p1", participantUsername: "a", tags: ["lead"], flowRuns: [] },
        { id: "c2", participantId: "p2", participantUsername: "b", tags: [], flowRuns: [] },
      ])
      .mockResolvedValueOnce([{ tags: ["lead"] }]); // tag facet
    const sentAt = new Date("2026-10-20T10:00:00Z");
    mocks.prisma.dmMessage.groupBy.mockResolvedValue([
      { conversationId: "c1", _max: { sentAt } },
      { conversationId: "c2", _max: { sentAt } },
    ]);
    mocks.prisma.dmMessage.findMany.mockResolvedValue([message("c1", "IN"), message("c2", "OUT")]);

    const res = await listConversations(
      new NextRequest("http://localhost/api/inbox/conversations?instagramAccountId=acc1&q=hi&status=needs_reply")
    );
    const body = await res.json();
    expect(body.data.filtered).toBe(true);
    expect(body.data.conversations.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(body.data.conversations[0].tags).toEqual(["lead"]);
    expect(body.data.availableTags).toEqual(["lead"]);
    expect(mocks.prisma.dmMessage.groupBy.mock.calls[0][0].where).toEqual({ conversationId: { in: ["c1", "c2"] } });
  });

  it("returns an empty mirror list, not Meta's live inbox, when nothing matches", async () => {
    mocks.prisma.dmConversation.findMany.mockResolvedValueOnce([]).mockResolvedValue([]);
    mocks.prisma.dmMessage.groupBy.mockResolvedValue([]);
    mocks.prisma.dmMessage.findMany.mockResolvedValue([]);
    const res = await listConversations(new NextRequest("http://localhost/api/inbox/conversations?instagramAccountId=acc1&q=nobody"));
    const body = await res.json();
    expect(body.data).toMatchObject({ mode: "mirror", conversations: [], filtered: true });
  });
});
