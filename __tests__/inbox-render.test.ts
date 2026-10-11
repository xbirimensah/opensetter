/**
 * Server-renders every inbox message kind through the real components to
 * catch crashes and check the Instagram-style labels each one shows.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MessageRow from "../components/inbox/message-bubble";
import ContactPanel from "../components/inbox/contact-panel";
import ConversationList from "../components/inbox/conversation-list";
import type { DmAttachment } from "../lib/meta/attachments";
import type { InboxAttachment, InboxContact, InboxMessage } from "../lib/inbox/types";

function msg(extra: Partial<InboxMessage>): InboxMessage {
  return {
    id: "m1",
    mid: "mid1",
    fromMe: false,
    source: "PARTICIPANT",
    kind: "text",
    text: "",
    attachments: [],
    replyToMid: null,
    reaction: null,
    editedAt: null,
    deletedAt: null,
    sentAt: "2026-10-12T10:00:00.000Z",
    ...extra,
  };
}

function render(message: InboxMessage, repliedTo: InboxMessage | null = null): string {
  return renderToStaticMarkup(
    createElement(MessageRow, {
      message,
      repliedTo,
      showMeta: true,
      groupStart: false,
      onOpenImage: () => {},
      onJumpTo: () => {},
    })
  );
}

const att = (a: DmAttachment, servable = true) => ({ ...a, servable }) as InboxAttachment;

describe("message kinds", () => {
  it("text keeps line breaks and links URLs", () => {
    const html = render(msg({ text: "hi\nsee https://x.test" }));
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("quick replies and tapped buttons", () => {
    expect(render(msg({ kind: "quick_reply", text: "Yes" }))).toContain("Quick reply");
    const postback = render(msg({ kind: "postback", text: "[Button: Send me the guide]" }));
    expect(postback).toContain("Send me the guide");
    expect(postback).not.toContain("[Button");
  });

  it("photos, videos, voice notes and files use the media route", () => {
    expect(render(msg({ kind: "image", text: "[Photo]", attachments: [att({ type: "image" })] }))).toContain(
      'src="/api/inbox/media/m1/0"'
    );
    const video = render(msg({ kind: "video", text: "[Video]", attachments: [att({ type: "video" })] }));
    expect(video).toContain("<video");
    expect(video).toContain('preload="metadata"');
    const voice = render(msg({ kind: "audio", text: "[Voice message]", attachments: [att({ type: "audio" })] }));
    expect(voice).toContain('aria-label="Play voice message"');
    expect(voice).toContain("1x");
    expect(voice).toContain('role="slider"');
    const file = render(
      msg({ kind: "file", text: "[File: plan.pdf]", attachments: [att({ type: "file", name: "plan.pdf" })] })
    );
    expect(file).toContain("plan.pdf");
    expect(file).toContain('href="/api/inbox/media/m1/0"');
  });

  it("shows unavailable media instead of a broken element", () => {
    const html = render(msg({ kind: "audio", text: "[Voice message]", attachments: [att({ type: "audio" }, false)] }));
    expect(html).toContain("Voice message not available");
    expect(html).not.toContain("<audio");
  });

  it("cards render as a gallery with safe URL buttons and inert postbacks", () => {
    const card = (title: string) =>
      att(
        {
          type: "card",
          title,
          subtitle: "Sub",
          imageUrl: "https://scontent.xx.fbcdn.net/i.jpg",
          buttons: [
            { type: "url", title: "Open", url: "https://x.test" },
            { type: "url", title: "Bad", url: "javascript:alert(1)" },
            { type: "postback", title: "Tap" },
          ],
        },
        true
      );
    const html = render(msg({ kind: "card", fromMe: true, source: "FLOW", attachments: [card("A"), card("B")] }));
    expect(html).toContain("snap-x");
    expect(html).toContain('href="https://x.test/"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Tap");
    expect(html).toContain('src="/api/inbox/media/m1/1"');
    expect(html).toContain("Flow");
  });

  it("story replies, mentions, shares, reels and posts", () => {
    const reply = render(
      msg({
        kind: "story_reply",
        text: "so good\n[Shared story]",
        attachments: [att({ type: "story", mimeType: "image/jpeg" })],
      })
    );
    expect(reply).toContain("Replied to your story");
    expect(reply).toContain("so good");
    expect(reply).not.toContain("[Shared story]");

    expect(
      render(msg({ kind: "story_mention", text: "[Mentioned you in their story]", attachments: [att({ type: "story_mention" }, false)] }))
    ).toContain("Mentioned you in their story");

    // A share Meta delivers as a CDN preview renders the preview image...
    expect(
      render(msg({ kind: "share", text: "[Shared link] Hi", attachments: [att({ type: "share", url: "https://x.test/a", title: "Hi" })] }))
    ).toContain('alt="Shared post"');
    // ...and one that cannot be served stays a link chip.
    expect(
      render(msg({ kind: "share", text: "[Shared link] Hi", attachments: [att({ type: "share", url: "https://x.test/a", title: "Hi" }, false)] }))
    ).toContain("Shared link");

    expect(
      render(msg({ kind: "reel", text: "[Shared reel]", attachments: [att({ type: "reel", url: "https://www.instagram.com/reel/x" }, false)] }))
    ).toContain("Shared reel");

    expect(
      render(msg({ kind: "post", text: "[Shared post] cap", attachments: [att({ type: "post", title: "cap" })] }))
    ).toContain("cap");
  });

  it("stickers, disappearing media, unsupported, deleted, legacy media", () => {
    expect(render(msg({ kind: "sticker", text: "[Sticker]", attachments: [att({ type: "sticker" }, false)] }))).toContain("Sticker");
    expect(render(msg({ kind: "ephemeral", text: "[Disappearing photo or video]" }))).toContain(
      "Disappearing photo or video, open Instagram to view"
    );
    expect(render(msg({ kind: "unsupported", text: "[Unsupported message]" }))).toContain("Unsupported message");
    const deleted = render(msg({ kind: "text", text: "secret", deletedAt: "2026-10-12T10:01:00.000Z" }));
    expect(deleted).toContain("Message deleted");
    expect(deleted).not.toContain("secret");
    expect(render(msg({ text: "[media]" }))).toContain("Media (not captured)");
  });

  it("reactions, edits, swipe-replies and source badges", () => {
    const original = msg({ id: "m0", mid: "mid0", fromMe: true, text: "Want the guide?" });
    const html = render(
      msg({ text: "yes", reaction: "❤️", editedAt: "2026-10-12T10:02:00.000Z", replyToMid: "mid0" }),
      original
    );
    expect(html).toContain("❤️");
    expect(html).toContain("Edited");
    expect(html).toContain("Replied to you");
    expect(html).toContain("Want the guide?");
    expect(render(msg({ fromMe: true, source: "AI", text: "x" }))).toContain(">AI<");
    expect(render(msg({ fromMe: true, source: "CAMPAIGN", text: "x" }))).toContain("Campaign");
  });
});

describe("contact panel and list", () => {
  const contact: InboxContact = {
    conversationId: "c1",
    participantId: "p1",
    username: "jane",
    email: "jane@x.test",
    emailCapturedAt: "2026-10-12T09:00:00.000Z",
    phone: null,
    phoneCapturedAt: null,
    tags: ["VIP"],
    customFields: { city: "Berlin" },
    flowRun: {
      id: "r1",
      status: "WAITING",
      currentNodeId: "n1",
      currentNodeName: "Ask email",
      flow: { id: "f1", name: "Lead magnet" },
      waiting: { kind: "input", until: null, inputType: "email" },
      startedAt: "2026-10-12T09:00:00.000Z",
    },
  };

  it("renders profile, flow run, tags and fields", () => {
    const html = renderToStaticMarkup(
      createElement(ContactPanel, { contact, username: "jane", mode: "mirror", loading: false, onUpdated: () => {} })
    );
    expect(html).toContain('href="https://www.instagram.com/jane/"');
    expect(html).toContain("jane@x.test");
    expect(html).toContain("Add phone");
    expect(html).toContain("Lead magnet");
    expect(html).toContain("Waiting for an email address");
    expect(html).toContain("Stop flow");
    expect(html).toContain("VIP");
    expect(html).toContain("Berlin");
  });

  it("previews media kinds in the list", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        conversations: [
          {
            id: "c1",
            contact: { id: "p1", username: "jane" },
            updatedTime: "2026-10-12T10:00:00.000Z",
            lastMessage: {
              text: "[Voice message]",
              kind: "audio",
              fromMe: false,
              source: "PARTICIPANT",
              sentAt: "2026-10-12T10:00:00.000Z",
              deleted: false,
            },
            hasActiveFlow: true,
          },
        ],
        activeKey: null,
        heldDraftKeys: new Set<string>(),
        onOpen: () => {},
      })
    );
    expect(html).toContain("@jane");
    expect(html).toContain("Voice message");
    expect(html).not.toContain("[Voice message]");
    expect(html).toContain("Flow running");
  });
});
