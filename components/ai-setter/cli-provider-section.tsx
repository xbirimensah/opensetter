"use client";

/**
 * Local CLI providers in the Models tab: the readiness list (installed,
 * signed in, models the CLI exposes) and the model picker used when a
 * CLI is the account's provider. Only discovered models and documented
 * aliases are offered; anything else goes in as a custom model id.
 */

import { useState } from "react";
import {
  describeCliReadiness,
  isValidCliModelId,
  type CliProviderStatus,
  type CliReadinessTone,
} from "@/lib/ai-setter/providers/cli-shared";
import { INPUT_CLASS, LABEL_CLASS, formatDateTime } from "./form";

const TONE_CLASSES: Record<CliReadinessTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  neutral: "bg-fill-strong text-muted",
};

const CUSTOM = "__custom__";

const MODEL_SOURCE_NOTE: Record<CliProviderStatus["provider"], string> = {
  "claude-cli":
    "Aliases documented by `claude --help`; each always runs the newest model of that family. Use a custom id (e.g. claude-sonnet-5-5) to pin one.",
  "codex-cli": "Models listed by `codex debug models` on this server.",
};

export function CliReadinessBadge({ status }: { status: CliProviderStatus }) {
  const readiness = describeCliReadiness(status);
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-caption font-medium ${TONE_CLASSES[readiness.tone]}`}>
      {readiness.label}
    </span>
  );
}

export function CliModelPicker({
  status,
  value,
  onChange,
  disabled,
}: {
  status: CliProviderStatus;
  value: string;
  onChange: (model: string) => void;
  disabled: boolean;
}) {
  const listed = status.models.some((model) => model.id === value);
  const [custom, setCustom] = useState(value !== "" && !listed);
  const selectValue = custom ? CUSTOM : value;
  const invalid = custom && value !== "" && !isValidCliModelId(value);
  const selectId = `cli-model-${status.provider}`;

  return (
    <div className="mt-3">
      <label htmlFor={selectId} className={LABEL_CLASS}>
        Model
      </label>
      <select
        id={selectId}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          setCustom(next === CUSTOM);
          onChange(next === CUSTOM ? "" : next);
        }}
        disabled={disabled}
        className={`${INPUT_CLASS} disabled:opacity-60`}
      >
        <option value="">CLI default (whatever the CLI is set to use)</option>
        {status.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.source === "alias"
              ? `${model.id} · alias for the latest`
              : model.label === model.id
                ? model.id
                : `${model.label} (${model.id})`}
          </option>
        ))}
        <option value={CUSTOM}>Custom model id…</option>
      </select>
      {custom && (
        <label className="mt-2 block">
          <span className="sr-only">Custom model id</span>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={status.provider === "claude-cli" ? "claude-sonnet-5-5" : "model id"}
            aria-invalid={invalid}
            className={`${INPUT_CLASS} disabled:opacity-60`}
          />
        </label>
      )}
      {invalid && (
        <p className="mt-1 text-footnote text-error">
          Use letters, digits and . _ : / @ [ ] - only, starting with a letter or digit.
        </p>
      )}
      <span className="mt-1 block text-footnote text-muted">
        {status.models.length > 0
          ? MODEL_SOURCE_NOTE[status.provider]
          : "This CLI reported no models; the CLI default or a custom id still works."}{" "}
        Applies to replies, follow-up nudges and personalized campaign openers.
      </span>
    </div>
  );
}

export function CliStatusList({
  statuses,
  refreshing,
  onRefresh,
}: {
  statuses: CliProviderStatus[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const checkedAt = statuses[0]?.checkedAt ?? null;
  return (
    <section className="min-w-0" aria-labelledby="cli-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cli-heading" className="section-title">
          Local CLIs (this server, no API key)
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="btn btn-quiet btn-sm"
        >
          {refreshing ? "Checking…" : "Check again"}
        </button>
      </div>
      <ul className="mt-2 space-y-2">
        {statuses.map((status) => (
          <li key={status.provider} className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{status.label}</p>
                <p className="mt-0.5 break-words text-footnote text-muted">
                  {[
                    status.version,
                    status.auth.state === "ready" ? status.auth.detail : null,
                    status.installed
                      ? `${status.models.length} model option${status.models.length === 1 ? "" : "s"} discovered`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Not available"}
                </p>
              </div>
              <CliReadinessBadge status={status} />
            </div>
            {status.problem && <p className="mt-2 break-words text-footnote text-warning">{status.problem}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-footnote text-faint">
        Runs under the server user&apos;s own CLI login and subscription.
        {checkedAt ? ` Checked ${formatDateTime(checkedAt)}.` : ""}
      </p>
    </section>
  );
}
