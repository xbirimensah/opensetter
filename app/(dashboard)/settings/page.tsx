"use client";

import { Suspense, useEffect, useState } from "react";
import { SelectChevron, type AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import PasswordSettings from "@/components/password-settings";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
    ])
      .then(([statsPayload, membersPayload]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm("Disconnect Instagram? Campaigns for this account will stop sending DMs.")) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Could not invite member");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-8" aria-busy="true" aria-label="Loading settings">
        <div className="space-y-3">
          <div className="skeleton h-4 w-24" />
          <div className="panel h-40" />
        </div>
        <div className="space-y-3">
          <div className="skeleton h-4 w-24" />
          <div className="panel h-56" />
        </div>
      </div>
    );
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="max-w-2xl space-y-10">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section aria-labelledby="settings-instagram">
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
          <h2 id="settings-instagram" className="section-title">
            Instagram connection
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-medium ${
              accounts.length > 0
                ? "bg-success/12 text-success"
                : "bg-warning/12 text-warning"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${accounts.length > 0 ? "bg-success" : "bg-warning"}`}
            />
            {accounts.length > 0 ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="panel overflow-hidden">
          <div className="px-4 py-3.5 sm:px-5">
            <p className="text-sm text-muted">
              Comment webhooks and private replies depend on this connection.
            </p>
            <p className="mt-0.5 text-footnote text-faint">
              {accounts.length} connected Instagram profile
              {accounts.length === 1 ? "" : "s"}
            </p>
          </div>

          {accounts.length === 0 && (
            <p className="border-t border-border px-4 py-4 text-sm text-muted sm:px-5">
              Connect an Instagram professional account to launch campaigns.
            </p>
          )}
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 border-t border-border px-4 py-3.5 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill-strong text-headline font-semibold text-muted"
                >
                  {account.username.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-0.5 text-footnote text-muted">
                    Token expires{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString()
                      : "not available"}{" "}
                    ·{" "}
                    <span className={account.webhookSubscribed ? "text-success" : "text-warning"}>
                      {account.webhookSubscribed ? "Webhook ready" : "Webhook pending"}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => disconnectInstagram(account.id)}
                disabled={busy === `disconnect:${account.id}`}
                className="btn btn-secondary btn-sm shrink-0 text-error"
              >
                {busy === `disconnect:${account.id}`
                  ? "Disconnecting…"
                  : "Disconnect"}
              </button>
            </div>
          ))}

          <div className="border-t border-border px-4 py-3.5 sm:px-5">
            <a
              href="/api/instagram/connect"
              className={`btn ${accounts.length > 0 ? "btn-secondary" : "btn-primary"}`}
            >
              {accounts.length > 0 ? "Connect another account" : "Connect Instagram"}
            </a>
          </div>
        </div>
      </section>

      <PasswordSettings />

      <section aria-labelledby="settings-team">
        <h2 id="settings-team" className="section-title mb-2.5 px-1">
          Team
        </h2>
        <div className="panel overflow-hidden">
          {membersData?.members.map((member, index) => {
            const display = member.user.name ?? member.user.email ?? "Unknown member";
            return (
              <div
                key={member.id}
                className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill-strong text-footnote font-semibold text-muted"
                  >
                    {display.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{display}</p>
                    <p className="truncate text-footnote text-muted">{member.user.email}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-fill px-2.5 py-1 text-caption font-semibold text-muted">
                  {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                </span>
              </div>
            );
          })}

          {membersData?.invitations.length ? (
            <div className="border-t border-border px-4 py-3.5 sm:px-5">
              <p className="mb-2.5 text-footnote font-semibold text-muted">Pending invites</p>
              <div className="space-y-2">
                {membersData.invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-3 rounded-xl bg-fill p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {invitation.email}
                      </p>
                      <p className="truncate text-footnote text-muted">
                        {invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase()} ·{" "}
                        {invitation.inviteUrl}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard?.writeText(invitation.inviteUrl)
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        Copy link
                      </button>
                      <button
                        type="button"
                        onClick={() => removeInvitation(invitation.id)}
                        disabled={busy === `invite:${invitation.id}`}
                        className="btn btn-quiet btn-sm text-error"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {canManageMembers && (
            <form
              onSubmit={inviteMember}
              className="grid gap-2 border-t border-border px-4 py-3.5 sm:grid-cols-[1fr_8.5rem_auto] sm:px-5"
            >
              <label className="sr-only" htmlFor="invite-email">
                Teammate email
              </label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@agency.com"
                className="field"
                required
              />
              <label className="sr-only" htmlFor="invite-role">
                Role
              </label>
              <span className="relative block">
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as "ADMIN" | "MEMBER")
                  }
                  className="field appearance-none pr-9"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <SelectChevron />
              </span>
              <button
                type="submit"
                disabled={busy === "invite"}
                className="btn btn-primary min-h-11 sm:min-h-10"
              >
                {busy === "invite" ? "Inviting…" : "Invite"}
              </button>
              {memberError && (
                <p role="alert" className="text-sm text-error sm:col-span-3">{memberError}</p>
              )}
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="settings-usage">
        <h2 id="settings-usage" className="section-title mb-2.5 px-1">
          Usage
        </h2>
        <div className="panel flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs sent this month
            </p>
            <p className="mt-0.5 text-footnote text-muted">
              Self-hosted, so there are no plan limits.
            </p>
          </div>
          <span className="text-title-3 font-semibold tabular-nums text-foreground">
            {(data?.workspace.dmsSentThisPeriod ?? 0).toLocaleString()}
          </span>
        </div>
      </section>
    </div>
  );
}
