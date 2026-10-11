"use client";

/**
 * Renderers for the pieces of a DM: photos, videos, files, link and post
 * previews, story thumbnails and template cards. Media always loads from
 * the authenticated same-origin route (/api/inbox/media/<id>/<index>).
 */

import { useState, type ComponentType, type ImgHTMLAttributes } from "react";
import type { InboxAttachment } from "@/lib/inbox/types";
import { inboxMediaPath, isAllowedMediaUrl } from "@/lib/inbox/media";
import { hostOf, safeHref } from "@/lib/inbox/display";
import { ExternalIcon, FileIcon, LinkIcon, PhotoIcon } from "@/components/inbox/icons";
import { PRESS } from "@/components/inbox/ui";
import styles from "@/components/inbox/inbox.module.css";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** Plain <img>: the media route is authenticated, so next/image cannot optimize it. */
function MediaImg(props: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- alt is always passed by callers
  return <img loading="lazy" decoding="async" {...props} />;
}

export function MediaUnavailable({
  icon: Icon = PhotoIcon,
  label,
  fromMe,
}: {
  icon?: IconComponent;
  label: string;
  fromMe: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-2xl border border-dashed px-3 py-2 text-sm text-muted ${
        fromMe ? "border-accent/40" : "border-border"
      }`}
    >
      <Icon />
      <span>{label}</span>
    </div>
  );
}

export function ImageAttachment({
  src,
  alt,
  fromMe,
  onOpen,
}: {
  src: string;
  alt: string;
  fromMe: boolean;
  onOpen: (src: string, alt: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MediaUnavailable label="Photo not available" fromMe={fromMe} />;
  return (
    <button
      type="button"
      onClick={() => onOpen(src, alt)}
      aria-label={`Open ${alt.toLowerCase()}`}
      className={`block overflow-hidden rounded-2xl border border-border bg-surface-hover ${PRESS}`}
    >
      <MediaImg
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        className="block max-h-80 min-h-20 w-auto min-w-20 max-w-full object-cover"
      />
    </button>
  );
}

export function VideoAttachment({ src, fromMe, label = "Video" }: { src: string; fromMe: boolean; label?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MediaUnavailable label={`${label} not available`} fromMe={fromMe} />;
  return (
    <video
      src={src}
      controls
      preload="metadata"
      playsInline
      aria-label={label}
      onError={() => setFailed(true)}
      className="block max-h-96 w-[18rem] max-w-full rounded-2xl border border-border bg-black"
    />
  );
}

/**
 * A preview whose type may be unknown (story and post thumbnails): uses
 * the stored MIME type when there is one, else tries a photo, then a video.
 */
export function MediaThumb({
  src,
  mimeType,
  alt,
  fromMe,
  onOpenImage,
  className = "w-36 aspect-[9/16]",
}: {
  src: string;
  mimeType?: string;
  alt: string;
  fromMe: boolean;
  onOpenImage: (src: string, alt: string) => void;
  className?: string;
}) {
  const initial = mimeType?.startsWith("video/") ? "video" : "image";
  const [mode, setMode] = useState<"image" | "video" | "failed">(initial);

  if (mode === "failed") return <MediaUnavailable label={`${alt} not available`} fromMe={fromMe} />;
  if (mode === "video") {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        aria-label={alt}
        onError={() => setMode("failed")}
        className={`block rounded-2xl border border-border bg-black object-cover ${className}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenImage(src, alt)}
      aria-label={`Open ${alt.toLowerCase()}`}
      className={`block overflow-hidden rounded-2xl border border-border bg-surface-hover ${PRESS}`}
    >
      <MediaImg
        src={src}
        alt={alt}
        onError={() => setMode(initial === "image" && !mimeType?.startsWith("image/") ? "video" : "failed")}
        className={`block object-cover ${className}`}
      />
    </button>
  );
}

export function FileChip({
  src,
  name,
  servable,
  fromMe,
}: {
  src: string;
  name?: string;
  servable: boolean;
  fromMe: boolean;
}) {
  const label = name || "File";
  if (!servable) return <MediaUnavailable icon={FileIcon} label={`${label} not available`} fromMe={fromMe} />;
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 ${PRESS} ${
        fromMe ? "bg-accent text-white hover:bg-accent-hover" : "border border-border bg-surface hover:bg-surface-hover"
      }`}
    >
      <span
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          fromMe ? "bg-white/20" : "bg-surface-hover text-muted"
        }`}
      >
        <FileIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className={`block text-[11px] ${fromMe ? "text-white/75" : "text-faint"}`}>Open file</span>
      </span>
      <ExternalIcon className="shrink-0 opacity-70" />
    </a>
  );
}

