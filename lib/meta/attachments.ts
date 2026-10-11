/**
 * Normalizes every Instagram DM shape into one model the inbox, the AI
 * setter and flows can share.
 *
 * Two sources feed it:
 * - webhook `message` objects (attachments[].type + payload), and
 * - Graph API conversation messages (attachments.data[] with
 *   image_data / video_data / audio_data / generic_template / file_url).
 *
 * Shapes were taken from real stored webhook payloads and Graph API reads
 * of this account's inbox (audio, image, video, ig_reel, ig_post, ig_story,
 * share, story_mention, template, ephemeral, unsupported_type).
 */

export interface DmButton {
  title: string;
  type: "url" | "postback";
  url?: string;
  payload?: string;
}

export type DmMediaType = "image" | "video" | "audio" | "file";

export type DmAttachment =
  | {
      type: DmMediaType;
      url?: string;
      /** Set once the media was copied to MEDIA_DIR (CDN URLs expire). */
      localKey?: string;
      mimeType?: string;
      name?: string;
    }
  | {
      type: "card";
      title?: string;
      subtitle?: string;
      imageUrl?: string;
      buttons: DmButton[];
    }
  | { type: "share"; url?: string; title?: string }
  | { type: "reel"; url?: string; title?: string; mediaId?: string }
  | { type: "post"; url?: string; title?: string; mediaId?: string }
  | { type: "story"; url?: string; storyId?: string; localKey?: string; mimeType?: string }
  | { type: "story_mention"; url?: string; localKey?: string; mimeType?: string }
  | { type: "sticker" }
  | { type: "ephemeral" }
  | { type: "unsupported"; url?: string };

export type DmMessageKind =
  | "text"
  | DmMediaType
  | "card"
  | "share"
  | "reel"
  | "post"
  | "story_reply"
  | "story_mention"
  | "postback"
  | "quick_reply"
  | "sticker"
  | "ephemeral"
  | "unsupported"
  | "deleted";

export interface NormalizedDm {
  kind: DmMessageKind;
  /** Readable text; never empty. */
  text: string;
  attachments: DmAttachment[];
  replyToMid?: string;
  /** Payload of a tapped quick reply, when the message is one. */
  quickReplyPayload?: string;
}

