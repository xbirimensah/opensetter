"use client";

/**
 * One DM in the thread, drawn the way Instagram draws it: text, voice
 * notes, photos, videos, files, cards, shares, story replies and mentions,
 * tapped buttons, quick replies, reactions, swipe-replies, edits and
 * deletes. Outbound sends by the AI setter, a campaign or a flow carry a
 * small source badge.
 */

import type { ReactNode } from "react";
import type { InboxAttachment, InboxMessage, InboxMessageSource } from "@/lib/inbox/types";
import { inboxMediaPath } from "@/lib/inbox/media";
import {
  formatClockTime,
  isDeleted,
  isLegacyMedia,
  ownText,
  postbackLabel,
  previewText,
} from "@/lib/inbox/display";
import LinkifiedText from "@/components/inbox/linkified-text";
import VoiceNote from "@/components/inbox/voice-note";
import {
  CardGallery,
  FileChip,
  ImageAttachment,
  LinkPreview,
  MediaThumb,
  MediaUnavailable,
  VideoAttachment,
} from "@/components/inbox/attachment-views";
import {
  BanIcon,
  FlowIcon,
  MicIcon,
  PhotoIcon,
  ReelIcon,
  ReplyIcon,
  StickerIcon,
  StoryIcon,
  TapIcon,
  TimerIcon,
  VideoIcon,
} from "@/components/inbox/icons";
import { PILL } from "@/components/inbox/ui";

/** mid prefix of an optimistic send that Meta has not acknowledged yet. */
export const OPTIMISTIC_PREFIX = "optimistic-";

const SOURCE_BADGES: Partial<Record<InboxMessageSource, string>> = {
  AI: "AI",
  CAMPAIGN: "Campaign",
  FLOW: "Flow",
};

export interface MessageRowProps {
  message: InboxMessage;
  /** The message this one swipe-replies to, when it is in the loaded thread. */
  repliedTo: InboxMessage | null;
  /** Show the time / badge line (last message of a group, or it has news). */
  showMeta: boolean;
  /** First message of a group gets more space above it. */
  groupStart: boolean;
  onOpenImage: (src: string, alt: string) => void;
  onJumpTo: (mid: string) => void;
}