/** Link / reel / post preview when there is nothing to play inline. */
export function LinkPreview({
  url,
  title,
  kindLabel,
  icon: Icon = LinkIcon,
  fromMe,
}: {
  url?: string;
  title?: string;
  kindLabel: string;
  icon?: IconComponent;
  fromMe: boolean;
}) {
  const href = safeHref(url);
  const host = hostOf(url);
  const body = (
    <>
      <span
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          fromMe ? "bg-white/20" : "bg-surface-hover text-muted"
        }`}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[11px] font-medium tracking-[0.01em] ${fromMe ? "text-white/75" : "text-faint"}`}>
          {kindLabel}
        </span>
        <span className="line-clamp-2 block text-sm font-medium break-words">{title || host || "Open on Instagram"}</span>
        {title && host && (
          <span className={`block truncate text-[11px] ${fromMe ? "text-white/75" : "text-faint"}`}>{host}</span>
        )}
      </span>
    </>
  );
  const base = `flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
    fromMe ? "bg-accent text-white" : "border border-border bg-surface text-foreground"
  }`;
  if (!href) return <div className={base}>{body}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${base} ${PRESS} ${fromMe ? "hover:bg-accent-hover" : "hover:bg-surface-hover"}`}
    >
      {body}
    </a>
  );
}

type CardAttachment = Extract<InboxAttachment, { type: "card" }>;

/**
 * Generic template: optional image, bold title, subtitle and stacked
 * buttons. Several cards become a horizontal swipe gallery. URL buttons
 * open in a new tab; postback buttons are labels only.
 */
export function CardGallery({
  cards,
  messageId,
  fromMe,
}: {
  /** Each card with its index in the message's attachments. */
  cards: { card: CardAttachment; index: number }[];
  messageId: string;
  fromMe: boolean;
}) {
  const many = cards.length > 1;
  return (
    <div
      className={`flex max-w-full gap-2 ${many ? `snap-x snap-mandatory overflow-x-auto pb-1 ${styles.gallery}` : ""}`}
      role={many ? "group" : undefined}
      aria-label={many ? `${cards.length} cards` : undefined}
    >
      {cards.map(({ card, index }) => (
        <TemplateCard key={index} card={card} src={cardImageSrc(card, messageId, index, fromMe)} />
      ))}
    </div>
  );
}

/** Proxy Meta-hosted images; our own outbound cards may point at their own https image. */
function cardImageSrc(card: CardAttachment, messageId: string, index: number, fromMe: boolean): string | null {
  if (!card.imageUrl && !card.servable) return null;
  if (card.servable || isAllowedMediaUrl(card.imageUrl)) return inboxMediaPath(messageId, index);
  const direct = safeHref(card.imageUrl);
  return fromMe && direct?.startsWith("https://") ? direct : null;
}

function TemplateCard({ card, src }: { card: CardAttachment; src: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className="w-60 max-w-[80vw] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-surface text-foreground">
      {src && !imageFailed && (
        <MediaImg
          src={src}
          alt={card.title ? `Image for ${card.title}` : "Card image"}
          onError={() => setImageFailed(true)}
          className="block aspect-[1.91/1] w-full bg-surface-hover object-cover"
        />
      )}
      {(card.title || card.subtitle) && (
        <div className="px-3 py-2.5">
          {card.title && <p className="text-sm font-semibold leading-snug break-words">{card.title}</p>}
          {card.subtitle && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-snug break-words text-muted">{card.subtitle}</p>
          )}
        </div>
      )}
      {card.buttons.map((button, i) => {
        const href = button.type === "url" ? safeHref(button.url) : null;
        const cls = "block border-t border-border px-3 py-2.5 text-center text-sm font-medium";
        return href ? (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${cls} text-accent hover:bg-surface-hover ${PRESS}`}
          >
            {button.title}
          </a>
        ) : (
          <span key={i} className={`${cls} text-foreground/80`} title="Button">
            {button.title}
          </span>
        );
      })}
    </article>
  );
}