type Json = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function obj(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toButtons(raw: unknown): DmButton[] {
  return arr(raw)
    .map((b) => obj(b))
    .filter((b): b is Json => Boolean(b))
    .map((b) => {
      const url = str(b.url);
      const kind = String(b.type ?? "");
      const isUrl = Boolean(url) || kind === "web_url" || kind === "open_url";
      return {
        title: str(b.title) ?? (isUrl ? "Open link" : "Button"),
        type: isUrl ? ("url" as const) : ("postback" as const),
        ...(url ? { url } : {}),
        ...(str(b.payload) ? { payload: str(b.payload) } : {}),
      };
    });
}

function cardsFromTemplate(payload: Json): DmAttachment[] {
  // Generic template: { generic: { elements: [...] } } (webhook) or
  // { template_type: "generic", elements: [...] } (our own send shape).
  const generic = obj(payload.generic);
  const elements = arr(generic?.elements ?? payload.elements);
  if (elements.length > 0) {
    return elements
      .map((e) => obj(e))
      .filter((e): e is Json => Boolean(e))
      .map((e) => ({
        type: "card" as const,
        title: str(e.title),
        subtitle: str(e.subtitle),
        imageUrl: str(e.image_url),
        buttons: toButtons(e.buttons),
      }));
  }
  // Button template: { template_type: "button", text, buttons }.
  if (str(payload.text) || arr(payload.buttons).length > 0) {
    return [
      {
        type: "card",
        title: str(payload.text),
        buttons: toButtons(payload.buttons),
      },
    ];
  }
  return [];
}

/** One webhook `message.attachments[]` entry → normalized attachments. */
function fromWebhookAttachment(raw: unknown): DmAttachment[] {
  const att = obj(raw);
  if (!att) return [];
  const type = String(att.type ?? "");
  const payload = obj(att.payload) ?? {};
  const url = str(payload.url);

  switch (type) {
    case "image":
    case "animated_image":
      return [{ type: "image", url }];
    case "video":
      return [{ type: "video", url }];
    case "audio":
      return [{ type: "audio", url }];
    case "file":
      return [{ type: "file", url, name: str(payload.title) }];
    case "share":
    case "fallback":
      return [{ type: "share", url, title: str(payload.title) }];
    case "ig_reel":
    case "reel":
      return [
        {
          type: "reel",
          url,
          title: str(payload.title),
          mediaId: str(payload.reel_video_id),
        },
      ];
    case "ig_post":
    case "media_share":
      return [
        {
          type: "post",
          url,
          title: str(payload.title),
          mediaId: str(payload.ig_post_media_id),
        },
      ];
    case "ig_story":
      return [
        {
          type: "story",
          url: str(payload.story_media_url) ?? url,
          storyId: str(payload.story_media_id),
        },
      ];
    case "story_mention":
      return [{ type: "story_mention", url }];
    case "template":
      return cardsFromTemplate(payload);
    case "like_heart":
    case "sticker":
      return [{ type: "sticker" }];
    case "ephemeral":
      return [{ type: "ephemeral" }];
    default:
      return [{ type: "unsupported", url }];
  }
}

/** One Graph API `attachments.data[]` entry → normalized attachments. */
function fromGraphAttachment(raw: unknown): DmAttachment[] {
  const att = obj(raw);
  if (!att) return [];

  const template = obj(att.generic_template);
  if (template) {
    return [
      {
        type: "card",
        title: str(template.title),
        subtitle: str(template.subtitle),
        imageUrl: str(template.image_url),
        buttons: toButtons(template.cta ?? template.buttons),
      },
    ];
  }

  const mimeType = str(att.mime_type);
  const name = str(att.name);
  const image = obj(att.image_data);
  if (image) return [{ type: "image", url: str(image.url), mimeType, name }];
  const video = obj(att.video_data);
  if (video) {
    const isAudio = mimeType?.startsWith("audio/");
    return [{ type: isAudio ? "audio" : "video", url: str(video.url), mimeType, name }];
  }
  const audio = obj(att.audio_data);
  if (audio) return [{ type: "audio", url: str(audio.url), mimeType, name }];

  const fileUrl = str(att.file_url);
  if (fileUrl) {
    const type: DmMediaType = mimeType?.startsWith("audio/")
      ? "audio"
      : mimeType?.startsWith("video/")
        ? "video"
        : mimeType?.startsWith("image/")
          ? "image"
          : "file";
    return [{ type, url: fileUrl, mimeType, name }];
  }
  return [{ type: "unsupported" }];
}

const MEDIA_LABELS: Record<DmMediaType, string> = {
  image: "[Photo]",
  video: "[Video]",
  audio: "[Voice message]",
  file: "[File]",
};

/** A short human-readable line for one attachment. */
export function describeAttachment(att: DmAttachment): string {
  switch (att.type) {
    case "image":
    case "video":
    case "audio":
      return MEDIA_LABELS[att.type];
    case "file":
      return att.name ? `[File: ${att.name}]` : MEDIA_LABELS.file;
    case "card": {
      const lines = [att.title, att.subtitle].filter(Boolean) as string[];
      const buttons = att.buttons.map((b) => `[Button: ${b.title}]`);
      return [...lines, ...buttons].join("\n") || "[Card]";
    }
    case "share":
      return att.title ? `[Shared link] ${att.title}` : "[Shared link]";
    case "reel":
      return att.title ? `[Shared reel] ${att.title}` : "[Shared reel]";
    case "post":
      return att.title ? `[Shared post] ${att.title}` : "[Shared post]";
    case "story":
      return "[Shared story]";
    case "story_mention":
      return "[Mentioned you in their story]";
    case "sticker":
      return "[Sticker]";
    case "ephemeral":
      return "[Disappearing photo or video]";
    case "unsupported":
      return "[Unsupported message]";
  }
}

function kindFor(attachments: DmAttachment[]): DmMessageKind {
  const first = attachments[0];
  if (!first) return "unsupported";
  // A shared story (ig_story) reads like any other share; a story *reply*
  // is flagged by the caller from reply_to.story.
  if (first.type === "story") return "share";
  return first.type;
}

function summarize(text: string | undefined, attachments: DmAttachment[]): string {
  const parts = [text, ...attachments.map(describeAttachment)].filter(
    (p): p is string => Boolean(p && p.trim())
  );
  return parts.join("\n") || "[Unsupported message]";
}

/** Normalize a webhook `messaging[].message` object. */
export function normalizeWebhookMessage(message: unknown): NormalizedDm {
  const m = obj(message) ?? {};
  const text = str(m.text)?.trim();
  const replyTo = obj(m.reply_to);
  const story = obj(replyTo?.story);
  const quickReply = obj(m.quick_reply);

  if (m.is_deleted === true) {
    return { kind: "deleted", text: "[Message deleted]", attachments: [] };
  }

  const attachments = arr(m.attachments).flatMap(fromWebhookAttachment);
  if (story) {
    attachments.unshift({ type: "story", url: str(story.url), storyId: str(story.id) });
  }

  const base = {
    replyToMid: str(replyTo?.mid),
    quickReplyPayload: str(quickReply?.payload),
  };

  if (attachments.length === 0) {
    if (m.is_unsupported === true && !text) {
      return { ...base, kind: "unsupported", text: "[Unsupported message]", attachments };
    }
    return {
      ...base,
      kind: base.quickReplyPayload ? "quick_reply" : "text",
      text: text || "[Unsupported message]",
      attachments,
    };
  }

  return {
    ...base,
    kind: story ? "story_reply" : kindFor(attachments),
    text: summarize(text, attachments),
    attachments,
  };
}

/** Normalize a Graph API conversation message (fields incl. attachments, shares, story). */
export function normalizeGraphMessage(message: unknown): NormalizedDm {
  const m = obj(message) ?? {};
  const text = str(m.message)?.trim();
  const attachments = arr(obj(m.attachments)?.data).flatMap(fromGraphAttachment);

  for (const share of arr(obj(m.shares)?.data)) {
    const s = obj(share);
    if (!s) continue;
    const template = obj(s.template);
    if (template) {
      attachments.push(...cardsFromTemplate(obj(template.payload) ?? template));
    } else {
      attachments.push({ type: "share", url: str(s.link), title: str(s.name) });
    }
  }

  const story = obj(m.story);
  const reply = obj(story?.reply_to);
  const mention = obj(story?.mention);
  if (reply) attachments.unshift({ type: "story", url: str(reply.link), storyId: str(reply.id) });
  if (mention) attachments.push({ type: "story_mention", url: str(mention.link) });

  if (attachments.length === 0) {
    if (m.is_unsupported === true && !text) {
      return { kind: "unsupported", text: "[Unsupported message]", attachments };
    }
    return { kind: "text", text: text || "[Unsupported message]", attachments };
  }
  return {
    kind: reply ? "story_reply" : kindFor(attachments),
    text: summarize(text, attachments),
    attachments,
  };
}

/** True when a mirrored message carries no real text of its own. */
const TEXT_KINDS = new Set(["text", "quick_reply", "story_reply", "postback"]);

export function isMediaOnly(message: { kind?: string | null; text: string }): boolean {
  if (message.text === "[media]") return true;
  return Boolean(message.kind && !TEXT_KINDS.has(message.kind));
}

/**
 * Meta returns full content only for the ~20 newest messages of a thread;
 * older ones come back as just an id and a timestamp. Those must be
 * skipped, never stored or used to overwrite a row.
 */
export function hasGraphContent(message: unknown): boolean {
  const m = obj(message) ?? {};
  return Boolean(
    str(m.message) ||
      arr(obj(m.attachments)?.data).length > 0 ||
      arr(obj(m.shares)?.data).length > 0 ||
      obj(m.story) ||
      m.is_unsupported === true
  );
}
