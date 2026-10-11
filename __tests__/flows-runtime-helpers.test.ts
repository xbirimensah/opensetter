import { describe, expect, it } from "vitest";
import { checkInput, extractEmail, normalizePhone } from "@/lib/flows/input-validation";
import { matchKeyword, pickTrigger } from "@/lib/flows/trigger-match";
import { renderTemplate } from "@/lib/flows/variables";
import { isPrivateAddress } from "@/lib/flows/safe-http";
import { isMetaCdnUrl } from "@/lib/media/inbound";
import type { FlowContact } from "@/lib/flows/variables";

const contact: FlowContact = {
  conversationId: "c",
  participantId: "p",
  username: "max.mustermann",
  name: "Max Mustermann",
  email: "max@example.de",
  phone: null,
  tags: [],
  customFields: { plan: "pro" },
  lastInput: "ja",
  lastInboundAt: null,
  aiEnabled: true,
};

describe("input validation", () => {
  it("extracts emails from sentences and lowercases them", () => {
    expect(extractEmail("klar, Max.M@Example.de danke!")).toBe("max.m@example.de");
    expect(extractEmail("keine mail")).toBeNull();
    expect(checkInput("email", "max@example")).toEqual({ ok: false });
  });

  it("normalizes phones and rejects sentences", () => {
    expect(normalizePhone("+49 151 2345 6789")).toBe("+4915123456789");
    expect(normalizePhone("0049 151 23456789")).toBe("+4915123456789");
    expect(normalizePhone("ruf mich an unter 0151 2345")).toBeNull();
  });

  it("checks numbers and urls", () => {
    expect(checkInput("number", "1.500,5")).toEqual({ ok: false });
    expect(checkInput("number", "12,5")).toEqual({ ok: true, value: "12.5" });
    expect(checkInput("url", "example.de")).toEqual({ ok: true, value: "https://example.de/" });
  });
});

describe("trigger matching", () => {
  it("supports is, contains, whole word and begins with, case-insensitively", () => {
    expect(matchKeyword("Matrix bitte", ["matrix"], "begins_with")).toBe("matrix");
    expect(matchKeyword("ich will die MATRIX", ["matrix"], "whole_word")).toBe("matrix");
    expect(matchKeyword("matrixen", ["matrix"], "whole_word")).toBeNull();
    expect(matchKeyword("matrix", ["Matrix"], "is")).toBe("Matrix");
    expect(matchKeyword("die ad-matrix", ["matrix"], "contains")).toBe("matrix");
  });

  it("prefers story mentions over keywords and respects exclusions", () => {
    const candidates = [
      { flowId: "kw", createdAt: new Date(1), triggers: [{ id: "t1", type: "dm_keyword" as const, keywords: ["matrix"], match: "contains" as const, excludeKeywords: ["stop"] }] },
      { flowId: "mention", createdAt: new Date(2), triggers: [{ id: "t2", type: "story_mention" as const }] },
      { flowId: "fallback", createdAt: new Date(3), triggers: [{ id: "t3", type: "default_reply" as const }] },
    ];
    const base = { type: "message" as const, isStoryReply: false, isNewContact: false, aiActive: true };
    expect(pickTrigger(candidates, { ...base, text: "matrix pls", isStoryMention: false })?.flowId).toBe("kw");
    expect(pickTrigger(candidates, { ...base, text: "", isStoryMention: true })?.flowId).toBe("mention");
    expect(pickTrigger(candidates, { ...base, text: "matrix stop", isStoryMention: false })).toBeNull();
    expect(pickTrigger(candidates, { ...base, text: "hi", isStoryMention: false, aiActive: false })?.flowId).toBe("fallback");
  });

  it("matches ref links", () => {
    const candidates = [{ flowId: "ref", createdAt: new Date(1), triggers: [{ id: "t", type: "ref_link" as const, ref: "Matrix" }] }];
    expect(pickTrigger(candidates, { type: "referral", ref: "matrix" })?.flowId).toBe("ref");
  });
});

describe("variables", () => {
  it("renders known variables and blanks unknown ones", () => {
    expect(renderTemplate("Hey {{first_name}}, {{field.plan}} {{nope}}!", { contact })).toBe("Hey Max, pro !");
  });

  it("escapes values in JSON mode", () => {
    const tricky = { ...contact, username: 'a"b\\c' };
    expect(renderTemplate('{"u":"{{username}}"}', { contact: tricky }, { json: true })).toBe('{"u":"a\\"b\\\\c"}');
    expect(JSON.parse(renderTemplate('{"u":"{{username}}"}', { contact: tricky }, { json: true }))).toEqual({ u: 'a"b\\c' });
  });
});

describe("network guards", () => {
  it("blocks private, loopback, CGNAT and link-local addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "192.168.1.35", "100.64.12.34", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("only treats Meta CDN hosts as downloadable inbound media", () => {
    expect(isMetaCdnUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBe(true);
    expect(isMetaCdnUrl("https://scontent-fra5-1.cdninstagram.com/v/t51.jpg")).toBe(true);
    expect(isMetaCdnUrl("https://evil.example.com/lookaside.fbsbx.com")).toBe(false);
    expect(isMetaCdnUrl("http://lookaside.fbsbx.com/x")).toBe(false);
  });
});
