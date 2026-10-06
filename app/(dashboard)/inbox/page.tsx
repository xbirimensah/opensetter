"use client";

/**
 * Inbox
 *
 * Instagram DM conversations for the selected account, with live message
 * history and a reply composer. Messages are read from the Conversations API
 * (Meta only exposes the 20 most recent per thread) and refreshed by polling.
 * Sending is subject to Instagram's 24-hour messaging window — Meta's error is
 * surfaced verbatim when it applies.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { readCache, writeCache } from "@/lib/client-cache";
import type { ConversationListItem } from "@/app/api/instagram/conversations/route";
import type { ThreadMessage } from "@/app/api/instagram/conversations/[id]/route";

const POLL_MS = 12_000;
// Cached list/threads are shown instantly on revisit, then revalidated in the
// background. The Instagram Conversations API is slow (often several seconds),
// so this is what makes the inbox feel fast after the first load.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;

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

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  // Seed from the last-used account so a revisit can paint the cached
  // conversation list immediately, before the account list even loads.
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("inbox:selectedAccount") ?? "";
  });

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

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

  const scrollRef = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // Accounts for the selector; default to the first connected account. Uses the
  // lightweight accounts endpoint (one query) rather than the heavy dashboard
  // stats aggregation, so the inbox isn't gated on analytics before it can load.
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
          return stillValid
            ? prev
            : payload.data.selectedInstagramAccountId || next[0]?.id || "";
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
      if (!silent) setConvLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setConversations(data.data.conversations);
          writeCache(convCacheKey(selectedAccountId), data.data.conversations);
          setConvError(null);
        } else if (!silent) {
          setConvError(data.error ?? "Failed to load conversations");
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
    setActiveId(null);
    setMessages([]);
    const cached = readCache<ConversationListItem[]>(
      convCacheKey(selectedAccountId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      setConversations(cached.data);
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
      for (const c of payload.data.conversations as Array<
        ThreadAiState & { participantId: string }
      >) {
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
        setDraftEdits((prev) => {
          const next = { ...prev };
          delete next[draftId];
          return next;
        });
        void loadAiStates();
        if (activeId) void loadMessages(activeId, true);
      } else {
        setDraftError(data.error ?? "Something went wrong");
      }
    } catch {
      setDraftError("Something went wrong");
    } finally {
      setAiBusy(false);
    }
  }

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations/${conversationId}?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) {
          setMessages(data.data.messages);
          writeCache(msgCacheKey(conversationId), data.data.messages);
        }
      } catch {
        // keep whatever is shown
      } finally {
        if (!silent) setThreadLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Load + poll the open thread. Cached messages render instantly while a fresh
  // copy loads silently; opening a thread never shows a blank pane on revisit.
  useEffect(() => {
    if (!activeId) return;
    const cached = readCache<ThreadMessage[]>(
      msgCacheKey(activeId),
      CACHE_MAX_AGE_MS
    );
    if (cached.data) {
      // Paint cached messages instantly on thread change; intentional reset.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(cached.data);
      setThreadLoading(false);
    } else {
      setMessages([]);
      setThreadLoading(true);
    }
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(
      () => void loadMessages(activeId, true),
      POLL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeId, loadMessages]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    setActiveId(id);
    setSendError(null);
    // Paint any cached thread synchronously so the pane never flashes empty
    // or shows the previously open conversation while the fetch runs.
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    setSending(true);
    setSendError(null);

    // Optimistically show the reply immediately, then confirm with the server.
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
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
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        // Roll the optimistic message back and restore the draft so it's not lost.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setSendError(data.error ?? "Failed to send message");
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
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

  return (
    <div className="space-y-4">
      {/* The top bar already titles the page on mobile; the row only
          remains there for the account picker. */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h1 className="hidden text-lg font-semibold text-foreground sm:block">Inbox</h1>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
          />
        )}
      </div>

      {/* Mobile height also clears the bottom nav and safe-area insets. */}
      <div className="grid h-[calc(100dvh-12rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[22rem] grid-cols-1 overflow-hidden rounded border border-border sm:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:h-[calc(100dvh-11rem)]">
        {/* Conversation list. On mobile it takes the full pane and is hidden
            once a thread is open (ManyChat-style); on sm+ it is always shown. */}
        <div
          className={`min-h-0 flex-col border-b border-border sm:flex sm:border-b-0 sm:border-r ${
            active ? "hidden" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            Conversations
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {convLoading ? (
              <p className="px-4 py-6 text-sm text-muted">Loading…</p>
            ) : convError ? (
              <p className="px-4 py-6 text-sm text-error">{convError}</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No conversations yet.</p>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={`block w-full border-b border-border px-4 py-3 text-left ${
                      isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        {aiStates[c.contact.id]?.heldDraft && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-warning"
                            title="AI draft waiting for review"
                          />
                        )}
                        <span className="truncate text-sm font-medium text-foreground">
                          @{c.contact.username ?? "unknown"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {formatTime(c.updatedTime)}
                      </span>
                    </div>
                    {c.lastMessage && (
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {c.lastMessage.fromMe ? "You: " : ""}
                        {c.lastMessage.text || "(no text)"}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread. On mobile it is only shown once a conversation is open and
            fills the pane; on sm+ it always sits beside the list. */}
        <div
          className={`min-h-0 flex-col ${active ? "flex" : "hidden sm:flex"}`}
        >
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
              Select a conversation to read and reply.
            </div>
          ) : (
            <>
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-sm font-semibold text-foreground sm:px-4 sm:py-3">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="-ml-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 text-muted hover:text-foreground sm:hidden"
                  aria-label="Back to conversations"
                >
                  Back
                </button>
                <span className="truncate">
                  @{active.contact.username ?? "unknown"}
                </span>
                {(() => {
                  const state = aiStates[active.contact.id];
                  const current = state?.aiEnabled === false
                    ? "OFF"
                    : state?.modeOverride ?? "DEFAULT";
                  return (
                    <select
                      value={current}
                      onChange={(e) => void setThreadMode(e.target.value)}
                      disabled={aiBusy}
                      title="How the AI setter handles this thread"
                      className="ml-auto min-h-11 max-w-[11rem] shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted focus:border-accent/40 focus:outline-none disabled:opacity-50 sm:min-h-0 sm:text-[11px]"
                    >
                      {THREAD_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 sm:p-4">
                {threadLoading && messages.length === 0 ? (
                  <p className="text-sm text-muted">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted">No messages.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-sm sm:max-w-[75%] ${
                          m.fromMe
                            ? "bg-accent text-white"
                            : "bg-surface text-foreground border border-border"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p
                          className={`mt-1 text-[10px] ${
                            m.fromMe ? "text-white/70" : "text-faint"
                          }`}
                        >
                          {formatTime(m.createdTime)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {(() => {
                const heldDraft = aiStates[active.contact.id]?.heldDraft;
                if (!heldDraft) return null;
                const editValue = draftEdits[heldDraft.id] ?? heldDraft.draftText;
                return (
                  <div className="shrink-0 border-t border-accent/30 bg-accent/5 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-xs font-semibold text-accent">
                        AI draft waiting for review
                      </span>
                      <span className="text-[11px] tabular-nums text-muted">
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
                      className="mt-2 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground focus:border-accent/40 focus:outline-none sm:text-sm"
                    />
                    <p className="mt-1 text-[11px] text-faint">
                      Edits before sending are saved as a voice correction for this contact.
                    </p>
                    {draftError && (
                      <p className="mt-1 text-xs text-error">{draftError}</p>
                    )}
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void actOnDraft(heldDraft.id, "dismiss")}
                        disabled={aiBusy}
                        className="min-h-11 rounded-lg px-4 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-3 sm:text-xs"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void actOnDraft(heldDraft.id, "approve")}
                        disabled={aiBusy || !editValue.trim()}
                        className="min-h-11 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:px-3 sm:text-xs"
                      >
                        Approve & send
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="shrink-0 border-t border-border p-2 sm:p-3">
                {sendError && (
                  <p className="mb-2 text-xs text-error">{sendError}</p>
                )}
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
                    className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground placeholder:text-faint focus:border-accent/40 focus:outline-none sm:min-h-[40px] sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim()}
                    className="min-h-11 shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
