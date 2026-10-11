"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Instagram-style phone preview of one message (or input) step, in the
 * same dark frame as the campaign preview. Variables show sample values.
 */

import type { FlowButton, FlowContent, FlowNode } from "@/lib/flows/types";
import type { MediaItem } from "./api-types";
import { Icon } from "./icons";

const SAMPLE: Record<string, string> = {
  username: "username",
  name: "Alex Example",
  first_name: "Alex",
  email: "alex@example.com",
  phone: "+49 151 2345678",
  last_input: "sounds good",
  comment: "LINK",
  keyword: "LINK",
  ref: "bio",
};

export function fillSample(text: string): string {
  return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, name: string) => {
    if (name.startsWith("field.")) return `[${name.slice(6)}]`;
    return SAMPLE[name] ?? "";
  });
}

function Avatar({ size = 24 }: { size?: number }) {
  return <span className="shrink-0 rounded-full bg-zinc-600" style={{ width: size, height: size }} />;
}

function Buttons({ buttons }: { buttons: FlowButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className="space-y-1 px-1.5 pb-1.5">
      {buttons.map((button) => (
        <div key={button.id} className="flex items-center justify-center gap-1 rounded-xl bg-zinc-700 px-4 py-1.5 text-center text-sm font-medium text-white">
          {button.type === "url" && <Icon.link className="h-3 w-3 opacity-70" />}
          <span className="truncate">{button.title || "Button"}</span>
        </div>
      ))}
    </div>
  );
}

function Bubble({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Avatar />
      <div className={`max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md bg-zinc-800 ${className}`}>{children}</div>
    </div>
  );
}

function ContentPreview({ content, mediaById }: { content: FlowContent; mediaById: Map<string, MediaItem> }) {
  const mediaSrc =
    "mediaId" in content && content.mediaId ? mediaById.get(content.mediaId)?.path : "url" in content ? content.url : undefined;

  switch (content.type) {
    case "text":
      return (
        <Bubble>
          <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{fillSample(content.text) || "Write your message"}</p>
          <Buttons buttons={content.buttons ?? []} />
        </Bubble>
      );
    case "image":
      return (
        <div className="flex items-end gap-2">
          <Avatar />
          {mediaSrc ? (
            <img src={mediaSrc} alt="" className="max-h-56 max-w-[70%] rounded-2xl object-cover" />
          ) : (
            <div className="grid h-36 w-44 place-items-center rounded-2xl bg-zinc-800 text-zinc-500">
              <Icon.image className="h-6 w-6" />
            </div>
          )}
        </div>
      );
    case "video":
      return (
        <div className="flex items-end gap-2">
          <Avatar />
          <div className="relative grid h-40 w-32 place-items-center overflow-hidden rounded-2xl bg-zinc-800">
            {mediaSrc && <video src={mediaSrc} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </div>
        </div>
      );
    case "audio":
      return (
        <Bubble className="flex items-center gap-2 px-3 py-2.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-white" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          <span className="flex items-center gap-0.5" aria-hidden="true">
            {[6, 10, 14, 8, 12, 16, 9, 13, 7, 11, 15, 6].map((h, i) => (
              <span key={i} className="w-0.5 rounded-full bg-white/70" style={{ height: h }} />
            ))}
          </span>
          <span className="text-xs text-zinc-400">0:12</span>
        </Bubble>
      );
    case "file": {
      const name = ("mediaId" in content && content.mediaId && mediaById.get(content.mediaId)?.filename) || "document.pdf";
      return (
        <Bubble className="flex items-center gap-2 px-3 py-2.5">
          <Icon.file className="h-5 w-5 shrink-0 text-zinc-300" />
          <span className="min-w-0 truncate text-sm">{name}</span>
        </Bubble>
      );
    }
    case "cards":
      return (
        <div className="flex items-end gap-2">
          <Avatar />
          <div className="-mr-3 flex min-w-0 snap-x gap-2 overflow-x-auto pb-1 pr-3">
            {content.cards.map((card) => {
              const src = card.imageMediaId ? mediaById.get(card.imageMediaId)?.path : card.imageUrl;
              return (
                <div key={card.id} className="w-48 shrink-0 snap-start overflow-hidden rounded-2xl bg-zinc-800">
                  {src ? (
                    <img src={src} alt="" className="h-28 w-full object-cover" />
                  ) : (
                    <div className="grid h-28 place-items-center bg-zinc-700/60 text-zinc-500">
                      <Icon.image className="h-5 w-5" />
                    </div>
                  )}
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold">{fillSample(card.title) || "Card title"}</p>
                    {card.subtitle && <p className="line-clamp-2 text-xs text-zinc-400">{fillSample(card.subtitle)}</p>}
                  </div>
                  <Buttons buttons={card.buttons} />
                </div>
              );
            })}
          </div>
        </div>
      );
    case "typing":
      return (
        <div className="flex items-end gap-2">
          <Avatar />
          <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-zinc-800 px-3 py-2.5" aria-label={`Typing for ${content.seconds} seconds`}>
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
            <span className="ml-1.5 text-[10px] text-zinc-500">{content.seconds}s</span>
          </div>
        </div>
      );
  }
}

export function FlowPreview({
  node,
  username,
  mediaById,
}: {
  node: FlowNode | undefined;
  username: string;
  mediaById: Map<string, MediaItem>;
}) {
  const quickReplies =
    node?.type === "message"
      ? (node.quickReplies ?? []).map((q) => q.title || "Reply")
      : node?.type === "input" && node.skipLabel
        ? [node.skipLabel]
        : [];

  return (
    <div data-theme="dark" className="flex justify-center">
      <div className="relative w-[300px] max-w-full rounded-[2.75rem] bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-600 p-[3px] shadow-2xl">
        <div className="rounded-[2.6rem] bg-black p-[8px]">
          <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[2.1rem] bg-black text-white">
            <div className="absolute left-1/2 top-2 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
            <div className="flex items-center gap-2 px-4 pb-2 pt-10">
              <Avatar size={28} />
              <span className="min-w-0 truncate text-sm font-semibold">{username}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
              {!node && <p className="pt-24 text-center text-xs text-zinc-500">Select a message step to preview it.</p>}
              {node?.type === "message" &&
                node.contents.map((content) => <ContentPreview key={content.id} content={content} mediaById={mediaById} />)}
              {node?.type === "input" && (
                <Bubble>
                  <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{fillSample(node.prompt) || "Your question"}</p>
                </Bubble>
              )}
              {node && node.type !== "message" && node.type !== "input" && (
                <p className="pt-24 text-center text-xs text-zinc-500">This step sends nothing. Select a message to preview it.</p>
              )}
              {quickReplies.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                  {quickReplies.map((title, i) => (
                    <span key={i} className="rounded-full border border-sky-400/60 px-3 py-1 text-xs text-sky-300">
                      {title}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 pb-5 pt-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white">
                <Icon.image className="h-4 w-4" />
              </span>
              <div className="flex-1 rounded-full bg-zinc-800 px-3 py-2 text-xs text-zinc-500">Message…</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
