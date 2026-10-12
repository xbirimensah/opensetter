import { Avatar } from "@/components/site/chat";

/* One workspace running several client accounts: the account switcher,
   the team with its roles (WorkspaceRole: owner, admin, member), and a
   read-only campaign report link for the client. Example names. */

const accounts = [
  { initial: "S", handle: "studio.store", active: true },
  { initial: "M", handle: "maya.co", active: false },
  { initial: "J", handle: "jordan.home", active: false },
];

const team = [
  { initial: "A", name: "Alex", role: "Owner" },
  { initial: "R", name: "Riley", role: "Admin" },
  { initial: "T", name: "Taylor", role: "Member" },
];

export default function AgencyMock() {
  return (
    <figure className="grid gap-4 sm:grid-cols-2">
      <div className="site-card p-4">
        <p className="site-label px-1">Instagram accounts</p>
        <ul className="mt-3 space-y-1">
          {accounts.map((a) => (
            <li
              key={a.handle}
              className={`flex items-center gap-3 rounded-[var(--site-radius-sm)] px-2 py-2 text-[0.875rem] ${
                a.active ? "bg-surface-hover font-semibold" : "text-muted"
              }`}
            >
              <Avatar initial={a.initial} />
              {a.handle}
            </li>
          ))}
        </ul>
      </div>

      <div className="site-card p-4">
        <p className="site-label px-1">Team</p>
        <ul className="mt-3 space-y-1">
          {team.map((m) => (
            <li key={m.name} className="flex items-center gap-3 px-2 py-2 text-[0.875rem]">
              <Avatar initial={m.initial} />
              <span className="flex-1">{m.name}</span>
              <span className="site-chip min-h-6 px-2 text-[0.6875rem] font-medium text-muted">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="site-card flex flex-wrap items-center justify-between gap-3 p-4 sm:col-span-2">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-semibold">Campaign report: Matrix guide</p>
          <p className="mt-0.5 truncate text-[0.8125rem] text-muted">
            Read-only link, no login needed
          </p>
        </div>
        <span className="site-chip site-chip-accent font-medium normal-case tracking-normal">
          /reports/Xq3vB9kLm2aT
        </span>
      </div>
      <figcaption className="sr-only">
        Example agency workspace: three client Instagram accounts, a team with
        owner, admin and member roles, and a read-only campaign report link for a client.
      </figcaption>
    </figure>
  );
}
