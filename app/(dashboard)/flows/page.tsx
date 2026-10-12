"use client";

/**
 * Flows List
 *
 * Every automation in the workspace in one list: flows (with their
 * comment triggers merged in) and classic comment campaigns that predate
 * flows (Classic badge, they open the campaign editor). Name, what starts
 * it, status, runs or sends, and when it changed.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountSelect from "@/components/account-select";
import type { ClassicCampaignItem, FlowAccount, FlowListItem } from "@/components/flows/api-types";
import { newId } from "@/components/flows/graph-utils";
import { Icon } from "@/components/flows/icons";
import { Button, IconButton, Menu, PRESS } from "@/components/flows/ui";
import { triggersForCopy } from "@/lib/flows/comment-triggers";
import { describeEditorTrigger, summarizeEditorTriggers } from "@/lib/flows/trigger-summary";

type Row =
  | { kind: "flow"; updatedAt: string; flow: FlowListItem }
  | { kind: "classic"; updatedAt: string; campaign: ClassicCampaignItem };

const STATUS_BADGE: Record<"DRAFT" | "ACTIVE" | "PAUSED", { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted/15 text-muted" },
  ACTIVE: { label: "Live", className: "bg-success/12 text-success" },
  PAUSED: { label: "Paused", className: "bg-warning/12 text-warning" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString();
}

function Badge({ status }: { status: "DRAFT" | "ACTIVE" | "PAUSED" }) {
  const badge = STATUS_BADGE[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${badge.className}`}>
      {badge.label}
    </span>
  );
}

export default function FlowsPage() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [classic, setClassic] = useState<ClassicCampaignItem[]>([]);
  const [accounts, setAccounts] = useState<FlowAccount[]>([]);
  const [accountId, setAccountId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const query = accountId !== "all" ? `?instagramAccountId=${encodeURIComponent(accountId)}` : "";
    fetch(`/api/flows${query}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        if (!payload?.success) {
          setError(payload?.error ?? "Could not load flows");
          return;
        }
        setFlows(payload.data as FlowListItem[]);
        setClassic((payload.classicCampaigns ?? []) as ClassicCampaignItem[]);
        setAccounts(payload.accounts as FlowAccount[]);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load flows");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadKey]);

  async function createFlow(instagramAccountId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled flow", instagramAccountId }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error ?? "Could not create the flow");
      router.push(`/flows/${payload.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the flow");
      setBusy(false);
    }
  }

  async function duplicateFlow(flow: FlowListItem) {
    setError(null);
    try {
      const source = await fetch(`/api/flows/${flow.id}`, { cache: "no-store" }).then((r) => r.json());
      if (!source.success) throw new Error(source.error ?? "Could not read the flow");
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${flow.name} copy`.slice(0, 100),
          instagramAccountId: flow.instagramAccountId,
          graph: source.data.graph,
          triggers: Array.isArray(source.data.triggers) ? triggersForCopy(source.data.triggers, () => newId("t")) : [],
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error ?? "Could not duplicate the flow");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not duplicate the flow");
    }
  }

  async function deleteFlow(flow: FlowListItem) {
    const comments = flow.triggers.filter((t) => t.type === "comment").length;
    const extra =
      comments > 0
        ? ` Its ${comments === 1 ? "comment trigger and its" : `${comments} comment triggers and their`} send history are deleted too.`
        : "";
    if (!window.confirm(`Delete "${flow.name}"?${extra} Runs in progress stop. This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error ?? "Could not delete the flow");
      setFlows((current) => current.filter((f) => f.id !== flow.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the flow");
    }
  }

  async function deleteClassic(campaign: ClassicCampaignItem) {
    if (!window.confirm(`Delete the classic campaign "${campaign.name}" and its send history? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/automations?id=${encodeURIComponent(campaign.id)}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload.error ?? "Could not delete the campaign");
      setClassic((current) => current.filter((c) => c.id !== campaign.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the campaign");
    }
  }

  const targetAccount = accountId !== "all" ? accountId : accounts.length === 1 ? accounts[0].id : null;

  const newFlowButton =
    accounts.length === 0 ? (
      <a
        href="/api/instagram/connect"
        className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover sm:min-h-9 ${PRESS}`}
      >
        Connect Instagram
      </a>
    ) : targetAccount ? (
      <Button variant="primary" disabled={busy} onClick={() => void createFlow(targetAccount)}>
        <Icon.plus className="h-4 w-4" />
        {busy ? "Creating…" : "New flow"}
      </Button>
    ) : (
      <Menu
        align="right"
        items={accounts.map((account) => ({
          label: `@${account.username}`,
          hint: account.name ?? undefined,
          onSelect: () => void createFlow(account.id),
        }))}
        trigger={(props) => (
          <Button variant="primary" disabled={busy} {...props}>
            <Icon.plus className="h-4 w-4" />
            {busy ? "Creating…" : "New flow"}
          </Button>
        )}
      />
    );

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  const rows: Row[] = [
    ...flows.map((flow) => ({ kind: "flow" as const, updatedAt: flow.updatedAt, flow })),
    ...classic.map((campaign) => ({ kind: "classic" as const, updatedAt: campaign.updatedAt, campaign })),
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {/* The app top bar already titles the page "Flows". */}
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            Every automation starts here: a comment on a post or reel, a DM keyword, a story reply or an ig.me link,
            then messages, questions, conditions and actions on a canvas.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {accounts.length > 1 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={(value) => {
                setLoading(true);
                setAccountId(value);
              }}
            />
          )}
          <div className="flex items-center gap-2">
            {newFlowButton}
            <Menu
              align="right"
              width="w-60"
              items={[
                {
                  label: "Import classic campaigns",
                  hint: "From a CSV, one row per campaign",
                  onSelect: () => router.push("/campaigns/import"),
                },
              ]}
              trigger={(props) => (
                <IconButton label="More" {...props}>
                  <Icon.more className="h-4 w-4" />
                </IconButton>
              )}
            />
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="panel rounded-2xl p-6 text-center sm:p-12">
          <h2 className="text-lg font-semibold tracking-tight">No flows yet</h2>
          <p className="mx-auto mb-6 mt-2 max-w-sm text-sm text-muted">
            Start with a trigger, like a comment on your next reel, then send a message with a button, ask for an email
            and deliver the link.
          </p>
          <div className="flex justify-center">{newFlowButton}</div>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-surface">
          <li className="hidden grid-cols-[minmax(0,1fr)_88px_112px_120px_44px] gap-4 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint md:grid">
            <span>Name</span>
            <span>Status</span>
            <span className="text-right">Runs</span>
            <span>Updated</span>
            <span className="sr-only">Actions</span>
          </li>
          {rows.map((row) =>
            row.kind === "flow" ? (
              <FlowRow
                key={row.flow.id}
                flow={row.flow}
                showAccount={accounts.length > 1}
                onOpen={() => router.push(`/flows/${row.flow.id}`)}
                onDuplicate={() => void duplicateFlow(row.flow)}
                onDelete={() => void deleteFlow(row.flow)}
              />
            ) : (
              <ClassicRow
                key={row.campaign.id}
                campaign={row.campaign}
                showAccount={accounts.length > 1}
                onStats={() => router.push(`/campaigns/${row.campaign.id}`)}
                onDelete={() => void deleteClassic(row.campaign)}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}

const ROW = "relative grid gap-x-4 gap-y-1.5 border-b border-border px-4 py-3.5 last:border-b-0 transition-colors duration-150 hover:bg-surface-hover/60 md:grid-cols-[minmax(0,1fr)_88px_112px_120px_44px] md:items-center";

function FlowRow({
  flow,
  showAccount,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  flow: FlowListItem;
  showAccount: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const summary = summarizeEditorTriggers(flow.triggers);
  return (
    <li className={ROW}>
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/flows/${flow.id}`}
            className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-foreground after:absolute after:inset-0 after:content-['']"
          >
            {flow.name}
          </Link>
          <span className="md:hidden">
            <Badge status={flow.status} />
          </span>
          {showAccount && (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">@{flow.instagramAccount.username}</span>
          )}
        </div>
        <p className="truncate text-[13px] text-muted">{summary || "No trigger yet"}</p>
        {flow.firstText && <p className="truncate text-xs text-faint">&ldquo;{flow.firstText}&rdquo;</p>}
      </div>
      <span className="hidden md:block">
        <Badge status={flow.status} />
      </span>
      <span className="text-xs tabular-nums text-muted md:text-right">
        <span className="font-medium text-foreground">{flow.totalRuns}</span> {flow.totalRuns === 1 ? "run" : "runs"}
        {flow.activeRuns > 0 && <span className="block text-[11px] text-faint">{flow.activeRuns} in progress</span>}
        {flow.sends > 0 && <span className="block text-[11px] text-faint">{flow.sends} {flow.sends === 1 ? "send" : "sends"}</span>}
      </span>
      <span className="text-xs text-faint">Updated {relativeTime(flow.updatedAt)}</span>
      <div className="absolute right-2 top-2.5 z-10 md:static">
        <Menu
          align="right"
          width="w-44"
          items={[
            { label: "Open", onSelect: onOpen },
            { label: "Duplicate", onSelect: onDuplicate },
            { label: "Delete", tone: "danger", hint: "Asks first", onSelect: onDelete },
          ]}
          trigger={(props) => (
            <IconButton label={`Actions for ${flow.name}`} {...props}>
              <Icon.more className="h-4 w-4" />
            </IconButton>
          )}
        />
      </div>
    </li>
  );
}

function ClassicRow({
  campaign,
  showAccount,
  onStats,
  onDelete,
}: {
  campaign: ClassicCampaignItem;
  showAccount: boolean;
  onStats: () => void;
  onDelete: () => void;
}) {
  const status = campaign.isActive ? "ACTIVE" : "PAUSED";
  return (
    <li className={ROW}>
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/campaigns/${campaign.id}/edit`}
            className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-foreground after:absolute after:inset-0 after:content-['']"
          >
            {campaign.name}
          </Link>
          <span
            className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"
            title="A comment campaign from before flows. It opens in the campaign editor."
          >
            Classic
          </span>
          <span className="md:hidden">
            <Badge status={status} />
          </span>
          {showAccount && (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">@{campaign.instagramAccount.username}</span>
          )}
        </div>
        <p className="truncate text-[13px] text-muted">{describeEditorTrigger(campaign.trigger)}</p>
        {campaign.dmMessage && <p className="truncate text-xs text-faint">&ldquo;{campaign.dmMessage}&rdquo;</p>}
      </div>
      <span className="hidden md:block">
        <Badge status={status} />
      </span>
      <span className="text-xs tabular-nums text-muted md:text-right">
        <span className="font-medium text-foreground">{campaign.sends}</span> {campaign.sends === 1 ? "send" : "sends"}
      </span>
      <span className="text-xs text-faint">Updated {relativeTime(campaign.updatedAt)}</span>
      <div className="absolute right-2 top-2.5 z-10 md:static">
        <Menu
          align="right"
          width="w-44"
          items={[
            { label: "Stats", onSelect: onStats },
            { label: "Delete", tone: "danger", hint: "Asks first", onSelect: onDelete },
          ]}
          trigger={(props) => (
            <IconButton label={`Actions for ${campaign.name}`} {...props}>
              <Icon.more className="h-4 w-4" />
            </IconButton>
          )}
        />
      </div>
    </li>
  );
}
