"use client";

/**
 * Flows List
 *
 * Every ManyChat-style flow in the workspace: status, what starts it, which
 * comment campaigns run it, runs in progress and when it changed.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountSelect from "@/components/account-select";
import type { FlowAccount, FlowListItem } from "@/components/flows/api-types";
import { summarizeTriggers } from "@/components/flows/graph-utils";
import { Icon } from "@/components/flows/icons";
import { Button, IconButton, Menu, PRESS, StatusPill } from "@/components/flows/ui";

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

export default function FlowsPage() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowListItem[]>([]);
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
          triggers: source.data.triggers,
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
    if (!window.confirm(`Delete "${flow.name}"? Runs in progress stop. This cannot be undone.`)) return;
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
          <div key={i} className="panel h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Flows</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Multi-step DM automations: messages with buttons and media, questions, conditions, tags and webhooks.
            Start them from DM keywords, stories, ig.me links or a comment campaign.
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
          {newFlowButton}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {flows.length === 0 ? (
        <div className="panel rounded-2xl p-6 text-center sm:p-12">
          <h2 className="text-lg font-semibold tracking-tight">No flows yet</h2>
          <p className="mx-auto mb-6 mt-2 max-w-sm text-sm text-muted">
            Build a conversation once: a welcome message, a question for their email, a branch for followers, a hand-off to
            your AI setter. Then reuse it from any trigger.
          </p>
          <div className="flex justify-center">{newFlowButton}</div>
        </div>
      ) : (
        <ul className="space-y-3">
          {flows.map((flow) => {
            const triggerLine = summarizeTriggers(flow.triggers);
            return (
              <li key={flow.id}>
                <div className="panel group relative rounded-2xl p-4 transition-colors duration-150 hover:border-border-hover">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/flows/${flow.id}`}
                          className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                        >
                          {flow.name}
                        </Link>
                        <StatusPill status={flow.status} />
                        {accounts.length > 1 && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                            @{flow.instagramAccount.username}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted">
                        {triggerLine || (flow.automations.length > 0 ? "Comment campaigns only" : "No triggers yet")}
                      </p>
                      {flow.firstText && <p className="truncate text-xs text-faint">&ldquo;{flow.firstText}&rdquo;</p>}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                        <span>
                          {flow.nodeCount} {flow.nodeCount === 1 ? "step" : "steps"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={flow.activeRuns > 0 ? "font-medium text-foreground" : undefined}>
                          {flow.activeRuns} active {flow.activeRuns === 1 ? "run" : "runs"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Updated {relativeTime(flow.updatedAt)}</span>
                      </div>
                      {flow.automations.length > 0 && (
                        <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted">Used in</span>
                          {flow.automations.map((campaign) => (
                            <Link
                              key={campaign.id}
                              href={`/campaigns/${campaign.id}`}
                              className="max-w-full truncate rounded-md border border-accent/15 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent hover:border-accent/30"
                            >
                              {campaign.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative z-10">
                      <Menu
                        align="right"
                        width="w-44"
                        items={[
                          { label: "Open", onSelect: () => router.push(`/flows/${flow.id}`) },
                          { label: "Duplicate", onSelect: () => void duplicateFlow(flow) },
                          {
                            label: "Use in a campaign",
                            onSelect: () => router.push(`/campaigns/new?flowId=${flow.id}`),
                          },
                          { label: "Delete", tone: "danger", onSelect: () => void deleteFlow(flow) },
                        ]}
                        trigger={(props) => (
                          <IconButton label={`Actions for ${flow.name}`} {...props}>
                            <Icon.more className="h-4 w-4" />
                          </IconButton>
                        )}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
