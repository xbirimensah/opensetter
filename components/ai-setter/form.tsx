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

/** Shared input styling (see .field in globals.css): 16px text on phones so iOS does not zoom in. */
export const INPUT_CLASS = "field mt-1.5";

/** Form label: sentence case, one step under body. */
export const LABEL_CLASS = "field-label";

/**
 * Settings-style list of switches: one card, rows separated by inset
 * hairlines, so related options read as one group.
 */
export function ToggleGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel overflow-hidden [&>*+*]:border-t [&>*+*]:border-border">
      {children}
    </div>
  );
}

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
      className="flex min-h-14 w-full items-start justify-between gap-4 bg-surface px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-hover active:bg-surface-hover disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-footnote leading-snug text-muted">{hint}</span>
      </span>
      {/* 51x31 track like a system switch, scaled to the row. */}
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
          checked ? "bg-accent" : "bg-fill-strong"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-300 ease-spring ${
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
        className="btn btn-primary w-full sm:w-auto"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
      <span role="status" aria-live="polite" className="text-footnote">
        {saveState === "saved" && <span className="text-success">Saved.</span>}
        {saveState === "error" && (
          <span className="text-error">{errorMessage ?? "Could not save, try again."}</span>
        )}
      </span>
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
