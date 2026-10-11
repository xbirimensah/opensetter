/**
 * Copies media from a mirrored message (voice notes, photos, videos,
 * files, story thumbnails) into MEDIA_DIR before Meta's CDN URL expires,
 * and records the storage key on the attachment.
 */

import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/app/generated/prisma/client";
import type { DmAttachment } from "@/lib/meta/attachments";
import { downloadInboundMedia } from "./storage";

const CAPTURE_TYPES = new Set(["image", "video", "audio", "file", "story", "story_mention"]);

/** Meta CDN hosts only: the URL comes from a webhook, never from a user. */
export function isMetaCdnUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "lookaside.fbsbx.com" ||
      host.endsWith(".fbcdn.net") ||
      host.endsWith(".cdninstagram.com") ||
      // GIFs from Instagram's picker arrive as image attachments on Giphy.
      /^media\d*\.giphy\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

export async function captureMessageMedia(message: {
  id: string;
  conversationId: string;
  attachments: DmAttachment[];
}): Promise<number> {
  let captured = 0;
  const updated = await Promise.all(
    message.attachments.map(async (attachment, index) => {
      if (!CAPTURE_TYPES.has(attachment.type)) return attachment;
      const url = "url" in attachment ? attachment.url : undefined;
      if (!url || !isMetaCdnUrl(url)) return attachment;
      if ("localKey" in attachment && attachment.localKey) return attachment;
      const stored = await downloadInboundMedia({
        url,
        conversationId: message.conversationId,
        messageId: message.id,
        index,
      });
      if (!stored) return attachment;
      captured += 1;
      return { ...attachment, localKey: stored.key, mimeType: stored.mimeType };
    })
  );
  if (captured > 0) {
    await prisma.dmMessage.update({
      where: { id: message.id },
      data: { attachments: updated as unknown as Prisma.InputJsonValue },
    });
  }
  return captured;
}
