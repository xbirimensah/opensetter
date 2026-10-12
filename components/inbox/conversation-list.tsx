"use client";

/**
 * The inbox's conversation list: newest activity first, a type icon for
 * media previews, and quiet markers for held AI drafts and running flows.
 */

import type { ComponentType } from "react";
import type { InboxConversationItem } from "@/lib/inbox/types";
import { formatTime, MEDIA_PREVIEW_KINDS, previewText } from "@/lib/inbox/display";
import {
  BanIcon,
  CardIcon,
  FileIcon,
  FlowIcon,
  LinkIcon,
  MicIcon,
  PhotoIcon,
  ReelIcon,
  StickerIcon,
  StoryIcon,
  TapIcon,
  TimerIcon,
  VideoIcon,
} from "@/components/inbox/icons";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const KIND_ICONS: Record<string, IconComponent> = {
  image: PhotoIcon,
  video: VideoIcon,
  audio: MicIcon,
  file: FileIcon,
  card: CardIcon,
  share: LinkIcon,
  reel: ReelIcon,
  post: PhotoIcon,
  story_reply: StoryIcon,
  story_mention: StoryIcon,
  sticker: StickerIcon,
  ephemeral: TimerIcon,
  deleted: BanIcon,
  postback: TapIcon,
};

/** Stable selection key: the participant, so a list refresh never loses it. */
export function conversationKey(c: InboxConversationItem): string {
  return c.contact.id || c.id;
}

interface ConversationListProps {
  conversations: InboxConversationItem[];
  activeKey: string | null;
  heldDraftKeys: Set<string>;
  onOpen: (key: string) => void;
}

export default function ConversationList({
  conversations,
  activeKey,
  heldDraftKeys,
  onOpen,
}: ConversationListProps) {
  return (
    <ul className="py-1">
      {conversations.map((c) => {
        const key = conversationKey(c);
        const isActive = key === activeKey;
        const last = c.lastMessage;
        const kind = last?.deleted ? "deleted" : last?.kind;
        const Icon = kind && MEDIA_PREVIEW_KINDS.has(kind) ? KIND_ICONS[kind] : null;
        const preview = last
          ? last.deleted
            ? "Message deleted"
            : previewText(last.text)
          : "";
        return (
          <li key={key} className="px-1.5">
            <button
              type="button"
              onClick={() => onOpen(key)}
              aria-current={isActive ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-100 active:bg-fill-strong ${
                isActive ? "bg-fill-strong" : "hover:bg-fill"
              }`}
            >
              <span
                aria-hidden="true"
                className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill-strong text-headline font-semibold text-muted"
              >
                {(c.contact.username ?? "?").charAt(0).toUpperCase()}
                {heldDraftKeys.has(c.contact.id) && (
                  <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-warning" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {c.contact.username ? `@${c.contact.username}` : "Unknown user"}
                    </span>
                    {heldDraftKeys.has(c.contact.id) && (
                      <span className="sr-only">AI draft waiting for review</span>
                    )}
                    {c.hasActiveFlow && (
                      <span className="shrink-0 self-center text-faint" title="Flow running">
                        <FlowIcon size={12} />
                        <span className="sr-only">Flow running</span>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-caption tabular-nums text-faint">
                    {formatTime(c.updatedTime)}
                  </span>
                </span>
                {last && (
                  <span className="mt-0.5 flex min-w-0 items-center gap-1 text-footnote text-muted">
                    {last.fromMe && <span className="shrink-0">You:</span>}
                    {Icon && <Icon size={12} className="shrink-0 text-faint" />}
                    <span className={`truncate ${last.deleted ? "italic" : ""}`}>{preview}</span>
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