export default function MessageRow({
  message,
  repliedTo,
  showMeta,
  groupStart,
  onOpenImage,
  onJumpTo,
}: MessageRowProps) {
  const { fromMe } = message;
  const badge = SOURCE_BADGES[message.source];
  const edited = Boolean(message.editedAt) && !isDeleted(message);
  const meta = showMeta || Boolean(badge) || edited || Boolean(message.pending);

  return (
    <div
      data-mid={message.mid}
      className={`flex flex-col rounded-xl ${fromMe ? "items-end" : "items-start"} ${
        groupStart ? "mt-3" : "mt-0.5"
      }`}
    >
      {message.replyToMid && (
        <ReplyQuote fromMe={fromMe} repliedTo={repliedTo} onJump={() => onJumpTo(message.replyToMid as string)} />
      )}

      <div
        className={`relative flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${
          fromMe ? "items-end" : "items-start"
        } ${message.reaction ? "mb-3" : ""}`}
      >
        <MessageBody message={message} onOpenImage={onOpenImage} />
        {message.reaction && (
          <span
            className={`absolute -bottom-3.5 ${fromMe ? "left-2" : "right-2"} rounded-full border border-border bg-surface px-1.5 text-sm leading-6 shadow-sm`}
            role="img"
            aria-label={`Reaction ${message.reaction}`}
          >
            {message.reaction}
          </span>
        )}
      </div>

      {meta && (
        <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] tracking-[0.01em] text-faint">
          {badge && (
            <span className={`${PILL} text-muted`}>
              {message.source === "FLOW" && <FlowIcon size={10} />}
              {badge}
            </span>
          )}
          <time dateTime={message.sentAt}>{formatClockTime(message.sentAt)}</time>
          {edited && <span>· Edited</span>}
          {message.pending && (
            <span>· {message.mid.startsWith(OPTIMISTIC_PREFIX) ? "Sending…" : "Sent"}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ReplyQuote({
  fromMe,
  repliedTo,
  onJump,
}: {
  fromMe: boolean;
  repliedTo: InboxMessage | null;
  onJump: () => void;
}) {
  const who = fromMe
    ? repliedTo?.fromMe
      ? "You replied to yourself"
      : "You replied"
    : repliedTo?.fromMe
      ? "Replied to you"
      : "Replied";
  const snippet = repliedTo
    ? isDeleted(repliedTo)
      ? "Message deleted"
      : previewText(repliedTo.text)
    : "Original message not loaded";

  return (
    <div className={`mb-0.5 flex max-w-[75%] flex-col ${fromMe ? "items-end" : "items-start"}`}>
      <span className="flex items-center gap-1 px-1 text-[11px] text-faint">
        <ReplyIcon size={12} />
        {who}
      </span>
      <button
        type="button"
        onClick={onJump}
        disabled={!repliedTo}
        className="mt-0.5 max-w-full rounded-2xl border border-border bg-surface-hover px-3 py-1.5 text-left text-xs text-muted transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted"
      >
        <span className="line-clamp-2 break-words">{snippet}</span>
      </button>
    </div>
  );
}

function TextBubble({
  fromMe,
  children,
  footer,
}: {
  fromMe: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`min-w-0 max-w-full rounded-[1.125rem] px-3 py-2 text-sm leading-relaxed ${
        fromMe ? "bg-accent text-white" : "border border-border bg-surface text-foreground"
      }`}
    >
      {children}
      {footer}
    </div>
  );
}

/** Muted, outlined bubble for things the dashboard cannot show. */
function NoticeBubble({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex max-w-full items-center gap-2 rounded-[1.125rem] border border-dashed border-border px-3 py-2 text-sm text-muted">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function MessageBody({
  message,
  onOpenImage,
}: {
  message: InboxMessage;
  onOpenImage: (src: string, alt: string) => void;
}) {
  const { fromMe } = message;

  if (isDeleted(message)) {
    return (
      <NoticeBubble icon={<BanIcon />}>
        <span className="italic">Message deleted</span>
      </NoticeBubble>
    );
  }
  if (isLegacyMedia(message)) {
    return (
      <NoticeBubble icon={<PhotoIcon />}>
        <span className="italic">Media (not captured)</span>
      </NoticeBubble>
    );
  }

  switch (message.kind) {
    case "text":
      return (
        <TextBubble fromMe={fromMe}>
          <LinkifiedText text={message.text} fromMe={fromMe} />
        </TextBubble>
      );
    case "quick_reply":
      return (
        <TextBubble
          fromMe={fromMe}
          footer={
            <span className={`mt-0.5 block text-[10px] tracking-[0.02em] ${fromMe ? "text-white/70" : "text-faint"}`}>
              Quick reply
            </span>
          }
        >
          <LinkifiedText text={message.text} fromMe={fromMe} />
        </TextBubble>
      );
    case "postback":
      return (
        <span
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
            fromMe ? "border-accent bg-accent text-white" : "border-accent/50 bg-surface text-accent"
          }`}
          title="Tapped button"
        >
          <TapIcon size={14} className="shrink-0" />
          <span className="truncate">{postbackLabel(message.text)}</span>
        </span>
      );
    case "sticker":
      return (
        <NoticeBubble icon={<StickerIcon />}>Sticker</NoticeBubble>
      );
    case "ephemeral":
      return (
        <NoticeBubble icon={<TimerIcon />}>
          Disappearing photo or video, open Instagram to view
        </NoticeBubble>
      );
    default:
      return <RichBody message={message} onOpenImage={onOpenImage} />;
  }
}

/** Media, shares, cards and stories: attachments first, then their own words. */
function RichBody({
  message,
  onOpenImage,
}: {
  message: InboxMessage;
  onOpenImage: (src: string, alt: string) => void;
}) {
  const { fromMe, kind } = message;
  const text = kind === "card" ? "" : ownText(message);
  const header =
    kind === "story_reply"
      ? fromMe
        ? "You replied to their story"
        : "Replied to your story"
      : kind === "story_mention"
        ? fromMe
          ? "You mentioned them in your story"
          : "Mentioned you in their story"
        : kind === "share" && message.attachments[0]?.type === "story"
          ? fromMe
            ? "You shared a story"
            : "Shared a story"
          : null;

  const blocks = renderAttachments(message, onOpenImage);
  const showUnsupported = blocks.length === 0 && !text;

  return (
    <>
      {header && (
        <span className="flex items-center gap-1 px-1 text-[11px] text-faint">
          <StoryIcon size={12} />
          {header}
        </span>
      )}
      {blocks}
      {showUnsupported && (
        <NoticeBubble icon={<BanIcon />}>Unsupported message, open Instagram to view</NoticeBubble>
      )}
      {text && (
        <TextBubble fromMe={fromMe}>
          <LinkifiedText text={text} fromMe={fromMe} />
        </TextBubble>
      )}
    </>
  );
}

function renderAttachments(
  message: InboxMessage,
  onOpenImage: (src: string, alt: string) => void
): ReactNode[] {
  const { fromMe, id } = message;
  const blocks: ReactNode[] = [];
  // Every card of the message goes into one gallery, placed where the first card was.
  const cards = message.attachments.flatMap((att, index) =>
    att.type === "card" ? [{ card: att as Extract<InboxAttachment, { type: "card" }>, index }] : []
  );
  const src = (index: number) => inboxMediaPath(id, index);

  message.attachments.forEach((att, index) => {
    switch (att.type) {
      case "image":
        blocks.push(
          att.servable ? (
            <ImageAttachment key={index} src={src(index)} alt="Photo" fromMe={fromMe} onOpen={onOpenImage} />
          ) : (
            <MediaUnavailable key={index} label="Photo not available" fromMe={fromMe} />
          )
        );
        return;
      case "video":
        blocks.push(
          att.servable ? (
            <VideoAttachment key={index} src={src(index)} fromMe={fromMe} />
          ) : (
            <MediaUnavailable key={index} icon={VideoIcon} label="Video not available" fromMe={fromMe} />
          )
        );
        return;
      case "audio":
        blocks.push(
          att.servable ? (
            <VoiceNote key={index} src={src(index)} seed={`${id}-${index}`} fromMe={fromMe} />
          ) : (
            <MediaUnavailable key={index} icon={MicIcon} label="Voice message not available" fromMe={fromMe} />
          )
        );
        return;
      case "file":
        blocks.push(
          <FileChip key={index} src={src(index)} name={att.name} servable={att.servable} fromMe={fromMe} />
        );
        return;
      case "card":
        if (index === cards[0]?.index) {
          blocks.push(<CardGallery key="cards" cards={cards} messageId={id} fromMe={fromMe} />);
        }
        return;
      case "share":
        // Instagram delivers shared posts as a Meta CDN preview image; show
        // the preview instead of a link chip that only says "lookaside".
        blocks.push(
          att.servable ? (
            <div key={index} className={`flex flex-col gap-1 ${fromMe ? "items-end" : "items-start"}`}>
              <MediaThumb
                src={src(index)}
                alt="Shared post"
                fromMe={fromMe}
                onOpenImage={onOpenImage}
                className="w-56 max-w-full aspect-square"
              />
              {att.title && <Caption text={att.title} />}
            </div>
          ) : (
            <LinkPreview key={index} url={att.url} title={att.title} kindLabel="Shared link" fromMe={fromMe} />
          )
        );
        return;
      case "reel":
        blocks.push(
          att.servable ? (
            <div key={index} className={`flex flex-col gap-1 ${fromMe ? "items-end" : "items-start"}`}>
              <VideoAttachment src={src(index)} fromMe={fromMe} label="Reel" />
              {att.title && <Caption text={att.title} />}
            </div>
          ) : (
            <LinkPreview key={index} url={att.url} title={att.title} kindLabel="Shared reel" icon={ReelIcon} fromMe={fromMe} />
          )
        );
        return;
      case "post":
        blocks.push(
          att.servable ? (
            <div key={index} className={`flex flex-col gap-1 ${fromMe ? "items-end" : "items-start"}`}>
              <MediaThumb
                src={src(index)}
                alt="Shared post"
                fromMe={fromMe}
                onOpenImage={onOpenImage}
                className="w-56 max-w-full aspect-square"
              />
              {att.title && <Caption text={att.title} />}
            </div>
          ) : (
            <LinkPreview key={index} url={att.url} title={att.title} kindLabel="Shared post" icon={PhotoIcon} fromMe={fromMe} />
          )
        );
        return;
      case "story":
      case "story_mention":
        blocks.push(
          att.servable ? (
            <MediaThumb
              key={index}
              src={src(index)}
              mimeType={att.mimeType}
              alt="Story"
              fromMe={fromMe}
              onOpenImage={onOpenImage}
            />
          ) : (
            <MediaUnavailable key={index} icon={StoryIcon} label="Story no longer available" fromMe={fromMe} />
          )
        );
        return;
      case "sticker":
        blocks.push(<NoticeBubble key={index} icon={<StickerIcon />}>Sticker</NoticeBubble>);
        return;
      case "ephemeral":
        blocks.push(
          <NoticeBubble key={index} icon={<TimerIcon />}>
            Disappearing photo or video, open Instagram to view
          </NoticeBubble>
        );
        return;
      case "unsupported":
        blocks.push(
          <NoticeBubble key={index} icon={<BanIcon />}>
            Unsupported message, open Instagram to view
          </NoticeBubble>
        );
        return;
    }
  });

  return blocks;
}

function Caption({ text }: { text: string }) {
  return <p className="line-clamp-3 max-w-56 px-1 text-xs text-muted break-words">{text}</p>;
}
