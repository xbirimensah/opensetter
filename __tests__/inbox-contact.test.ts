/**
 * Inbox contact edits (validation + merge), display helpers and the
 * client thread merge.
 */

import { describe, it, expect } from "vitest";
import { applyContactPatch, contactPatchSchema, parseCustomFields } from "../lib/inbox/contact";
import { linkify, ownText, postbackLabel, previewText, isLegacyMedia } from "../lib/inbox/display";
import { mergeMessages } from "../lib/inbox/thread";
import type { InboxMessage } from "../lib/inbox/types";

const now = new Date("2026-10-12T10:00:00Z");
const base = { email: null, phone: null, tags: ["VIP"], customFields: { plan: "pro" } };

describe("contactPatchSchema", () => {
  it("accepts a full edit", () => {
    const parsed = contactPatchSchema.safeParse({
      email: " a@b.co ",
      phone: "+49 151 2345678",
      addTags: ["lead"],
      removeTags: ["VIP"],
      setFields: { city: "Berlin", score: 3, booked: true },
      unsetFields: ["plan"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.email).toBe("a@b.co");
  });

  it("treats an empty email or phone as clearing it", () => {
    expect(contactPatchSchema.parse({ email: "" }).email).toBeNull();
    expect(contactPatchSchema.parse({ phone: "  " }).phone).toBeNull();
  });

  it.each([
    [{}],
    [{ email: "not-an-email" }],
    [{ phone: "call me" }],
    [{ phone: "+1" }],
    [{ addTags: [""] }],
    [{ addTags: ["a\nb"] }],
    [{ setFields: { "": "x" } }],
    [{ setFields: { __proto__: "x" } }],
    [{ setFields: JSON.parse('{"__proto__": "x"}') }],
    [{ setFields: { "bad/key": "x" } }],
    [{ setFields: { k: { nested: true } } }],
    [{ unknown: 1 }],
  ])("rejects %j", (body) => {
    expect(contactPatchSchema.safeParse(body).success).toBe(false);
  });
});

describe("applyContactPatch", () => {
  it("stamps capture times only when a value changes", () => {
    const result = applyContactPatch(base, { email: "a@b.co" }, now);
    expect(result).toEqual({ ok: true, data: { email: "a@b.co", emailCapturedAt: now } });
    const same = applyContactPatch({ ...base, email: "a@b.co" }, { email: "a@b.co" }, now);
    expect(same).toEqual({ ok: true, data: {} });
    const cleared = applyContactPatch({ ...base, phone: "+491" }, { phone: null }, now);
    expect(cleared).toEqual({ ok: true, data: { phone: null, phoneCapturedAt: null } });
  });

  it("adds tags without case duplicates and removes exact matches", () => {
    const result = applyContactPatch(base, { addTags: ["vip", "lead"], removeTags: [] }, now);
    expect(result).toEqual({ ok: true, data: { tags: ["VIP", "lead"] } });
    const removed = applyContactPatch(base, { removeTags: ["VIP"] }, now);
    expect(removed).toEqual({ ok: true, data: { tags: [] } });
  });

  it("sets and unsets custom fields without touching the original", () => {
    const current = { ...base, customFields: { plan: "pro", city: "Rome" } };
    const result = applyContactPatch(current, { setFields: { city: "Berlin" }, unsetFields: ["plan"] }, now);
    expect(result).toEqual({ ok: true, data: { customFields: { city: "Berlin" } } });
    expect(current.customFields).toEqual({ plan: "pro", city: "Rome" });
  });

  it("enforces the total tag limit", () => {
    const many = { ...base, tags: Array.from({ length: 100 }, (_, i) => `t${i}`) };
    const result = applyContactPatch(many, { addTags: ["one-more"] }, now);
    expect(result.ok).toBe(false);
  });

  it("ignores malformed stored fields", () => {
    expect(parseCustomFields({ ok: "x", n: 1, bad: { a: 1 }, nan: Number.NaN })).toEqual({ ok: "x", n: 1 });
    expect(parseCustomFields(["x"])).toEqual({});
  });
});

describe("display helpers", () => {
  it("keeps only the person's words in a story reply", () => {
    expect(
      ownText({ text: "so good!\n[Shared story]", attachments: [{ type: "story", servable: true }] })
    ).toBe("so good!");
    expect(ownText({ text: "[Voice message]", attachments: [{ type: "audio", servable: true }] })).toBe("");
    expect(ownText({ text: "[Unsupported message]", attachments: [] })).toBe("");
  });

  it("reads list previews and tapped buttons", () => {
    expect(previewText("[Voice message]")).toBe("Voice message");
    expect(previewText("hey\n[Shared reel] my caption")).toBe("hey · Shared reel: my caption");
    expect(postbackLabel("[Button: Get the guide]")).toBe("Get the guide");
    expect(postbackLabel("Yes please")).toBe("Yes please");
  });

  it("detects legacy media rows", () => {
    expect(isLegacyMedia({ text: "[media]", attachments: [] })).toBe(true);
    expect(isLegacyMedia({ text: "[Photo]", attachments: [{ type: "image", servable: true }] })).toBe(false);
  });

  it("linkifies http(s) and www links without trailing punctuation", () => {
    expect(linkify("see https://x.test/a, and www.y.test.")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://x.test/a", href: "https://x.test/a" },
      { type: "text", value: ", and " },
      { type: "link", value: "www.y.test", href: "https://www.y.test" },
      { type: "text", value: "." },
    ]);
    expect(linkify("(https://x.test/a_(b))")[1]).toMatchObject({ value: "https://x.test/a_(b)" });
    expect(linkify("javascript:alert(1)")).toEqual([{ type: "text", value: "javascript:alert(1)" }]);
  });
});

describe("mergeMessages", () => {
  const msg = (id: string, sentAt: string, extra: Partial<InboxMessage> = {}): InboxMessage => ({
    id,
    mid: id,
    fromMe: false,
    source: "PARTICIPANT",
    kind: "text",
    text: id,
    attachments: [],
    replyToMid: null,
    reaction: null,
    editedAt: null,
    deletedAt: null,
    sentAt,
    ...extra,
  });

  it("updates in place, keeps older pages and drops a confirmed optimistic send", () => {
    const shown = [
      msg("a", "2026-10-12T09:00:00.000Z"),
      msg("b", "2026-10-12T09:01:00.000Z"),
      msg("tmp", "2026-10-12T09:02:00.000Z", { mid: "mid-c", pending: true, fromMe: true }),
    ];
    const fetched = [
      msg("b", "2026-10-12T09:01:00.000Z", { reaction: "❤️" }),
      msg("c", "2026-10-12T09:02:01.000Z", { mid: "mid-c", fromMe: true }),
    ];
    const merged = mergeMessages(shown, fetched);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(merged[1].reaction).toBe("❤️");
  });

  it("keeps an optimistic send until it is mirrored", () => {
    const shown = [msg("tmp", "2026-10-12T09:02:00.000Z", { mid: "optimistic-1", pending: true })];
    expect(mergeMessages(shown, [msg("a", "2026-10-12T09:00:00.000Z")]).map((m) => m.id)).toEqual(["a", "tmp"]);
  });
});
