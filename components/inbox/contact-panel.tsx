"use client";

/**
 * ManyChat-style contact profile for the open conversation: Instagram
 * handle, email and phone (edit in place), tags, custom fields, and the
 * flow the contact is in, with a way to stop it.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import type {
  ContactFieldValue,
  InboxContact,
  InboxContactResponse,
  InboxFlowRun,
  InboxMode,
  InboxStopFlowResponse,
} from "@/lib/inbox/types";
import { formatTime, waitingLabel } from "@/lib/inbox/display";
import { CloseIcon, ExternalIcon, FlowIcon, PlusIcon } from "@/components/inbox/icons";
import { PILL, PRESS, SECTION_LABEL } from "@/components/inbox/ui";

type SaveResult = string | null;

interface ContactPanelProps {
  contact: InboxContact | null;
  username: string | null;
  mode: InboxMode;
  loading: boolean;
  onUpdated: (contact: InboxContact) => void;
}

const INPUT =
  "min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-faint focus:border-accent/40 focus:outline-none sm:min-h-9 sm:text-sm";
const BUTTON_PRIMARY = `min-h-11 shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-9 ${PRESS}`;
const BUTTON_QUIET = `min-h-11 shrink-0 rounded-lg px-3 text-sm text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50 sm:min-h-9 ${PRESS}`;

async function send<T>(url: string, method: "PATCH" | "POST", body: unknown): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    if (payload.success) return { data: payload.data as T };
    return { error: payload.error ?? "Could not save" };
  } catch {
    return { error: "Could not save. Check your connection and try again." };
  }
}

export default function ContactPanel({ contact, username, mode, loading, onUpdated }: ContactPanelProps) {
  const handle = contact?.username ?? username;

  async function patch(body: Record<string, unknown>): Promise<SaveResult> {
    if (!contact) return "Contact not loaded";
    const result = await send<InboxContactResponse>(
      `/api/inbox/contacts/${encodeURIComponent(contact.conversationId)}`,
      "PATCH",
      body
    );
    if (result.data) onUpdated(result.data.contact);
    return result.error ?? null;
  }

  async function stopFlow(): Promise<SaveResult> {
    if (!contact) return "Contact not loaded";
    const result = await send<InboxStopFlowResponse>(
      `/api/inbox/contacts/${encodeURIComponent(contact.conversationId)}/flow-run`,
      "POST",
      { action: "stop" }
    );
    if (result.data) onUpdated(result.data.contact);
    return result.error ?? null;
  }

  return (
    <div className="space-y-6 px-4 py-4">
      <ProfileHeader username={handle} />

      {!contact ? (
        <p className="text-sm text-muted">
          {loading
            ? "Loading contact…"
            : mode === "live"
              ? "Contact details appear once this conversation is mirrored by OpenSetter."
              : "No contact details for this conversation yet."}
        </p>
      ) : (
        <>
          <Section label="Flow">
            {contact.flowRun ? (
              <FlowRunCard key={contact.flowRun.id} run={contact.flowRun} onStop={stopFlow} />
            ) : (
              <p className="text-sm text-muted">No flow running.</p>
            )}
          </Section>

          <Section label="Contact">
            <dl className="space-y-3">
              <InlineField
                label="Email"
                value={contact.email}
                capturedAt={contact.emailCapturedAt}
                inputType="email"
                placeholder="name@example.com"
                onSave={(value) => patch({ email: value })}
              />
              <InlineField
                label="Phone"
                value={contact.phone}
                capturedAt={contact.phoneCapturedAt}
                inputType="tel"
                placeholder="+49 151 2345678"
                onSave={(value) => patch({ phone: value })}
              />
            </dl>
          </Section>

          <Section label="Tags">
            <TagsEditor
              tags={contact.tags}
              onAdd={(tag) => patch({ addTags: [tag] })}
              onRemove={(tag) => patch({ removeTags: [tag] })}
            />
          </Section>

          <Section label="Custom fields">
            <FieldsEditor
              fields={contact.customFields}
              onSet={(key, value) => patch({ setFields: { [key]: value } })}
              onUnset={(key) => patch({ unsetFields: [key] })}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className={`mb-2 ${SECTION_LABEL}`}>{label}</h3>
      {children}
    </section>
  );
}

function ProfileHeader({ username }: { username: string | null }) {
  const initial = (username?.[0] ?? "?").toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-hover text-lg font-semibold text-muted"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold leading-tight tracking-[-0.01em] text-foreground">
          {username ? `@${username}` : "Unknown user"}
        </p>
        {username ? (
          <a
            href={`https://www.instagram.com/${encodeURIComponent(username)}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            View on Instagram
            <ExternalIcon size={12} />
          </a>
        ) : (
          <p className="mt-0.5 text-xs text-faint">Username not known yet</p>
        )}
      </div>
    </div>
  );
}

function FlowRunCard({ run, onStop }: { run: InboxFlowRun; onStop: () => Promise<SaveResult> }) {
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const until = run.waiting?.until ? formatTime(run.waiting.until) : null;

  async function stop() {
    setStopping(true);
    setError(null);
    const result = await onStop();
    setStopping(false);
    if (result) setError(result);
    else setConfirming(false);
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">
          <FlowIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{run.flow.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {waitingLabel(run)}
            {until ? ` until ${until}` : ""}
          </p>
          {run.currentNodeName && (
            <p className="mt-0.5 truncate text-xs text-faint">Step: {run.currentNodeName}</p>
          )}
        </div>
        <span className={`${PILL} shrink-0 ${run.status === "RUNNING" ? "text-success" : "text-muted"}`}>
          {run.status === "RUNNING" ? "Running" : "Waiting"}
        </span>
      </div>

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">Stop this flow for this contact? It cannot be resumed.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={stopping} className={BUTTON_QUIET}>
              Keep running
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              className={`min-h-11 shrink-0 rounded-lg bg-error px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 sm:min-h-9 ${PRESS}`}
            >
              {stopping ? "Stopping…" : "Stop flow"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`mt-3 min-h-11 w-full rounded-lg border border-border text-sm font-medium text-error hover:bg-surface-hover sm:min-h-9 ${PRESS}`}
        >
          Stop flow
        </button>
      )}
    </div>
  );
}

/** A value that turns into an input on tap; Enter saves, Escape cancels. */
function InlineField({
  label,
  value,
  capturedAt,
  inputType = "text",
  placeholder,
  onSave,
  onRemove,
}: {
  label: string;
  value: string | null;
  capturedAt?: string | null;
  inputType?: "text" | "email" | "tel";
  placeholder?: string;
  onSave: (value: string | null) => Promise<SaveResult>;
  onRemove?: () => Promise<SaveResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  }

  async function commit(next: string | null) {
    setSaving(true);
    setError(null);
    const result = await onSave(next);
    setSaving(false);
    if (result) setError(result);
    else setEditing(false);
  }

  async function remove() {
    if (!onRemove) return commit(null);
    setSaving(true);
    const result = await onRemove();
    setSaving(false);
    if (result) setError(result);
    else setEditing(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) {
      setEditing(false);
      return;
    }
    void commit(trimmed || null);
  }

  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5">
        {editing ? (
          <form onSubmit={onSubmit} className="space-y-2">
            <input
              type={inputType}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Keep the sheet open: Escape only leaves the field.
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              placeholder={placeholder}
              aria-label={label}
              aria-invalid={error ? true : undefined}
              autoFocus
              disabled={saving}
              autoComplete="off"
              className={INPUT}
            />
            {error && <p className="text-xs text-error">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {value !== null && (
                <button type="button" onClick={() => void remove()} disabled={saving} className={`${BUTTON_QUIET} mr-auto text-error hover:text-error`}>
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BUTTON_QUIET}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={BUTTON_PRIMARY}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={start}
            className={`-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-hover sm:min-h-0 ${PRESS}`}
          >
            {value ? (
              <span className="block break-words text-foreground">{value}</span>
            ) : (
              <span className="text-accent">Add {label.toLowerCase()}</span>
            )}
            {value && capturedAt && (
              <span className="mt-0.5 block text-[11px] text-faint">Captured {formatTime(capturedAt)}</span>
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

function TagsEditor({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (tag: string) => Promise<SaveResult>;
  onRemove: (tag: string) => Promise<SaveResult>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<SaveResult>) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (result) setError(result);
    return result;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const tag = draft.trim();
    if (!tag) return;
    const result = await run("__add", () => onAdd(tag));
    if (!result) setDraft("");
  }

  return (
    <div className="space-y-2">
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-surface-hover py-0.5 pl-2.5 pr-0.5 text-xs text-foreground"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                onClick={() => void run(tag, () => onRemove(tag))}
                disabled={busy !== null}
                aria-label={`Remove tag ${tag}`}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-faint hover:bg-border hover:text-foreground disabled:opacity-50 ${PRESS}`}
              >
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No tags yet.</p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a tag"
          aria-label="New tag"
          maxLength={50}
          disabled={busy !== null}
          className={INPUT}
        />
        <button
          type="submit"
          disabled={busy !== null || !draft.trim()}
          aria-label="Add tag"
          className={`inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50 sm:min-h-9 sm:w-9 ${PRESS}`}
        >
          <PlusIcon />
        </button>
      </form>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

function FieldsEditor({
  fields,
  onSet,
  onUnset,
}: {
  fields: Record<string, ContactFieldValue>;
  onSet: (key: string, value: string) => Promise<SaveResult>;
  onUnset: (key: string) => Promise<SaveResult>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const key = name.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    const result = await onSet(key, value.trim());
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    setName("");
    setValue("");
  }

  return (
    <div className="space-y-3">
      {entries.length > 0 ? (
        <dl className="space-y-3">
          {entries.map(([key, current]) => (
            <InlineField
              key={key}
              label={key}
              value={String(current)}
              onSave={(next) => (next === null ? onUnset(key) : onSet(key, next))}
              onRemove={() => onUnset(key)}
            />
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">No custom fields yet.</p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Field name"
            aria-label="New field name"
            maxLength={40}
            disabled={busy}
            className={INPUT}
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value"
            aria-label="New field value"
            maxLength={500}
            disabled={busy}
            className={INPUT}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-faint">An existing name updates its value.</p>
          <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
            {busy ? "Saving…" : "Add field"}
          </button>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
      </form>
    </div>
  );
}
