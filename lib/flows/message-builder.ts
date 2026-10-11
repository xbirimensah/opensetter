/**
 * Turns flow content blocks into Instagram Messaging API message bodies,
 * plus the normalized attachments the inbox mirror stores for them.
 */

import type { DmAttachment, DmButton, DmMessageKind } from "@/lib/meta/attachments";
import { describeAttachment } from "@/lib/meta/attachments";
import {
  LIMITS,
  encodeFlowPayload,
  type FlowButton,
  type FlowCard,
  type FlowContent,
  type FlowQuickReply,
} from "./types";

export interface BuildResolvers {
  flowId: string;
  nodeId: string;
  /** MediaAsset id → public https URL (null when the asset is gone). */
  mediaUrl(mediaId: string): Promise<string | null>;
  /** Wraps a URL button in the click tracker when `track` is on. */
  linkUrl(buttonId: string, url: string): Promise<string>;
  render(text: string): string;
}

export interface BuiltMessage {
  body: Record<string, unknown>;
  mirror: { kind: DmMessageKind; text: string; attachments: DmAttachment[] };
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Meta caps plain text at 1000 UTF-8 bytes; umlauts and emoji take 2 to 4. */
function clipBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = "";
  for (const char of text) {
    if (encoder.encode(out + char + "…").length > maxBytes) break;
    out += char;
  }
  return out + "…";
}

async function metaButtons(buttons: FlowButton[], r: BuildResolvers) {
  const out: Record<string, unknown>[] = [];
  const mirror: DmButton[] = [];
  for (const button of buttons.slice(0, LIMITS.buttonsMax)) {
    const title = clip(r.render(button.title), LIMITS.buttonTitleMax);
    if (button.type === "url") {
      const url = button.track ? await r.linkUrl(button.id, button.url) : button.url;
      out.push({ type: "web_url", url, title });
      mirror.push({ title, type: "url", url: button.url });
    } else {
      out.push({ type: "postback", title, payload: encodeFlowPayload(r.flowId, r.nodeId, button.id) });
      mirror.push({ title, type: "postback" });
    }
  }
  return { out, mirror };
}

function quickReplyBody(quickReplies: FlowQuickReply[], r: BuildResolvers) {
  return quickReplies.slice(0, LIMITS.quickRepliesMax).map((q) => ({
    content_type: "text",
    title: clip(r.render(q.title), LIMITS.quickReplyTitleMax),
    payload: encodeFlowPayload(r.flowId, r.nodeId, q.id),
  }));
}

async function cardElement(card: FlowCard, r: BuildResolvers) {
  const imageUrl = card.imageMediaId ? await r.mediaUrl(card.imageMediaId) : card.imageUrl ?? null;
  const { out, mirror } = await metaButtons(card.buttons, r);
  const title = clip(r.render(card.title), LIMITS.cardTitleMax);
  const subtitle = card.subtitle ? clip(r.render(card.subtitle), LIMITS.cardSubtitleMax) : undefined;
  return {
    element: {
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(out.length ? { buttons: out } : {}),
    },
    attachment: {
      type: "card" as const,
      title,
      subtitle,
      imageUrl: imageUrl ?? undefined,
      buttons: mirror,
    },
  };
}

/**
 * Build one sendable message for a content block. `typing` blocks are not
 * messages and return null. Quick replies only attach to text blocks.
 */
export async function buildContentMessage(
  content: FlowContent,
  r: BuildResolvers,
  quickReplies?: FlowQuickReply[]
): Promise<BuiltMessage | null> {
  switch (content.type) {
    case "typing":
      return null;

    case "text": {
      const buttons = content.buttons ?? [];
      const rendered = r.render(content.text);
      if (buttons.length > 0) {
        const text = clip(rendered, LIMITS.textWithButtonsMax);
        const { out, mirror } = await metaButtons(buttons, r);
        const attachment: DmAttachment = { type: "card", title: text, buttons: mirror };
        return {
          body: {
            attachment: { type: "template", payload: { template_type: "button", text, buttons: out } },
          },
          mirror: { kind: "card", text: describeAttachment(attachment), attachments: [attachment] },
        };
      }
      const text = clipBytes(rendered, LIMITS.textMax);
      const qr = quickReplies?.length ? quickReplyBody(quickReplies, r) : undefined;
      return {
        body: { text, ...(qr ? { quick_replies: qr } : {}) },
        mirror: { kind: "text", text, attachments: [] },
      };
    }

    case "image":
    case "video":
    case "audio":
    case "file": {
      const url = content.mediaId ? await r.mediaUrl(content.mediaId) : content.url ?? null;
      if (!url) throw new Error(`Media for ${content.type} block ${content.id} is missing`);
      const attachment: DmAttachment = { type: content.type, url };
      return {
        body: { attachment: { type: content.type, payload: { url } } },
        mirror: { kind: content.type, text: describeAttachment(attachment), attachments: [attachment] },
      };
    }

    case "cards": {
      const built = await Promise.all(content.cards.slice(0, LIMITS.cardsMax).map((c) => cardElement(c, r)));
      if (built.length === 0) throw new Error(`Cards block ${content.id} has no cards`);
      const attachments = built.map((b) => b.attachment);
      return {
        body: {
          attachment: {
            type: "template",
            payload: { template_type: "generic", elements: built.map((b) => b.element) },
          },
        },
        mirror: {
          kind: "card",
          text: attachments.map(describeAttachment).join("\n"),
          attachments,
        },
      };
    }
  }
}
