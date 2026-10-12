"use client";

/**
 * Inbox
 *
 * Instagram DM conversations for the selected account, read from the local
 * mirror so every message type renders the way Instagram shows it (voice
 * notes, photos, videos, files, cards, shares, story replies, reactions,
 * swipe-replies, edits, deletes), with a ManyChat-style contact profile
 * beside the thread. Until the mirror holds anything for an account the
 * API falls back to Meta's live Conversations API (text only).
 *
 * Sending is subject to Instagram's 24-hour messaging window; Meta's error
 * is surfaced verbatim when it applies.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import type {
  InboxContact,
  InboxConversationItem,
  InboxConversationsResponse,
  InboxMessage,
  InboxMode,
  InboxThreadResponse,
} from "@/lib/inbox/types";
import { mergeMessages, oldestCursor } from "@/lib/inbox/thread";
import ConversationList, { conversationKey } from "@/components/inbox/conversation-list";
import ThreadView from "@/components/inbox/thread-view";
import ContactPanel from "@/components/inbox/contact-panel";
import Sheet from "@/components/inbox/sheet";
import Lightbox, { type LightboxImage } from "@/components/inbox/lightbox";
import { OPTIMISTIC_PREFIX } from "@/components/inbox/message-bubble";
import { ProfileIcon } from "@/components/inbox/icons";
import { ChevronLeftIcon, InboxIcon } from "@/components/nav-icons";
import { PRESS } from "@/components/inbox/ui";
import { useMediaQuery } from "@/components/inbox/use-media-query";

const POLL_MS = 12_000;
// Cached list/threads are shown instantly on revisit, then revalidated in the
// background.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:v2:convs:${accountId}`;
const threadCacheKey = (conversationId: string) => `inbox:v2:thread:${conversationId}`;
/** From here the contact profile is a third column instead of a sheet. */
const WIDE_QUERY = "(min-width: 1280px)";

interface HeldDraft {
  id: string;
  draftText: string;
  confidence: number;
  reasons: string[];
  createdAt: string;
}

interface ThreadAiState {
  aiEnabled: boolean;
  modeOverride: "OFF" | "DRAFT" | "AUTO" | null;
  heldDraft: HeldDraft | null;
}

const THREAD_MODES = [
  { value: "DEFAULT", label: "AI: account default" },
  { value: "AUTO", label: "AI: autopilot" },
  { value: "DRAFT", label: "AI: drafts only" },
  { value: "OFF", label: "AI: off" },
];

interface ThreadState {
  /** Which conversation these messages belong to (guards stale responses). */
  conversationId: string | null;
  mode: InboxMode;
  messages: InboxMessage[];
  hasMore: boolean;
  /** True once an older page was loaded; polls then leave hasMore alone. */
  olderLoaded: boolean;
  contact: InboxContact | null;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
}

const EMPTY_THREAD: ThreadState = {
  conversationId: null,
  mode: "mirror",
  messages: [],
  hasMore: false,
  olderLoaded: false,
  contact: null,
  loading: false,
  loadingOlder: false,
  error: null,
};

/** Thread state for `conversationId`, painted from the session cache when possible. */
function threadFromCache(conversationId: string): ThreadState {
  const cached = readCache<InboxThreadResponse>(threadCacheKey(conversationId), CACHE_MAX_AGE_MS);
  if (!cached.data) return { ...EMPTY_THREAD, conversationId, loading: true };
  return {
    ...EMPTY_THREAD,
    conversationId,
    mode: cached.data.mode,
    messages: cached.data.messages,
    hasMore: cached.data.hasMore,
    contact: cached.data.contact,
  };
}

