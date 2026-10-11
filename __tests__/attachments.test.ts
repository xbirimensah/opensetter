import { describe, expect, it } from "vitest";
import {
  hasGraphContent,
  isMediaOnly,
  normalizeGraphMessage,
  normalizeWebhookMessage,
} from "@/lib/meta/attachments";
import { parseMessageUpdates, parseReferralEvents } from "@/lib/meta/webhook";

// Shapes below are trimmed copies of real payloads from this account's inbox.

describe("normalizeWebhookMessage", () => {
  it("turns a voice note into an audio attachment with a readable summary", () => {
    const result = normalizeWebhookMessage({
      mid: "m1",
      attachments: [{ type: "audio", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }],
    });
    expect(result.kind).toBe("audio");
    expect(result.text).toBe("[Voice message]");
    expect(result.attachments).toEqual([
      { type: "audio", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" },
    ]);
  });

  it("reads ManyChat generic template cards with open_url buttons", () => {
    const result = normalizeWebhookMessage({
      mid: "m2",
      attachments: [
        {
          type: "template",
          payload: {
            generic: {
              elements: [
                {
                  title: "hier ist der link zum Bundle",
                  buttons: [{ url: "https://my.manychat.com/r?act=1", type: "open_url", title: "mehr erfahren" }],
                },
              ],
            },
          },
        },
      ],
    });
    expect(result.kind).toBe("card");
    expect(result.text).toBe("hier ist der link zum Bundle\n[Button: mehr erfahren]");
    expect(result.attachments[0]).toMatchObject({
      type: "card",
      title: "hier ist der link zum Bundle",
      buttons: [{ title: "mehr erfahren", type: "url", url: "https://my.manychat.com/r?act=1" }],
    });
  });

  it("maps reels, posts, shared stories and mentions", () => {
    expect(
      normalizeWebhookMessage({
        attachments: [{ type: "ig_reel", payload: { url: "https://www.instagram.com/reel/X/", title: "Reel caption", reel_video_id: "9" } }],
      })
    ).toMatchObject({ kind: "reel", text: "[Shared reel] Reel caption" });
    expect(
      normalizeWebhookMessage({
        attachments: [{ type: "ig_post", payload: { url: "https://lookaside.fbsbx.com/x", title: "Post", ig_post_media_id: "1" } }],
      })
    ).toMatchObject({ kind: "post", attachments: [{ type: "post", mediaId: "1" }] });
    expect(
      normalizeWebhookMessage({
        attachments: [{ type: "ig_story", payload: { story_media_id: "5", story_media_url: "https://lookaside.fbsbx.com/s" } }],
      })
    ).toMatchObject({ kind: "share", attachments: [{ type: "story", storyId: "5", url: "https://lookaside.fbsbx.com/s" }] });
    expect(
      normalizeWebhookMessage({ attachments: [{ type: "story_mention", payload: { url: "https://lookaside.fbsbx.com/m" } }] })
    ).toMatchObject({ kind: "story_mention", text: "[Mentioned you in their story]" });
  });

  it("keeps the text of a story reply and flags the kind", () => {
    const result = normalizeWebhookMessage({
      mid: "m3",
      text: "top g",
      reply_to: { story: { id: "18092", url: "https://lookaside.fbsbx.com/story" } },
    });
    expect(result.kind).toBe("story_reply");
    expect(result.text).toBe("top g\n[Shared story]");
    expect(result.attachments[0]).toEqual({ type: "story", storyId: "18092", url: "https://lookaside.fbsbx.com/story" });
  });

  it("handles quick replies, swipe replies, ephemeral, unsupported and deleted", () => {
    expect(normalizeWebhookMessage({ text: "Yes", quick_reply: { payload: "FLOW|f|n|b" } })).toMatchObject({
      kind: "quick_reply",
      quickReplyPayload: "FLOW|f|n|b",
    });
    expect(normalizeWebhookMessage({ text: "ok", reply_to: { mid: "mid_x" } }).replyToMid).toBe("mid_x");
    expect(normalizeWebhookMessage({ attachments: [{ type: "ephemeral" }] }).kind).toBe("ephemeral");
    expect(normalizeWebhookMessage({ attachments: [{ type: "unsupported_type", payload: { url: "https://x" } }] }).kind).toBe(
      "unsupported"
    );
    expect(normalizeWebhookMessage({ is_unsupported: true })).toMatchObject({ kind: "unsupported" });
    expect(normalizeWebhookMessage({ is_deleted: true }).kind).toBe("deleted");
  });
});

describe("normalizeGraphMessage", () => {
  it("reads generic_template cards with postback and web_url ctas", () => {
    const result = normalizeGraphMessage({
      id: "g1",
      message: "",
      attachments: {
        data: [
          {
            generic_template: {
              title: "want me to add you?",
              cta: [
                { title: "yes, i'm in", type: "postback" },
                { title: "grab the skill", url: "https://my.manychat.com/r?act=2", type: "web_url" },
              ],
            },
          },
        ],
      },
    });
    expect(result.kind).toBe("card");
    expect(result.attachments[0]).toMatchObject({
      buttons: [
        { title: "yes, i'm in", type: "postback" },
        { title: "grab the skill", type: "url", url: "https://my.manychat.com/r?act=2" },
      ],
    });
    expect(result.text).toContain("[Button: grab the skill]");
  });

  it("reads image, audio-in-video_data, files and shares", () => {
    expect(normalizeGraphMessage({ attachments: { data: [{ image_data: { url: "https://scontent.cdninstagram.com/i.jpg" } }] } }).kind).toBe("image");
    expect(
      normalizeGraphMessage({ attachments: { data: [{ mime_type: "audio/mpeg", video_data: { url: "https://lookaside.fbsbx.com/a" } }] } }).kind
    ).toBe("audio");
    expect(
      normalizeGraphMessage({ attachments: { data: [{ mime_type: "application/pdf", name: "guide.pdf", file_url: "https://lookaside.fbsbx.com/f" }] } })
    ).toMatchObject({ kind: "file", text: "[File: guide.pdf]" });
    expect(normalizeGraphMessage({ shares: { data: [{ link: "https://instagram.com/p/1", name: "A post" }] } }).kind).toBe("share");
  });

  it("keeps plain text messages as text", () => {
    expect(normalizeGraphMessage({ message: "hello" })).toEqual({ kind: "text", text: "hello", attachments: [] });
  });
});

describe("isMediaOnly", () => {
  it("treats legacy placeholders and media kinds as media, text-like kinds as text", () => {
    expect(isMediaOnly({ text: "[media]" })).toBe(true);
    expect(isMediaOnly({ kind: "audio", text: "[Voice message]" })).toBe(true);
    expect(isMediaOnly({ kind: "card", text: "card" })).toBe(true);
    expect(isMediaOnly({ kind: "text", text: "hey" })).toBe(false);
    expect(isMediaOnly({ kind: "story_reply", text: "lol" })).toBe(false);
    expect(isMediaOnly({ kind: null, text: "hey" })).toBe(false);
  });
});

describe("webhook updates and referrals", () => {
  it("parses reactions, unreactions, edits and deletions", () => {
    const updates = parseMessageUpdates({
      object: "instagram",
      entry: [
        {
          id: "ig_1",
          time: 1,
          messaging: [
            { sender: { id: "u" }, reaction: { mid: "a", emoji: "❤", action: "react" } },
            { sender: { id: "u" }, reaction: { mid: "b", action: "unreact" } },
            { sender: { id: "u" }, message_edit: { mid: "c", text: "fixed", num_edit: 1 } },
            { sender: { id: "u" }, recipient: { id: "ig_1" }, message: { mid: "d", is_deleted: true } },
          ],
        },
      ],
    });
    expect(updates).toEqual([
      { type: "reaction", instagramAccountId: "ig_1", mid: "a", emoji: "❤" },
      { type: "reaction", instagramAccountId: "ig_1", mid: "b", emoji: null },
      { type: "edit", instagramAccountId: "ig_1", mid: "c", text: "fixed" },
      { type: "delete", instagramAccountId: "ig_1", mid: "d" },
    ]);
  });

  it("parses ig.me ref link referrals and ignores the account's own events", () => {
    const events = parseReferralEvents({
      object: "instagram",
      entry: [
        {
          id: "ig_1",
          time: 1,
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "ig_1" }, timestamp: 5, referral: { ref: "matrix", source: "SHORTLINK" } },
            { sender: { id: "u2" }, recipient: { id: "ig_1" }, message: { mid: "m", text: "hi", referral: { ref: "vsl" } } },
            { sender: { id: "ig_1" }, recipient: { id: "u3" }, referral: { ref: "self" } },
          ],
        },
      ],
    });
    expect(events).toEqual([
      { instagramAccountId: "ig_1", userId: "u1", ref: "matrix", timestamp: 5 },
      { instagramAccountId: "ig_1", userId: "u2", ref: "vsl", timestamp: undefined },
    ]);
  });
});

describe("hasGraphContent", () => {
  it("rejects the id-only stubs Meta returns for older messages", () => {
    expect(hasGraphContent({ id: "x", created_time: "2026-01-01T00:00:00+0000" })).toBe(false);
    expect(hasGraphContent({ id: "x", message: "" })).toBe(false);
    expect(hasGraphContent({ id: "x", message: "hi" })).toBe(true);
    expect(hasGraphContent({ id: "x", attachments: { data: [{ image_data: {} }] } })).toBe(true);
    expect(hasGraphContent({ id: "x", is_unsupported: true })).toBe(true);
  });
});
