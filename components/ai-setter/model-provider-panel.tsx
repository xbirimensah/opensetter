"use client";

/**
 * Models: which provider drafts for this account, the local CLIs on this
 * server (no key needed), and the workspace's provider keys. Keys are
 * write-only: the input is never prefilled and the server only ever
 * answers with "saved" plus a short fingerprint.
 */

import { useCallback, useEffect, useState } from "react";
import {
  INPUT_CLASS,
  LABEL_CLASS,
  formatDateTime,
  type SetterConfigForm,
  type UpdateForm,
} from "./form";
import { CliModelPicker, CliReadinessBadge, CliStatusList } from "./cli-provider-section";
import type { CliProviderStatus } from "@/lib/ai-setter/providers/cli-shared";

interface ProviderStatus {
  provider: string;
  label: string;
  configured: boolean;
  keyFingerprint: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  updatedAt: string | null;
  requiresBaseUrl: boolean;
  suggestedModels: string[];
  catalogDefaultModel: string;
  keyHelp: string;
}

interface ProvidersPayload {
  providers: ProviderStatus[];
  cli: CliProviderStatus[];
  encryption: { ready: true } | { ready: false; reason: string; message: string };
  envFallback: { provider: string; model: string; hasKey: boolean; kind: "api" | "cli" };
  canManage: boolean;
}