function threadUrl(accountId: string, item: { id: string }, mode: InboxMode, extra = ""): string {
  const live = mode === "live" ? "&live=1" : "";
  return `/api/inbox/conversations/${encodeURIComponent(item.id)}?instagramAccountId=${encodeURIComponent(accountId)}${live}${extra}`;
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  // Seed from the last-used account so a revisit can paint the cached
  // conversation list immediately, before the account list even loads.
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });

  const [conversations, setConversations] = useState<InboxConversationItem[]>([]);
  const [listMode, setListMode] = useState<InboxMode>("mirror");
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  // Selected by participant, not by id: the id changes if the list switches
  // from live to mirrored, the person does not.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadState>(EMPTY_THREAD);
  const [stickSignal, setStickSignal] = useState(0);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Per-thread AI setter state, keyed by the contact's IGSID. Threads
  // without an entry inherit the account default (the worker creates rows
  // lazily on the first message).
  const [aiStates, setAiStates] = useState<Record<string, ThreadAiState>>({});
  const [aiBusy, setAiBusy] = useState(false);
  // Local edits to held drafts, keyed by draft id.
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [draftError, setDraftError] = useState<string | null>(null);

  const isWide = useMediaQuery(WIDE_QUERY);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ image: LightboxImage | null; open: boolean }>({
    image: null,
    open: false,
  });

  const active = conversations.find((c) => conversationKey(c) === activeKey) ?? null;
  const activeId = active?.id ?? null;
  const heldDraftKeys = useMemo(
    () => new Set(Object.entries(aiStates).filter(([, s]) => s.heldDraft).map(([id]) => id)),
    [aiStates]
  );

  // Accounts for the selector; default to the first connected account.
  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId((prev) => {
          // Keep the seeded account only if it's still connected; otherwise
          // fall back to the default so a removed account can't wedge the inbox.
          const stillValid = prev && next.some((a) => a.id === prev);
          return stillValid ? prev : payload.data.selectedInstagramAccountId || next[0]?.id || "";
        });
      })
      .catch(() => setAccounts([]));
  }, []);

  // Remember the chosen account for the next visit.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId) return;
      try {
        const res = await fetch(
          `/api/inbox/conversations?instagramAccountId=${encodeURIComponent(selectedAccountId)}`,
          { cache: "no-store" }
        );
        const payload = await res.json();
        if (payload.success) {
          const data = payload.data as InboxConversationsResponse;
          setConversations(data.conversations);
          setListMode(data.mode);
          writeCache(convCacheKey(selectedAccountId), data);
          setConvError(null);
        } else if (!silent) {
          setConvError(payload.error ?? "Failed to load conversations");
        }
      } catch {
        if (!silent) setConvError("Failed to load conversations");
      } finally {
        if (!silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll conversations for the selected account. A cached list is shown
  // immediately (so revisits are instant) while a fresh copy loads silently.
  useEffect(() => {
    if (!selectedAccountId) return;
    // Reset the open thread when switching accounts. This is an intentional
    // synchronous reset on a dependency change, not derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveKey(null);
    setThread(EMPTY_THREAD);
    const cached = readCache<InboxConversationsResponse>(
      convCacheKey(selectedAccountId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data?.conversations) {
      setConversations(cached.data.conversations);
      setListMode(cached.data.mode);
      setConvLoading(false);
    } else {
      setConversations([]);
      setConvLoading(true);
    }
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  // AI setter state per thread: mode, toggle, and any held draft. Polled
  // so drafts appear in an open inbox without a reload.
  const loadAiStates = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      const res = await fetch(
        `/api/ai-setter/conversations?instagramAccountId=${selectedAccountId}`,
        { cache: "no-store" }
      );
      const payload = await res.json();
      if (!payload.success) return;
      const next: Record<string, ThreadAiState> = {};
      for (const c of payload.data.conversations as Array<ThreadAiState & { participantId: string }>) {
        next[c.participantId] = {
          aiEnabled: c.aiEnabled,
          modeOverride: c.modeOverride,
          heldDraft: c.heldDraft,
        };
      }
      setAiStates(next);
    } catch {
      // keep whatever is shown
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    // Initial fetch on account change; intentional, matching the
    // conversations poll above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAiStates();
    const timer = window.setInterval(() => void loadAiStates(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadAiStates]);

  const loadThread = useCallback(
    async (conversationId: string, mode: InboxMode) => {
      if (!selectedAccountId) return;
      try {
        const res = await fetch(threadUrl(selectedAccountId, { id: conversationId }, mode), {
          cache: "no-store",
        });
        const payload = await res.json();
        if (!payload.success) {
          const error = (payload.error as string) ?? "Failed to load messages";
          setThread((prev) =>
            prev.conversationId === conversationId ? { ...prev, loading: false, error } : prev
          );
          return;
        }
        const data = payload.data as InboxThreadResponse;
        writeCache(threadCacheKey(conversationId), data);
        setThread((prev) =>
          prev.conversationId !== conversationId
            ? prev
            : {
                ...prev,
                mode: data.mode,
                messages: mergeMessages(prev.messages, data.messages),
                hasMore: prev.olderLoaded ? prev.hasMore : data.hasMore,
                contact: data.contact,
                loading: false,
                error: null,
              }
        );
      } catch {
        setThread((prev) =>
          prev.conversationId === conversationId
            ? { ...prev, loading: false, error: prev.messages.length ? null : "Failed to load messages" }
            : prev
        );
      }
    },
    [selectedAccountId]
  );

  // Load + poll the open thread. Cached messages render instantly while a
  // fresh copy loads silently.
  useEffect(() => {
    if (!activeId) return;
    // Repaint from cache only when the open thread's id actually changed
    // (e.g. the list switched from live to mirrored).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThread((prev) => (prev.conversationId === activeId ? prev : threadFromCache(activeId)));
    void loadThread(activeId, listMode);
    const timer = window.setInterval(() => void loadThread(activeId, listMode), POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, listMode, loadThread]);

  async function loadOlder() {
    const conversationId = thread.conversationId;
    const cursor = oldestCursor(thread.messages);
    if (!conversationId || !cursor || thread.loadingOlder || !selectedAccountId) return;
    setThread((prev) => ({ ...prev, loadingOlder: true }));
    try {
      const extra = `&before=${encodeURIComponent(cursor.before)}&beforeId=${encodeURIComponent(cursor.beforeId)}`;
      const res = await fetch(threadUrl(selectedAccountId, { id: conversationId }, thread.mode, extra), {
        cache: "no-store",
      });
      const payload = await res.json();
      setThread((prev) => {
        if (prev.conversationId !== conversationId) return prev;
        if (!payload.success) return { ...prev, loadingOlder: false };
        const data = payload.data as InboxThreadResponse;
        return {
          ...prev,
          messages: mergeMessages(prev.messages, data.messages),
          hasMore: data.hasMore,
          olderLoaded: true,
          loadingOlder: false,
        };
      });
    } catch {
      setThread((prev) => ({ ...prev, loadingOlder: false }));
    }
  }

  async function setThreadMode(modeValue: string) {
    const contactId = active?.contact.id;
    if (!contactId || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/ai-setter/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          participantId: contactId,
          modeOverride: modeValue === "DEFAULT" ? null : modeValue,
          aiEnabled: true,
        }),
      });
      const data = await res.json();
      if (data.success) void loadAiStates();
    } catch {
      // state refresh will correct the UI
    } finally {
      setAiBusy(false);
    }
  }

  async function actOnDraft(draftId: string, action: "approve" | "dismiss") {
    if (aiBusy) return;
    setAiBusy(true);
    setDraftError(null);
    try {
      const body =
        action === "approve"
          ? { action, text: (draftEdits[draftId] ?? "").trim() || undefined }
          : { action };
      const res = await fetch(`/api/ai-setter/replies/${draftId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setDraftEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== draftId)));
        void loadAiStates();
        if (activeId) void loadThread(activeId, listMode);
      } else {
        setDraftError(data.error ?? "Something went wrong");
      }
    } catch {
      setDraftError("Something went wrong");
    } finally {
      setAiBusy(false);
    }
  }

  function openConversation(key: string) {
    const item = conversations.find((c) => conversationKey(c) === key);
    setActiveKey(key);
    setSendError(null);
    // Paint any cached thread synchronously so the pane never flashes empty
    // or shows the previously open conversation while the fetch runs.
    if (item) setThread(threadFromCache(item.id));
  }

  function closeConversation() {
    setActiveKey(null);
    setSheetOpen(false);
  }

  function onContactUpdated(contact: InboxContact) {
    setThread((prev) => (prev.conversationId === contact.conversationId ? { ...prev, contact } : prev));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === contact.conversationId ? { ...c, hasActiveFlow: Boolean(contact.flowRun) } : c
      )
    );
  }

  function toggleProfile() {
    if (isWide) setPanelOpen((open) => !open);
    else setSheetOpen(true);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    const conversationId = active.id;
    setSending(true);
    setSendError(null);

    // Optimistically show the reply immediately; it stays until the mirror
    // has the real message (matched by Meta's message id).
    const sentAt = new Date().toISOString();
    const optimistic: InboxMessage = {
      id: `${OPTIMISTIC_PREFIX}${sentAt}`,
      mid: `${OPTIMISTIC_PREFIX}${sentAt}`,
      fromMe: true,
      source: "HUMAN",
      kind: "text",
      text,
      attachments: [],
      replyToMid: null,
      reaction: null,
      editedAt: null,
      deletedAt: null,
      sentAt,
      pending: true,
    };
    const withoutOptimistic = (prev: ThreadState) =>
      prev.conversationId === conversationId
        ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimistic.id) }
        : prev;

    setThread((prev) =>
      prev.conversationId === conversationId ? { ...prev, messages: [...prev.messages, optimistic] } : prev
    );
    setStickSignal((n) => n + 1);
    setDraft("");

    try {
      const res = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          recipientId: active.contact.id,
          text,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const mid: string | undefined = data.data?.message_id;
        setThread((prev) =>
          prev.conversationId === conversationId && mid
            ? {
                ...prev,
                messages: prev.messages.map((m) => (m.id === optimistic.id ? { ...m, mid } : m)),
              }
            : prev
        );
        await loadThread(conversationId, listMode);
        void loadConversations(true);
      } else {
        // Roll the optimistic message back and restore the draft so it's not lost.
        setThread(withoutOptimistic);
        setDraft(text);
        setSendError(data.error ?? "Failed to send message");
      }
    } catch {
      setThread(withoutOptimistic);
      setDraft(text);
      setSendError("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const showColumn = isWide && panelOpen && Boolean(active);
  const contactPanel = active ? (
    <ContactPanel
      contact={thread.conversationId === active.id ? thread.contact : null}
      username={active.contact.username}
      mode={thread.mode}
      loading={thread.loading}
      onUpdated={onContactUpdated}
    />
  ) : null;

  return (
    <div>
      {/* The top bar titles the page; the pane fills the rest of the
          screen. Mobile height also clears the tab bar and safe areas. */}
      <div
        className={`panel grid h-[calc(100dvh-10rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[22rem] grid-cols-1 overflow-hidden sm:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:h-[calc(100dvh-7.5rem)] ${
          showColumn ? "xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_18rem]" : ""
        }`}
      >
        {/* Conversation list. On mobile it takes the full pane and is hidden
            once a thread is open (ManyChat-style); on sm+ it is always shown. */}
        <div
          className={`min-h-0 flex-col border-b border-border sm:flex sm:border-b-0 sm:border-r ${
            active ? "hidden" : "flex"
          }`}
        >
          <div className="flex min-h-14 shrink-0 items-center border-b border-border px-3 py-2">
            {accounts.length > 1 ? (
              <div className="w-full">
                <AccountSelect
                  accounts={accounts}
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  includeAll={false}
                  hideLabel
                />
              </div>
            ) : (
              <h2 className="px-1 text-headline font-semibold text-foreground">Conversations</h2>
            )}
          </div>
          {listMode === "live" && conversations.length > 0 && (
            <p className="shrink-0 border-b border-border px-4 py-2 text-caption leading-snug text-faint">
              Showing Instagram&apos;s live inbox. Photos, voice notes and contact profiles appear once
              new messages are mirrored.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {convLoading ? (
              <div className="space-y-4 px-4 py-4" aria-busy="true" aria-label="Loading conversations">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-28" />
                      <div className="skeleton h-3 w-40 max-w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : convError ? (
              <p role="alert" className="px-4 py-6 text-sm text-error">{convError}</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">No conversations yet.</p>
            ) : (
              <ConversationList
                conversations={conversations}
                activeKey={activeKey}
                heldDraftKeys={heldDraftKeys}
                onOpen={openConversation}
              />
            )}
          </div>
        </div>

        {/* Thread. On mobile it is only shown once a conversation is open and
            fills the pane; on sm+ it always sits beside the list. */}
        <div className={`min-h-0 flex-col ${active ? "flex" : "hidden sm:flex"}`}>
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <InboxIcon size={28} className="text-quiet" />
              <p className="text-sm text-muted">Select a conversation to read and reply.</p>
            </div>
          ) : (
            <>
              <div className="flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border px-2 py-1.5 sm:px-4 sm:py-2">
                <button
                  type="button"
                  onClick={closeConversation}
                  className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent sm:hidden"
                  aria-label="Back to conversations"
                >
                  <ChevronLeftIcon size={22} />
                </button>
                <span className="min-w-0 flex-1 truncate text-headline font-semibold text-foreground">
                  {active.contact.username ? `@${active.contact.username}` : "Unknown user"}
                </span>
                {(() => {
                  const state = aiStates[active.contact.id];
                  const current = state?.aiEnabled === false ? "OFF" : state?.modeOverride ?? "DEFAULT";
                  return (
                    <select
                      value={current}
                      onChange={(e) => void setThreadMode(e.target.value)}
                      disabled={aiBusy}
                      title="How the AI setter handles this thread"
                      className="min-h-11 w-[7.5rem] shrink-0 truncate rounded-full border-0 sm:w-auto sm:max-w-[11rem] bg-fill px-3 py-1 text-footnote font-medium text-muted hover:bg-fill-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 sm:min-h-8"
                    >
                      {THREAD_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  );
                })()}
                <button
                  type="button"
                  onClick={toggleProfile}
                  aria-label={isWide ? (panelOpen ? "Hide contact profile" : "Show contact profile") : "Open contact profile"}
                  aria-expanded={isWide ? panelOpen : sheetOpen}
                  title="Contact profile"
                  className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full sm:min-h-8 sm:min-w-8 ${PRESS} ${
                    showColumn
                      ? "bg-accent/15 text-accent"
                      : "text-muted hover:bg-fill hover:text-foreground"
                  }`}
                >
                  <ProfileIcon />
                </button>
              </div>

              <ThreadView
                threadKey={active.id}
                messages={thread.conversationId === active.id ? thread.messages : []}
                loading={thread.loading}
                error={thread.error}
                hasMore={thread.hasMore && thread.mode === "mirror"}
                loadingOlder={thread.loadingOlder}
                onLoadOlder={() => void loadOlder()}
                stickSignal={stickSignal}
                onOpenImage={(src, alt) => setLightbox({ image: { src, alt }, open: true })}
              />

              {(() => {
                const heldDraft = aiStates[active.contact.id]?.heldDraft;
                if (!heldDraft) return null;
                const editValue = draftEdits[heldDraft.id] ?? heldDraft.draftText;
                return (
                  <div className="shrink-0 border-t border-accent/30 bg-accent/[0.07] p-3 sm:px-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-footnote font-semibold text-accent">AI draft waiting for review</span>
                      <span className="text-caption tabular-nums text-muted">
                        {Math.round(heldDraft.confidence * 100)}% confident
                      </span>
                    </div>
                    <textarea
                      value={editValue}
                      onChange={(e) =>
                        setDraftEdits((prev) => ({
                          ...prev,
                          [heldDraft.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      className="field field-sizing-content mt-2 max-h-48 resize-y"
                    />
                    <p className="mt-1 text-caption text-faint">
                      Edits before sending are saved as a voice correction for this contact.
                    </p>
                    {draftError && <p role="alert" className="mt-1 text-footnote text-error">{draftError}</p>}
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void actOnDraft(heldDraft.id, "dismiss")}
                        disabled={aiBusy}
                        className="btn btn-quiet btn-sm"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void actOnDraft(heldDraft.id, "approve")}
                        disabled={aiBusy || !editValue.trim()}
                        className="btn btn-primary btn-sm"
                      >
                        Approve & send
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="shrink-0 border-t border-border p-2 sm:p-3">
                {sendError && <p role="alert" className="mb-2 px-1 text-footnote text-error">{sendError}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    enterKeyHint="send"
                    aria-label="Reply"
                    placeholder="Write a reply…"
                    title="Enter to send, Shift+Enter for a new line"
                    // 16px on phones: iOS zooms into smaller focused inputs.
                    className="field max-h-32 min-w-0 flex-1 resize-none rounded-[1.25rem] px-4"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                    className="btn btn-primary min-h-11 shrink-0 sm:min-h-10"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Contact profile: a third column on wide screens. */}
        {showColumn && (
          <aside aria-label="Contact profile" className="hidden min-h-0 overflow-y-auto border-l border-border bg-background/40 xl:block">
            {contactPanel}
          </aside>
        )}
      </div>

      {/* Below the wide breakpoint the profile opens as a sheet. */}
      {!isWide && (
        <Sheet open={sheetOpen && Boolean(active)} onClose={() => setSheetOpen(false)} title="Contact profile">
          {contactPanel}
        </Sheet>
      )}

      <Lightbox
        image={lightbox.image}
        open={lightbox.open}
        onClose={() => setLightbox((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
