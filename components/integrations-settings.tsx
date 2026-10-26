"use client";

/**
 * Settings > Integrations: outgoing webhooks (signed events for Zapier,
 * Make, n8n) and API keys for the inbound API. Secrets and keys are shown
 * once, right after they are created. Owners and admins only.
 */

import { useCallback, useEffect, useState } from "react";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, type WebhookEventType } from "@/lib/integrations/catalog";
import type { ApiKeyView, EndpointView } from "@/lib/integrations/manage";

type Reveal = { label: string; value: string; hint: string } | null;

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
    const payload = await res.json();
    return payload.success ? { ok: true, data: payload.data as T } : { ok: false, error: payload.error ?? "Something went wrong" };
  } catch {
    return { ok: false, error: "Network error, try again" };
  }
}

function SecretReveal({ reveal, onDone }: { reveal: NonNullable<Reveal>; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-2 rounded-xl bg-accent/10 p-3">
      <p className="text-footnote font-semibold text-foreground">{reveal.label}</p>
      <code className="block select-all break-all rounded-lg bg-surface px-2.5 py-2 text-footnote text-foreground">
        {reveal.value}
      </code>
      <p className="text-caption text-muted">{reveal.hint}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(reveal.value);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function EventPicker({ value, onChange }: { value: WebhookEventType[]; onChange: (next: WebhookEventType[]) => void }) {
  return (
    <fieldset className="grid gap-1.5 sm:grid-cols-2">
      <legend className="sr-only">Events</legend>
      {WEBHOOK_EVENTS.map((event) => (
        <label key={event} className="flex items-center gap-2 text-footnote text-foreground">
          <input
            type="checkbox"
            checked={value.includes(event)}
            onChange={(e) => onChange(e.target.checked ? [...value, event] : value.filter((v) => v !== event))}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          {WEBHOOK_EVENT_LABELS[event]}
        </label>
      ))}
    </fieldset>
  );
}

function deliveryStatus(endpoint: EndpointView): { text: string; tone: string } {
  if (!endpoint.isActive) return { text: "Paused", tone: "text-muted" };
  if (!endpoint.lastDeliveryAt) return { text: "No deliveries yet", tone: "text-muted" };
  if (endpoint.lastError) return { text: `Last delivery failed (${endpoint.lastError})`, tone: "text-error" };
  return { text: `Last delivery ${formatWhen(endpoint.lastDeliveryAt)}, HTTP ${endpoint.lastStatus}`, tone: "text-success" };
}

export default function IntegrationsSettings() {
  const [endpoints, setEndpoints] = useState<EndpointView[]>([]);
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>(["contact.email_captured"]);
  const [keyName, setKeyName] = useState("");
  const [reveal, setReveal] = useState<Reveal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [hooks, apiKeys] = await Promise.all([
      call<{ endpoints: EndpointView[] }>("/api/integrations/webhooks"),
      call<{ keys: ApiKeyView[] }>("/api/integrations/api-keys"),
    ]);
    if (hooks.ok) setEndpoints(hooks.data.endpoints);
    if (apiKeys.ok) setKeys(apiKeys.data.keys);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  const addEndpoint = (event: React.FormEvent) => {
    event.preventDefault();
    void run("add-endpoint", async () => {
      const result = await call<{ endpoint: EndpointView; secret: string }>("/api/integrations/webhooks", {
        method: "POST",
        body: JSON.stringify({ url, events }),
      });
      if (!result.ok) return setError(result.error);
      setEndpoints((list) => [...list, result.data.endpoint]);
      setUrl("");
      setReveal({
        label: "Signing secret",
        value: result.data.secret,
        hint: "Shown once. Use it to check the X-OpenSetter-Signature header (docs/integrations.md).",
      });
    });
  };

  const patchEndpoint = (id: string, patch: Partial<Pick<EndpointView, "isActive" | "events">>) =>
    run(`patch:${id}`, async () => {
      const result = await call<{ endpoint: EndpointView }>(`/api/integrations/webhooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!result.ok) return setError(result.error);
      setEndpoints((list) => list.map((e) => (e.id === id ? result.data.endpoint : e)));
    });

  const removeEndpoint = (id: string) =>
    run(`delete:${id}`, async () => {
      const result = await call(`/api/integrations/webhooks/${id}`, { method: "DELETE" });
      if (!result.ok) return setError(result.error);
      setEndpoints((list) => list.filter((e) => e.id !== id));
    });

  const testEndpoint = (id: string) =>
    run(`test:${id}`, async () => {
      const result = await call<{ ok: boolean; status: number; error: string | null }>(
        `/api/integrations/webhooks/${id}/test`,
        { method: "POST" }
      );
      if (!result.ok) return setError(result.error);
      if (result.data.ok) setNotice(`Test delivered (HTTP ${result.data.status}).`);
      else setError(`Test failed: ${result.data.error ?? `HTTP ${result.data.status}`}`);
      await load();
    });

  const addKey = (event: React.FormEvent) => {
    event.preventDefault();
    void run("add-key", async () => {
      const result = await call<{ key: ApiKeyView; secret: string }>("/api/integrations/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName }),
      });
      if (!result.ok) return setError(result.error);
      setKeys((list) => [...list, result.data.key]);
      setKeyName("");
      setReveal({
        label: `API key "${result.data.key.name}"`,
        value: result.data.secret,
        hint: "Shown once. Send it as Authorization: Bearer <key> to /api/v1.",
      });
    });
  };

  const revokeKey = (id: string) =>
    run(`revoke:${id}`, async () => {
      const result = await call(`/api/integrations/api-keys/${id}`, { method: "DELETE" });
      if (!result.ok) return setError(result.error);
      setKeys((list) => list.filter((k) => k.id !== id));
    });

  return (
    <section aria-labelledby="settings-integrations" className="space-y-3">
      <div className="px-1">
        <h2 id="settings-integrations" className="section-title">
          Integrations
        </h2>
        <p className="mt-1 text-footnote text-muted">
          Send events to Zapier, Make or n8n, and let them update contacts or start flows.
        </p>
      </div>

      {reveal && <SecretReveal reveal={reveal} onDone={() => setReveal(null)} />}
      {error && (
        <p role="alert" className="px-1 text-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="px-1 text-sm text-success">
          {notice}
        </p>
      )}

      <div className="panel overflow-hidden">
        <p className="px-4 pt-3.5 text-footnote font-semibold text-muted sm:px-5">Webhooks</p>
        {endpoints.length === 0 && (
          <p className="px-4 pb-1 pt-1.5 text-footnote text-muted sm:px-5">No webhooks yet.</p>
        )}
        {endpoints.map((endpoint) => {
          const status = deliveryStatus(endpoint);
          return (
            <div key={endpoint.id} className="space-y-2 border-b border-border px-4 py-3.5 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" title={endpoint.url}>
                    {endpoint.url}
                  </p>
                  <p className={`mt-0.5 truncate text-caption ${status.tone}`}>{status.text}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy === `test:${endpoint.id}`}
                    onClick={() => void testEndpoint(endpoint.id)}
                  >
                    {busy === `test:${endpoint.id}` ? "Sending…" : "Send test"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => void patchEndpoint(endpoint.id, { isActive: !endpoint.isActive })}
                  >
                    {endpoint.isActive ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm text-error"
                    disabled={busy === `delete:${endpoint.id}`}
                    onClick={() => void removeEndpoint(endpoint.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <EventPicker
                value={endpoint.events as WebhookEventType[]}
                onChange={(next) => next.length > 0 && void patchEndpoint(endpoint.id, { events: next })}
              />
            </div>
          );
        })}
        <form onSubmit={addEndpoint} className="space-y-2.5 px-4 py-3.5 sm:px-5">
          <label className="block">
            <span className="sr-only">Webhook URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/…"
              className="field"
              required
            />
          </label>
          <EventPicker value={events} onChange={setEvents} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === "add-endpoint" || events.length === 0}>
            {busy === "add-endpoint" ? "Adding…" : "Add webhook"}
          </button>
        </form>
      </div>

      <div className="panel overflow-hidden">
        <p className="px-4 pt-3.5 text-footnote font-semibold text-muted sm:px-5">API keys</p>
        {keys.length === 0 && <p className="px-4 pt-1.5 text-footnote text-muted sm:px-5">No API keys yet.</p>}
        {keys.map((key) => (
          <div key={key.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
              <p className="truncate text-caption text-muted">
                {key.prefix}… · last used {formatWhen(key.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm shrink-0 text-error"
              disabled={busy === `revoke:${key.id}`}
              onClick={() => void revokeKey(key.id)}
            >
              Revoke
            </button>
          </div>
        ))}
        <form onSubmit={addKey} className="flex gap-2 px-4 py-3.5 sm:px-5">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Key name</span>
            <input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Zapier"
              maxLength={60}
              className="field"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={busy === "add-key"}>
            {busy === "add-key" ? "Creating…" : "Create key"}
          </button>
        </form>
      </div>
    </section>
  );
}
