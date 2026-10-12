/* The AI setter's two outcomes on Auto, drawn from the real gates in
   lib/ai-setter/safety.ts: a reply above the confidence minimum that
   passes every check is sent; a reply that commits the owner (price,
   meeting, logistics) is held for review. Example content and values. */

const MODES = ["Off", "Draft", "Auto"] as const;
const ACTIVE_MODE = "Auto";

function ModeSwitch() {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="site-label">Mode</p>
      <ul className="flex rounded-full border border-border bg-background p-0.5" aria-label="AI setter mode">
        {MODES.map((mode) => (
          <li
            key={mode}
            aria-current={mode === ACTIVE_MODE ? "true" : undefined}
            className={`rounded-full px-3 py-1 text-[0.8125rem] font-semibold ${
              mode === ACTIVE_MODE ? "bg-surface-hover text-foreground shadow-[inset_0_0_0_1px_var(--color-border-hover)]" : "text-muted"
            }`}
          >
            {mode}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Confidence({ value, minimum }: { value: number; minimum: number }) {
  return (
    <div>
      <div className="flex justify-between text-[0.75rem] text-muted">
        <span>Confidence {value.toFixed(2)}</span>
        <span>Minimum {minimum.toFixed(2)}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-border" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${value * 100}%` }} />
        <span className="absolute -inset-y-1 w-[2px] rounded-full bg-foreground" style={{ left: `${minimum * 100}%` }} />
      </div>
    </div>
  );
}

function StatusChip({ tone, children }: { tone: "sent" | "held"; children: string }) {
  const sent = tone === "sent";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[0.75rem] font-semibold ${
        sent ? "text-success" : "text-warning"
      }`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {sent ? <path d="M3.5 8.5l3 3 6-7" /> : <path d="M8 4.5v4M8 11.2v.1M8 1.8l6.5 11.5h-13z" />}
      </svg>
      {children}
    </span>
  );
}

export default function AiSetterMock() {
  return (
    <figure className="site-card space-y-5 p-5 sm:p-6">
      <ModeSwitch />

      <div className="rounded-[var(--site-radius-md)] border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8125rem] font-semibold">Reply to maya.co</p>
          <StatusChip tone="sent">Sent</StatusChip>
        </div>
        <p className="mt-2.5 text-[0.875rem] leading-6">
          It does. What do you coach, and how do people find you today?
        </p>
        <div className="mt-4">
          <Confidence value={0.91} minimum={0.8} />
        </div>
      </div>

      <div className="rounded-[var(--site-radius-md)] border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.8125rem] font-semibold">Reply to sam.fit</p>
          <StatusChip tone="held">Needs review</StatusChip>
        </div>
        <p className="mt-2.5 text-[0.875rem] leading-6">
          Happy to hold a spot for you at the founder price.
        </p>
        <p className="mt-3 text-[0.75rem] text-muted">Held: makes a price commitment</p>
        <div className="mt-4 flex gap-2">
          <span className="site-btn site-btn-primary site-btn-sm pointer-events-none">Approve</span>
          <span className="site-btn site-btn-secondary site-btn-sm pointer-events-none">Edit</span>
        </div>
      </div>
      <figcaption className="sr-only">
        Example: on Auto, a reply with confidence 0.91 against a 0.80 minimum is
        sent. A reply that makes a price commitment is held with the reason shown,
        waiting for Approve or Edit.
      </figcaption>
    </figure>
  );
}