function ProviderKeyCard({
  status,
  canSave,
  onChanged,
}: {
  status: ProviderStatus;
  canSave: boolean;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status.baseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(status.defaultModel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = `models-${status.provider}`;

  async function save() {
    if (busy || !apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-setter/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: status.provider,
          apiKey,
          baseUrl: baseUrl.trim() || null,
          defaultModel: defaultModel.trim() || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "Could not save the key");
        return;
      }
      setOpen(false);
      await onChanged();
    } catch {
      setError("Could not save the key");
    } finally {
      // The key leaves browser memory as soon as the request is done.
      setApiKey("");
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-setter/providers?provider=${encodeURIComponent(status.provider)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) await onChanged();
      else setError(data.error ?? "Could not remove the key");
    } catch {
      setError("Could not remove the key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{status.label}</p>
          <p className="mt-0.5 text-xs text-muted">
            {status.configured
              ? `Key saved · fingerprint ${status.keyFingerprint} · ${formatDateTime(status.updatedAt)}`
              : "No key saved"}
          </p>
          {status.configured && (status.defaultModel || status.baseUrl) && (
            <p className="mt-0.5 break-all text-xs text-faint">
              {[status.defaultModel, status.baseUrl].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {canSave && (
          <div className="flex shrink-0 gap-2">
            {status.configured && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="min-h-11 rounded-lg px-3 text-xs text-muted hover:text-error disabled:opacity-50 sm:min-h-0 sm:py-1.5"
              >
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
              className="min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:border-border-hover sm:min-h-0 sm:py-1.5"
            >
              {open ? "Cancel" : status.configured ? "Replace key" : "Add key"}
            </button>
          </div>
        )}
      </div>

      {open && canSave && (
        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className={LABEL_CLASS}>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={status.keyHelp}
              className={INPUT_CLASS}
            />
          </label>
          {(status.requiresBaseUrl || status.provider === "openai") && (
            <label className="block">
              <span className={LABEL_CLASS}>
                Base URL{status.requiresBaseUrl ? "" : " (optional)"}
              </span>
              <input
                type="url"
                inputMode="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={INPUT_CLASS}
              />
            </label>
          )}
          <label className="block">
            <span className={LABEL_CLASS}>Default model</span>
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              list={listId}
              placeholder={status.catalogDefaultModel || "model id"}
              className={INPUT_CLASS}
            />
            <datalist id={listId}>
              {status.suggestedModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !apiKey.trim()}
            className="min-h-11 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:w-auto sm:justify-self-start"
          >
            {busy ? "Saving…" : "Save key"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </li>
  );
}

async function fetchProviders(refresh = false): Promise<ProvidersPayload | string> {
  try {
    const res = await fetch(`/api/ai-setter/providers${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    const data = await res.json();
    return data.success ? (data.data as ProvidersPayload) : (data.error ?? "Could not load providers");
  } catch {
    return "Could not load providers";
  }
}

export default function ModelProviderPanel({
  form,
  update,
  saveBar,
}: {
  form: SetterConfigForm;
  update: UpdateForm;
  saveBar: React.ReactNode;
}) {
  const [payload, setPayload] = useState<ProvidersPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshingCli, setRefreshingCli] = useState(false);

  const applyResult = useCallback((result: ProvidersPayload | string) => {
    if (typeof result === "string") {
      setLoadError(result);
    } else {
      setPayload(result);
      setLoadError(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const load = useCallback(async () => {
    applyResult(await fetchProviders());
  }, [applyResult]);

  const refreshCli = useCallback(async () => {
    setRefreshingCli(true);
    try {
      applyResult(await fetchProviders(true));
    } finally {
      setRefreshingCli(false);
    }
  }, [applyResult]);

  if (!payload) {
    return <p className="text-sm text-muted">{loadError ?? "Loading providers…"}</p>;
  }

  const configured = payload.providers.filter((status) => status.configured);
  const selected = configured.find((status) => status.provider === form.llmProvider);
  const cliStatuses = payload.cli ?? [];
  const selectedCli = cliStatuses.find((status) => status.provider === form.llmProvider);
  const encryptionReady = payload.encryption.ready;
  const env = payload.envFallback;
  const envModel = env.model || (env.kind === "cli" ? "CLI default" : "default");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="model-heading">
          <h2 id="model-heading" className="text-sm font-semibold text-foreground">
            Model for this account
          </h2>
          <label className="mt-3 block">
            <span className={LABEL_CLASS}>Provider</span>
            <select
              value={form.llmProvider}
              onChange={(e) => {
                update("llmProvider", e.target.value);
                update("llmModel", "");
              }}
              disabled={!payload.canManage}
              className={`${INPUT_CLASS} disabled:opacity-60`}
            >
              <option value="">
                Server default ({env.provider} · {envModel})
              </option>
              {cliStatuses.some((status) => status.enabled) && (
                <optgroup label="Local CLI (no API key)">
                  {cliStatuses
                    .filter((status) => status.enabled)
                    .map((status) => (
                      <option
                        key={status.provider}
                        value={status.provider}
                        disabled={!status.selectable && status.provider !== form.llmProvider}
                      >
                        {status.label}
                        {status.selectable ? "" : " (not installed)"}
                      </option>
                    ))}
                </optgroup>
              )}
              {configured.length > 0 && (
                <optgroup label="API key (workspace)">
                  {configured.map((status) => (
                    <option key={status.provider} value={status.provider}>
                      {status.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {selectedCli && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <CliReadinessBadge status={selectedCli} />
                <span className="min-w-0 break-words">
                  {selectedCli.problem ??
                    "Runs on this server with its CLI login. No API key is stored for it."}
                </span>
              </div>
              <CliModelPicker
                key={selectedCli.provider}
                status={selectedCli}
                value={form.llmModel}
                onChange={(model) => update("llmModel", model)}
                disabled={!payload.canManage}
              />
            </>
          )}
          {selected && (
            <label className="mt-3 block">
              <span className={LABEL_CLASS}>Model</span>
              <input
                value={form.llmModel}
                onChange={(e) => update("llmModel", e.target.value)}
                disabled={!payload.canManage}
                list="selected-provider-models"
                placeholder={selected.defaultModel || selected.catalogDefaultModel}
                className={INPUT_CLASS}
              />
              <datalist id="selected-provider-models">
                {selected.suggestedModels.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <span className="mt-1 block text-xs text-muted">
                Empty uses the key&apos;s default model. Applies to replies,
                follow-up nudges and personalized campaign openers.
              </span>
            </label>
          )}
          {!payload.canManage && (
            <p className="mt-3 text-xs text-muted">
              Only workspace owners and admins can change the model.
            </p>
          )}
          {form.llmProvider && !selected && !selectedCli && (
            <p className="mt-3 text-xs text-warning">
              The selected provider no longer has a saved key. Pick another
              provider or the server default, then save.
            </p>
          )}
          {!form.llmProvider && !env.hasKey && (
            <p className="mt-3 text-xs text-warning">
              The server default has no API key configured. Add a key below
              and select it, or set the provider env vars.
            </p>
          )}
          <div className="mt-4">{saveBar}</div>
        </section>

        <section
          className={`rounded-xl border p-4 text-sm ${
            encryptionReady ? "border-border bg-surface" : "border-warning/50 bg-warning/10"
          }`}
          aria-labelledby="key-storage-heading"
        >
          <h2 id="key-storage-heading" className="font-semibold text-foreground">
            Key storage
          </h2>
          {payload.encryption.ready ? (
            <p className="mt-1 text-xs text-muted">
              Keys are encrypted on the server (AES-256-GCM) and never shown
              again after saving, not even to admins.
            </p>
          ) : (
            <p className="mt-1 break-words text-xs text-warning">
              Saving keys is disabled: {payload.encryption.message}
            </p>
          )}
        </section>
      </div>

      <div className="min-w-0 space-y-6">
      {cliStatuses.length > 0 && (
        <CliStatusList
          statuses={cliStatuses}
          refreshing={refreshingCli}
          onRefresh={() => void refreshCli()}
        />
      )}

      <section className="min-w-0" aria-labelledby="keys-heading">
        <h2 id="keys-heading" className={LABEL_CLASS}>
          Provider keys (workspace)
        </h2>
        {!payload.canManage && (
          <p className="mt-2 text-xs text-muted">
            Only workspace owners and admins can add or replace keys.
          </p>
        )}
        <ul className="mt-2 space-y-2">
          {payload.providers.map((status) => (
            <ProviderKeyCard
              key={`${status.provider}:${status.updatedAt ?? "none"}`}
              status={status}
              canSave={payload.canManage && encryptionReady}
              onChanged={load}
            />
          ))}
        </ul>
      </section>
      </div>
    </div>
  );
}
