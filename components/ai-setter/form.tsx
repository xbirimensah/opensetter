"use client";

/**
 * Shared form state and small controls for the AI Setter screens.
 */

export interface SetterConfigForm {
  mode: "OFF" | "DRAFT" | "AUTO";
  persona: string;
  goal: string;
  bookingLink: string;
  language: string;
  knowledgeEnabled: boolean;
  styleExamplesEnabled: boolean;
  minConfidence: number;
  replyDelaySeconds: number;
  pauseOnHumanReply: boolean;
  windowNudgeEnabled: boolean;
  windowNudgeHours: number;
  /** Sprachprofil voice rules as edited (default guide when untouched). */
  voiceRules: string;
  styleCorpusEnabled: boolean;
  strictVoiceEvidence: boolean;
  /** "" = server default (env-based provider). */
  llmProvider: string;
  llmModel: string;
}

export const DEFAULT_FORM: SetterConfigForm = {
  mode: "OFF",
  persona: "",
  goal: "",
  bookingLink: "",
  language: "",
  knowledgeEnabled: true,
  styleExamplesEnabled: true,
  minConfidence: 0.78,
  replyDelaySeconds: 10,
  pauseOnHumanReply: true,
  windowNudgeEnabled: false,
  windowNudgeHours: 20,
  voiceRules: "",
  styleCorpusEnabled: true,
  strictVoiceEvidence: false,
  llmProvider: "",
  llmModel: "",
};

export type UpdateForm = <K extends keyof SetterConfigForm>(
  key: K,
  value: SetterConfigForm[K]
) => void;

/** Shared input styling: 16px text on phones so iOS does not zoom in. */
export const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-faint focus:border-accent/40 focus:outline-none sm:py-2 sm:text-sm";

export const LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-faint";

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-start justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:border-border-hover disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
      <span
        className={`mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent" : "bg-surface-hover"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

export function SaveBar({
  saving,
  saveState,
  errorMessage,
  disabled,
  onSave,
}: {
  saving: boolean;
  saveState: "idle" | "saved" | "error";
  errorMessage: string | null;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="min-h-11 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:w-auto"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
      {saveState === "saved" && <span className="text-sm text-success">Saved.</span>}
      {saveState === "error" && (
        <span className="text-sm text-error">
          {errorMessage ?? "Could not save, try again."}
        </span>
      )}
    </div>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
