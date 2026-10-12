"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

// Shared text field style. text-base on mobile keeps iOS from zooming into the
// field on focus; sm: restores the compact desktop size.
const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-faint focus:border-accent/40 focus:outline-none sm:py-2 sm:text-sm";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  aiPersonalizeDm?: boolean;
  isActive: boolean;
  instagramAccountId: string;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
  flowId?: string | null;
}

/** A flow the campaign can run instead of the simple DM. */
interface CampaignFlowOption {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  firstText: string | null;
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors sm:min-h-0 ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-border-hover"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  // The before: pseudo-element pads the hit area to ~44px on touch screens
  // without changing how the switch looks.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-2.5 before:-inset-x-1 sm:before:hidden ${
        on ? "bg-accent" : "bg-border-hover"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [aiPersonalizeDm, setAiPersonalizeDm] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Open link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Open link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("i'm following");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");

  // Optional flow that replaces the simple DM pipeline ("" = simple DM).
  const [flowId, setFlowId] = useState("");
  const [accountFlows, setAccountFlows] = useState<CampaignFlowOption[]>([]);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");
  // Below lg the preview stacks under a long form, so it starts collapsed.
  const [previewOpen, setPreviewOpen] = useState(false);

  // The dashboard scrolls inside <main>, not the window, so jumping back to
  // the top (next import row, save errors) goes through this element.
  const topRef = useRef<HTMLDivElement>(null);

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Flows of the selected account, for the "run a flow instead" picker.
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch(`/api/flows?instagramAccountId=${encodeURIComponent(selectedAccountId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        setAccountFlows(payload.data as CampaignFlowOption[]);
      })
      .catch(() => {
        if (!cancelled) setAccountFlows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // /campaigns/new?flowId=... preselects that flow and its account.
  useEffect(() => {
    if (mode !== "new") return;
    const requested = new URLSearchParams(window.location.search).get("flowId");
    if (!requested) return;
    let cancelled = false;
    fetch(`/api/flows/${encodeURIComponent(requested)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        setSelectedAccountId(payload.data.instagramAccountId);
        setFlowId(payload.data.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const c = (payload.data as LoadedCampaign[]).find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setAiPersonalizeDm(c.aiPersonalizeDm ?? false);
        setLinkButtonLabel(c.linkButtonLabel ?? "Open link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Open link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "i'm following"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFlowId(c.flowId ?? "");
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Send link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  // Drafts and active flows can be picked; a paused one stays listed only
  // while it is the current choice.
  const flowOptions = accountFlows.filter(
    (f) => f.status !== "PAUSED" || f.id === flowId
  );
  const selectedFlow = accountFlows.find((f) => f.id === flowId) ?? null;
  const usesFlow = Boolean(flowId);

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) return setError("Connect an Instagram account first.");
    if (triggerScope === "specific" && !postId)
      return setError("Pick a post or reel to trigger the campaign.");
    if (matchMode === "specific" && keywords.length === 0)
      return setError("Add at least one keyword, or switch to any word.");
    // A flow brings its own messages, so the simple-DM checks only apply without one.
    if (!usesFlow && !dmMessage.trim()) return setError("Add the DM with the link.");
    if (
      !usesFlow &&
      openingDmEnabled &&
      (!openingDmMessage.trim() || !openingDmButtonLabel.trim())
    )
      return setError("Your opening DM needs a message and a button label.");
    // New flow campaigns never start the legacy steps; edits keep them stored
    // so switching back to the simple DM restores them.
    const legacyOff = usesFlow && mode === "new";

    setSaving(true);

    const payload = {
      name: name.trim() || `Campaign for @${username}`,
      instagramAccountId: selectedAccountId,
      postId: triggerScope === "specific" ? postId : null,
      postUrl: triggerScope === "specific" ? postUrl : null,
      matchAnyPost: triggerScope === "any",
      pendingNextReel: triggerScope === "next",
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      dmMessage,
      flowId: usesFlow ? flowId : null,
      aiPersonalizeDm: legacyOff ? false : aiPersonalizeDm,
      openingDmEnabled: legacyOff ? false : openingDmEnabled,
      openingDmMessage: openingDmEnabled && !legacyOff ? openingDmMessage : null,
      openingDmButtonLabel: openingDmEnabled && !legacyOff ? openingDmButtonLabel : null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled
        ? publicReplyMessages.map((m) => m.trim()).filter(Boolean)
        : [],
      trackedDestinationUrl: trackedDestinationUrl.trim() || "",
      linkButtonLabel: linkButtonLabel.trim() || "Open link",
      secondaryDestinationUrl: secondaryDestinationUrl.trim() || "",
      secondaryButtonLabel: secondaryButtonLabel.trim() || "Open link",
      requireFollow: legacyOff ? false : requireFollow,
      followPromptMessage: requireFollow && !legacyOff ? followPromptMessage.trim() : "",
      followPromptButtonLabel:
        requireFollow && !legacyOff
          ? followPromptButtonLabel.trim() || "i'm following"
          : "",
      followUpEnabled: legacyOff ? false : followUpEnabled,
      followUpMessage: followUpEnabled && !legacyOff ? followUpMessage.trim() : "",
      isActive: activeValue,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/automations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/automations?id=${campaignId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          topRef.current?.scrollIntoView({ block: "start" });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/flows");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Failed to save campaign"
        );
        topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    } catch {
      setError("Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      topRef.current?.scrollIntoView({ block: "start" });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/flows");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Campaign not found.</p>
        <button
          onClick={() => router.push("/flows")}
          className="mt-4 min-h-11 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground sm:min-h-0"
        >
          Back to flows
        </button>
      </div>
    );
  }

  return (
    <div ref={topRef} className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importing {importTotal - importQueue.length + 1} of {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Fields are prefilled from your CSV. Pick the reel, edit anything, and
            save to load the next one — or Skip if you don&rsquo;t want this one.
          </span>
        </div>
      )}

      {/* Top bar. Sticky below lg so Save stays reachable from deep in the
          form; it pins to the top of the scroll area, clear of the mobile
          bottom nav and the home indicator. */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background py-3 sm:gap-4 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Untitled campaign"}
              </span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-muted/15 text-muted"
                }`}
              >
                {isActive ? "LIVE" : "PAUSED"}
              </span>
            </>
          ) : (
            <span className="truncate text-sm text-muted">New campaign</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-4"
            >
              {importQueue.length > 1 ? "Skip" : "Skip & finish"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-4"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50 sm:min-h-0 sm:px-4"
              >
                Go Live
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:px-5"
          >
            {saving ? "Saving…" : mode === "new" ? "Go Live" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
      {/* Left: controls */}
      <div className="min-w-0 space-y-8">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            Campaign name{" "}
            <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. YC referral"
            className={FIELD_CLASS}
            maxLength={100}
          />
          {accounts.length > 1 && (
            <div className="pt-2">
              <AccountSelect
                accounts={accounts}
                value={selectedAccountId}
                onChange={(id) => {
                  setSelectedAccountId(id);
                  setPostId(null);
                  setPostUrl(null);
                  setPostThumb(null);
                  // Flows belong to one account.
                  setFlowId("");
                }}
                includeAll={false}
                label="Instagram account"
              />
            </div>
          )}
        </div>

        <Section title="When someone comments on">
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            a specific post or reel
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            any post or reel
          </Radio>
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            next post or reel
          </Radio>
        </Section>

        <Section title="And this comment has">
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            a specific word or words
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="Enter a word or multiple"
                className={FIELD_CLASS}
              />
              <p className="text-xs text-muted">Use commas to separate words</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            any word
          </Radio>
          {!usesFlow && (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                AI-personalize the DM per commenter
              </span>
              <Toggle
                on={aiPersonalizeDm}
                onToggle={() => setAiPersonalizeDm(!aiPersonalizeDm)}
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              The AI setter rewrites your DM text as a direct response to each
              comment, in your voice. Links and buttons stay untouched; any
              failure falls back to your static text.
            </p>
          </div>
          )}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              reply to their comments under the post
            </span>
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />
          </div>
          {publicReplyEnabled && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Sent you a DM! 📩"
                    maxLength={1000}
                    className={FIELD_CLASS}
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-muted hover:text-error sm:min-h-0 sm:min-w-0"
                      aria-label="Remove reply"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline sm:min-h-0"
                >
                  + Add another reply
                </button>
              )}
              <p className="text-xs text-muted">
                One is picked at random each time, so replies don&apos;t look
                identical.
              </p>
            </div>
          )}
        </Section>

        <Section title="Run a flow instead of the simple DM">
          <select
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            aria-label="Flow to run"
            className={`${FIELD_CLASS} cursor-pointer`}
          >
            <option value="">No, send the simple DM below</option>
            {flowOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.status === "DRAFT" ? " (draft)" : f.status === "PAUSED" ? " (paused)" : ""}
              </option>
            ))}
          </select>
          {usesFlow ? (
            <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-muted">
              <p>
                A matching comment starts this flow. Its first message goes out
                as the private reply to the comment, so give it a button.
              </p>
              {selectedFlow?.status === "DRAFT" && (
                <p className="text-warning">
                  This flow is still a draft. Activate it so the campaign can
                  run it.
                </p>
              )}
              <Link
                href={`/flows/${flowId}`}
                className="inline-flex min-h-11 items-center font-medium text-accent hover:underline sm:min-h-0"
              >
                Open the flow
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted">
              {flowOptions.length === 0 ? (
                <>
                  No flows on this account yet.{" "}
                  <Link href="/flows" className="text-accent hover:underline">
                    Build one
                  </Link>{" "}
                  for multi-step DMs with buttons, questions and branches.
                </>
              ) : (
                "Pick a flow for multi-step DMs with buttons, questions and branches."
              )}
            </p>
          )}
        </Section>

        {!usesFlow && (
        <Section title="They will get">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">an opening DM</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder="Hey there! I'm so happy you're here 😊"
                  rows={3}
                  className={`${FIELD_CLASS} resize-none`}
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder="Send me the link"
                  className={FIELD_CLASS}
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                a follow requirement first
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over"
                  rows={3}
                  className={`${FIELD_CLASS} resize-none`}
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="i'm following"
                  className={FIELD_CLASS}
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  We send the link only after they tap the button and Instagram
                  confirms the follow. If it can&apos;t be verified, we send it
                  anyway.
                </p>
              </div>
            )}
          </div>
        </Section>
        )}

        {!usesFlow && (
        <Section title="And then, they will get">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">a DM with a link</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder="Write a message"
              rows={3}
              className={`${FIELD_CLASS} resize-none`}
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="https://yourlink.com/offer"
                  className={FIELD_CLASS}
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Button label (e.g. Open link)"
                  maxLength={20}
                  className={FIELD_CLASS}
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="https://yourlink.com/second"
                      className={FIELD_CLASS}
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Second button label"
                      maxLength={20}
                      className={FIELD_CLASS}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="min-h-11 w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground sm:min-h-0"
                  >
                    + Add A Second Link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="min-h-11 w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground sm:min-h-0"
              >
                + Add A Link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} inserts the tracked link; {"{username}"} personalizes.
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">
                a follow-up thank-you message
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Btw just wanted to say thanks for following me, I appreciate the support 🙌"
                  rows={3}
                  className={`${FIELD_CLASS} resize-none`}
                  maxLength={1000}
                />
                <p className="text-xs text-muted">
                  Sent right after the link, once they&apos;ve tapped through.
                  {" {username}"} personalizes it.
                </p>
              </div>
            )}
          </div>
        </Section>
        )}
      </div>

      {/* Right: preview. Collapsible below lg, always open from lg up. */}
      <div className="min-w-0">
        <p className="mb-4 hidden text-sm text-muted lg:block">Preview</p>
        <button
          type="button"
          onClick={() => setPreviewOpen((open) => !open)}
          aria-expanded={previewOpen}
          aria-controls="campaign-preview"
          className="mb-4 min-h-11 w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground lg:hidden"
        >
          {previewOpen ? "Hide preview" : "Show preview"}
        </button>
        <div
          id="campaign-preview"
          className={`justify-center lg:sticky lg:top-6 lg:block ${
            previewOpen ? "flex" : "hidden"
          }`}
        >
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={!usesFlow && openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={
              usesFlow ? selectedFlow?.firstText ?? "Your flow's first message" : dmMessage
            }
            hasLink={!usesFlow && Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Open link"}
            hasSecondLink={
              !usesFlow &&
              secondLinkOpen &&
              Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Open link"}
            requireFollow={!usesFlow && requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "i'm following"}
            followUpEnabled={!usesFlow && followUpEnabled}
            followUpMessage={followUpMessage}
          />
        </div>
      </div>
      </div>
    </div>
  );
}
