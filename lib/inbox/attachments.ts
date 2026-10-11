/**
 * Reading DmMessage.attachments back out of the database.
 *
 * The column is JSON written by the mirror, so it is validated here
 * instead of trusted: unknown shapes are dropped, not rendered. Pure and
 * client-safe.
 */

import type { DmAttachment, DmButton } from "@/lib/meta/attachments";
import { isAllowedMediaUrl } from "@/lib/inbox/media";

type Json = Record<string, unknown>;

const ATTACHMENT_TYPES = new Set<DmAttachment["type"]>([
  "image",
  "video",
  "audio",
  "file",
  "card",
  "share",
  "reel",
  "post",
  "story",
  "story_mention",
  "sticker",
  "ephemeral",
  "unsupported",
]);

const MAX_ATTACHMENTS = 20;

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toButton(raw: unknown): DmButton | null {
  const b = obj(raw);
  const title = str(b?.title);
  if (!b || !title) return null;
  const url = str(b.url);
  return {
    title,
    type: b.type === "url" || url ? "url" : "postback",
    ...(url ? { url } : {}),
    ...(str(b.payload) ? { payload: str(b.payload) } : {}),
  };
}

function toAttachment(raw: unknown): DmAttachment | null {
  const a = obj(raw);
  const type = a?.type;
  if (!a || typeof type !== "string" || !ATTACHMENT_TYPES.has(type as DmAttachment["type"])) {
    return null;
  }
  switch (type) {
    case "image":
    case "video":
    case "audio":
    case "file":
      return {
        type,
        url: str(a.url),
        localKey: str(a.localKey),
        mimeType: str(a.mimeType),
        name: str(a.name),
      };
    case "card":
      return {
        type,
        title: str(a.title),
        subtitle: str(a.subtitle),
        imageUrl: str(a.imageUrl),
        buttons: (Array.isArray(a.buttons) ? a.buttons : [])
          .map(toButton)
          .filter((b): b is DmButton => Boolean(b))
          .slice(0, 3),
      };
    case "share":
      return { type, url: str(a.url), title: str(a.title) };
    case "reel":
    case "post":
      return { type, url: str(a.url), title: str(a.title), mediaId: str(a.mediaId) };
    case "story":
      return {
        type,
        url: str(a.url),
        storyId: str(a.storyId),
        localKey: str(a.localKey),
        mimeType: str(a.mimeType),
      };
    case "story_mention":
      return { type, url: str(a.url), localKey: str(a.localKey), mimeType: str(a.mimeType) };
    case "unsupported":
      return { type, url: str(a.url) };
    case "sticker":
    case "ephemeral":
      return { type };
    default:
      return null;
  }
}

/** DmMessage.attachments JSON → validated attachments (unknown entries dropped). */
export function parseStoredAttachments(value: unknown): DmAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ATTACHMENTS)
    .map(toAttachment)
    .filter((a): a is DmAttachment => Boolean(a));
}

export interface MediaSource {
  /** Storage key in MEDIA_DIR, when the mirror kept a copy. */
  localKey?: string;
  /** Remote URL; only proxied when it is on a Meta CDN host. */
  url?: string;
  mimeType?: string;
  name?: string;
}

/**
 * Where the bytes for one attachment live. Cards use their image; shares,
 * reels, posts and stories use their media URL. Stickers and disappearing
 * media have nothing to serve.
 */
export function mediaSourceFor(attachment: DmAttachment): MediaSource | null {
  // Defensive: the mirror may also keep local copies of non-media previews.
  const localKey = str((attachment as Json).localKey);
  switch (attachment.type) {
    case "image":
    case "video":
    case "audio":
    case "file":
      return {
        localKey,
        url: attachment.url,
        mimeType: attachment.mimeType,
        name: attachment.name,
      };
    case "card":
      return localKey || attachment.imageUrl ? { localKey, url: attachment.imageUrl } : null;
    case "story":
    case "story_mention":
      // Stored story thumbnails carry their own type (image or video).
      return localKey || attachment.url
        ? { localKey, url: attachment.url, mimeType: attachment.mimeType }
        : null;
    case "share":
    case "reel":
    case "post":
    case "unsupported":
      return localKey || attachment.url ? { localKey, url: attachment.url } : null;
    case "sticker":
    case "ephemeral":
      return null;
  }
}

/** Strips storage keys from a union member while keeping it discriminated. */
type WithoutLocalKey<T> = T extends unknown ? Omit<T, "localKey"> : never;

/**
 * An attachment as the browser sees it: no storage keys, plus `servable`,
 * true when /api/inbox/media can deliver bytes for it (a stored copy or a
 * Meta CDN URL that may still be live).
 */
export type InboxAttachment = WithoutLocalKey<DmAttachment> & { servable: boolean };

export function toInboxAttachment(attachment: DmAttachment): InboxAttachment {
  const source = mediaSourceFor(attachment);
  const servable = Boolean(source && (source.localKey || isAllowedMediaUrl(source.url)));
  const rest = Object.fromEntries(
    Object.entries(attachment).filter(([key]) => key !== "localKey")
  ) as WithoutLocalKey<DmAttachment>;
  return { ...rest, servable };
}
