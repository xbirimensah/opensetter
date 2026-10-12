"use client";

/**
 * Campaign Detail
 *
 * Read-only stats view of a comment automation: a classic campaign, or a
 * flow's comment trigger (the flow editor links here). A summary on the
 * left, Insights / Preview tabs on the right. Classic campaigns edit and
 * stop here; a flow's trigger is edited, and goes live, with its flow.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import { flowFirstText, parseFlowGraphShape } from "@/lib/flows/validate";

interface Campaign {
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
  isActive: boolean;
  instagramAccountId: string;
  instagramAccount: { username: string };
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
  /** Set when the campaign runs a flow instead of the simple DM. */
  flowId?: string | null;
  flow?: { id: string; name: string; status: "DRAFT" | "ACTIVE" | "PAUSED" } | null;
  analytics: {
    sent: number;
    skipped: number;
    failed: number;
    clicks: number;
    ctr: number;
  };
}

type Tab = "insights" | "preview";

export default function CampaignDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("insights");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");
  const [busy, setBusy] = useState(false);
  // First text of the linked flow, for the DM preview.
  const [flowText, setFlowText] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const found = (payload.data as Campaign[]).find((c) => c.id === id);
        if (!found) return setNotFound(true);
        setCampaign(found);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!campaign) return;
    const acct = campaign.instagramAccountId;
    fetch(`/api/instagram/profile?instagramAccountId=${acct}`)
      .then((r) => r.json())
      .then((d) =>
        setAvatarUrl(d.success ? d.data.profilePictureUrl ?? null : null)
      )
      .catch(() => setAvatarUrl(null));

    if (campaign.postId) {
      fetch(`/api/instagram/posts?instagramAccountId=${acct}&limit=50`)
        .then((r) => r.json())
        .then((payload) => {
          if (!payload.success) return;
          const hit = (
            payload.data as {
              id: string;
              thumbnail_url?: string;
              media_url?: string;
            }[]
          ).find((p) => p.id === campaign.postId);
          setPostThumb(hit?.thumbnail_url ?? hit?.media_url ?? null);
        })
        .catch(() => setPostThumb(null));
    }
  }, [campaign]);

  const linkedFlowId = campaign?.flow?.id ?? null;
  useEffect(() => {
    if (!linkedFlowId) return;
    let cancelled = false;
    fetch(`/api/flows/${linkedFlowId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const graph = parseFlowGraphShape(payload.data.graph);
        setFlowText(graph.ok ? flowFirstText(graph.value) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [linkedFlowId]);

  async function toggleActive() {
    if (!campaign) return;
    setBusy(true);
    try {
      await fetch(`/api/automations?id=${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !campaign.isActive }),
      });
      setCampaign({ ...campaign, isActive: !campaign.isActive });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }
  if (notFound || !campaign) {
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

  const publicReplies =
    campaign.publicReplyMessages && campaign.publicReplyMessages.length > 0
      ? campaign.publicReplyMessages
      : campaign.publicReplyMessage
        ? [campaign.publicReplyMessage]
        : [];
  const hasLink = Boolean(campaign.trackedLinks?.[0]?.destinationUrl);
  const hasSecondLink = Boolean(campaign.trackedLinks?.[1]?.destinationUrl);

  const trigger = campaign.matchAnyPost
    ? "Any post or reel"
    : campaign.pendingNextReel
      ? "Your next reel"
      : "A specific post or reel";
  const matchText = campaign.matchAnyWord
    ? "Any comment"
    : campaign.keywords.join(", ") || "No keywords";

  const metrics = [
    { label: "Sends", value: campaign.analytics.sent },
    { label: "Clicks", value: campaign.analytics.clicks },
    { label: "CTR", value: `${campaign.analytics.ctr}%` },
    { label: "Failed", value: campaign.analytics.failed },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      {/* Left: config summary */}
      <div className="min-w-0 space-y-6">
        <div className="flex items-center gap-2">
          <Link
            href={campaign.flow ? `/flows/${campaign.flow.id}` : "/flows"}
            className="inline-flex min-h-11 items-center text-sm text-muted hover:text-foreground sm:min-h-0"
          >
            &larr; {campaign.flow ? campaign.flow.name : "Flows"}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold">{campaign.name}</h1>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
              campaign.isActive
                ? "bg-success/10 text-success"
                : "bg-muted/10 text-muted"
            }`}
          >
            {campaign.isActive ? "LIVE" : "Paused"}
          </span>
        </div>

        <Summary title="When someone comments on">
          <div className="flex items-center gap-3">
            {postThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={postThumb}
                alt="Post"
                className="h-14 w-14 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded bg-surface-hover text-[10px] text-muted">
                {campaign.matchAnyPost || campaign.pendingNextReel ? "Any" : "Post"}
              </div>
            )}
            <span className="min-w-0 text-sm text-foreground">{trigger}</span>
          </div>
        </Summary>

        <Summary title="And this comment has">
          <FieldBox>{matchText}</FieldBox>
          {publicReplies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Public reply under the post</p>
              {publicReplies.map((m, i) => (
                <FieldBox key={i}>{m}</FieldBox>
              ))}
            </div>
          )}
        </Summary>

        {campaign.flow && (
          <Summary title="And then, they will run a flow">
            <Link
              href={`/flows/${campaign.flow.id}`}
              className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground hover:border-border-hover"
            >
              <span className="min-w-0 truncate font-medium text-accent">
                {campaign.flow.name}
              </span>
              <span
                className={`shrink-0 text-xs ${
                  campaign.flow.status === "ACTIVE"
                    ? "text-success"
                    : campaign.flow.status === "PAUSED"
                      ? "text-warning"
                      : "text-muted"
                }`}
              >
                {campaign.flow.status === "ACTIVE"
                  ? "Active"
                  : campaign.flow.status === "PAUSED"
                    ? "Paused"
                    : "Draft"}
              </span>
            </Link>
            {campaign.flow.status !== "ACTIVE" && (
              <p className="text-xs text-warning">
                Set the flow live so this trigger answers comments.
              </p>
            )}
          </Summary>
        )}

        {!campaign.flow && campaign.openingDmEnabled && (
          <Summary title="They will get an opening DM">
            <FieldBox>{campaign.openingDmMessage || "Opening message"}</FieldBox>
            <FieldBox>{campaign.openingDmButtonLabel || "Button"}</FieldBox>
          </Summary>
        )}

        {!campaign.flow && campaign.requireFollow && (
          <Summary title="They must follow first">
            <FieldBox>
              {campaign.followPromptMessage ||
                "quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over"}
            </FieldBox>
            <FieldBox>
              {campaign.followPromptButtonLabel || "i'm following"}
            </FieldBox>
          </Summary>
        )}

        {!campaign.flow && (
        <Summary title="And then, they will get a DM">
          <FieldBox>{campaign.dmMessage}</FieldBox>
          {hasLink && (
            <FieldBox>{campaign.linkButtonLabel || "Open link"}</FieldBox>
          )}
          {hasSecondLink && (
            <FieldBox>
              {campaign.trackedLinks?.[1]?.label || "Open link"}
            </FieldBox>
          )}
        </Summary>
        )}
      </div>

      {/* Right: top bar + tabs */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-border pb-3">
          <div className="flex gap-4">
            <TabButton active={tab === "insights"} onClick={() => setTab("insights")}>
              Insights
            </TabButton>
            <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
              Preview
            </TabButton>
          </div>
          {campaign.flow ? (
            <Link
              href={`/flows/${campaign.flow.id}?trigger=${encodeURIComponent(campaign.id)}`}
              className="inline-flex min-h-11 items-center rounded border border-border px-4 py-1.5 text-sm text-muted hover:text-foreground sm:min-h-0 sm:px-3"
            >
              Edit in flow
            </Link>
          ) : (
          <div className="flex items-center gap-2">
            <Link
              href={`/campaigns/${campaign.id}/edit`}
              className="inline-flex min-h-11 items-center rounded border border-border px-4 py-1.5 text-sm text-muted hover:text-foreground sm:min-h-0 sm:px-3"
            >
              Edit
            </Link>
            <button
              onClick={toggleActive}
              disabled={busy}
              className={`min-h-11 rounded border px-4 py-1.5 text-sm disabled:opacity-50 sm:min-h-0 sm:px-3 ${
                campaign.isActive
                  ? "border-error/30 text-error hover:bg-error/10"
                  : "border-success/30 text-success hover:bg-success/10"
              }`}
            >
              {campaign.isActive ? "Stop" : "Resume"}
            </button>
          </div>
          )}
        </div>

        {tab === "insights" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className="panel rounded p-4">
                <p className="text-sm text-muted">{m.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {tab === "preview" && (
          <div className="flex justify-center sm:justify-start">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={campaign.instagramAccount.username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption=""
            sampleComment={campaign.matchAnyWord ? "nice!" : campaign.keywords[0] ?? "LINK"}
            publicReplyEnabled={campaign.publicReplyEnabled}
            publicReplyMessage={publicReplies[0] ?? ""}
            openingDmEnabled={!campaign.flow && campaign.openingDmEnabled}
            openingDmMessage={campaign.openingDmMessage ?? ""}
            openingDmButtonLabel={campaign.openingDmButtonLabel ?? ""}
            revealMessage={
              campaign.flow
                ? flowText ?? `Runs the flow "${campaign.flow.name}"`
                : campaign.dmMessage
            }
            hasLink={!campaign.flow && hasLink}
            linkButtonLabel={campaign.linkButtonLabel ?? "Open link"}
            hasSecondLink={!campaign.flow && hasSecondLink}
            secondLinkButtonLabel={
              campaign.trackedLinks?.[1]?.label ?? "Open link"
            }
            requireFollow={!campaign.flow && campaign.requireFollow}
            followPromptMessage={campaign.followPromptMessage ?? ""}
            followPromptButtonLabel={
              campaign.followPromptButtonLabel ?? "i'm following"
            }
            followUpEnabled={!campaign.flow && (campaign.followUpEnabled ?? false)}
            followUpMessage={campaign.followUpMessage ?? ""}
          />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function FieldBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="break-words rounded border border-border bg-surface px-3 py-2 text-sm text-foreground">
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-11 border-b-2 pb-2 text-sm font-medium sm:min-h-0 ${
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
