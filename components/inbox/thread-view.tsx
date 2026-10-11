"use client";

/**
 * The scrolling message list. Stays pinned to the newest message while the
 * reader is at the bottom (including when photos finish loading), keeps
 * their place when older messages load above, and never yanks them down
 * while they read history.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { InboxMessage } from "@/lib/inbox/types";
import { dayKey, formatDay } from "@/lib/inbox/display";
import MessageRow from "@/components/inbox/message-bubble";
import { PRESS } from "@/components/inbox/ui";
import styles from "@/components/inbox/inbox.module.css";

/** Distance from the bottom that still counts as "reading the latest". */
const PIN_THRESHOLD_PX = 80;
/** Consecutive messages closer than this read as one group. */
const GROUP_GAP_MS = 5 * 60 * 1000;
const FLASH_MS = 1200;

interface ThreadViewProps {
  /** Changes when another conversation opens (re-pins to the bottom). */
  threadKey: string;
  messages: InboxMessage[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Increment to jump to the bottom (after sending). */
  stickSignal: number;
  onOpenImage: (src: string, alt: string) => void;
}

export default function ThreadView({
  threadKey,
  messages,
  loading,
  error,
  hasMore,
  loadingOlder,
  onLoadOlder,
  stickSignal,
  onOpenImage,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  /** Scroll height before older messages were prepended. */
  const restoreRef = useRef<{ height: number; top: number } | null>(null);

  const byMid = useMemo(() => new Map(messages.map((m) => [m.mid, m])), [messages]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // A newly opened thread starts at the latest message.
  useLayoutEffect(() => {
    pinnedRef.current = true;
    scrollToBottom();
  }, [threadKey, scrollToBottom]);

  useLayoutEffect(() => {
    if (stickSignal === 0) return;
    pinnedRef.current = true;
    scrollToBottom();
  }, [stickSignal, scrollToBottom]);

  // After messages change: restore the reading position if older history
  // was prepended, else follow the bottom when pinned.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const restore = restoreRef.current;
    if (restore) {
      restoreRef.current = null;
      el.scrollTop = el.scrollHeight - restore.height + restore.top;
      return;
    }
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Media loading grows the content; keep the bottom in view while pinned.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current && !restoreRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
  }

  function loadOlder() {
    const el = scrollRef.current;
    if (el) restoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadOlder();
  }

  function jumpTo(mid: string) {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-mid="${CSS.escape(mid)}"]`);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pinnedRef.current = false;
    target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    target.classList.remove(styles.flash);
    // Restart the highlight even when the same message is jumped to twice.
    void target.offsetWidth;
    target.classList.add(styles.flash);
    window.setTimeout(() => target.classList.remove(styles.flash), FLASH_MS);
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4 sm:pb-4"
      role="log"
      aria-label="Messages"
    >
      <div ref={contentRef} className="pt-3 sm:pt-4">
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className={`min-h-9 rounded-full border border-border px-4 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50 ${PRESS}`}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}

        {loading && messages.length === 0 ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : error && messages.length === 0 ? (
          <p className="text-sm text-error">{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted">No messages.</p>
        ) : (
          messages.map((message, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const newDay = !prev || dayKey(prev.sentAt) !== dayKey(message.sentAt);
            const groupStart =
              newDay ||
              prev.fromMe !== message.fromMe ||
              Date.parse(message.sentAt) - Date.parse(prev.sentAt) > GROUP_GAP_MS;
            const groupEnd =
              !next ||
              next.fromMe !== message.fromMe ||
              dayKey(next.sentAt) !== dayKey(message.sentAt) ||
              Date.parse(next.sentAt) - Date.parse(message.sentAt) > GROUP_GAP_MS;
            return (
              <div key={message.id}>
                {newDay && (
                  <div className={`flex justify-center pb-1 ${i === 0 ? "" : "pt-4"}`}>
                    <span className="text-[11px] font-medium tracking-[0.02em] text-faint">
                      {formatDay(message.sentAt)}
                    </span>
                  </div>
                )}
                <MessageRow
                  message={message}
                  repliedTo={message.replyToMid ? byMid.get(message.replyToMid) ?? null : null}
                  showMeta={groupEnd}
                  groupStart={groupStart && !newDay}
                  onOpenImage={onOpenImage}
                  onJumpTo={jumpTo}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
