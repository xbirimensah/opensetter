"use client";

/**
 * Sprachprofil: the owner's voice rules, how the setter uses their own
 * past DMs, and per-contact corrections.
 */

import StyleCorpusCard from "./style-corpus-card";
import VoiceCorrectionsCard from "./voice-corrections-card";
import {
  INPUT_CLASS,
  LABEL_CLASS,
  Toggle,
  type SetterConfigForm,
  type UpdateForm,
} from "./form";

const MAX_VOICE_RULES_CHARS = 6000;

export default function VoiceProfilePanel({
  accountId,
  form,
  update,
  defaultVoiceRules,
  saveBar,
}: {
  accountId: string;
  form: SetterConfigForm;
  update: UpdateForm;
  defaultVoiceRules: string;
  saveBar: React.ReactNode;
}) {
  const isDefault = form.voiceRules.trim() === defaultVoiceRules.trim();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="rules-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="rules-heading" className="text-sm font-semibold text-foreground">
              Voice rules
            </h2>
            <span className="text-[11px] tabular-nums text-faint">
              {form.voiceRules.length}/{MAX_VOICE_RULES_CHARS}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            How you text, one rule per line. Every draft follows these. Safety
            rules (no AI disclosure, no promises on price or dates, review for
            sensitive topics) always apply on top and cannot be edited away.
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Voice rules</span>
            <textarea
              value={form.voiceRules}
              onChange={(e) => update("voiceRules", e.target.value)}
              rows={10}
              maxLength={MAX_VOICE_RULES_CHARS}
              className={`${INPUT_CLASS} resize-y font-mono leading-relaxed`}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted">
              {isDefault ? "Using the built-in rules." : "Custom rules."}
            </span>
            {!isDefault && (
              <button
                type="button"
                onClick={() => update("voiceRules", defaultVoiceRules)}
                className="min-h-11 rounded-lg px-3 text-xs text-muted hover:bg-surface-hover hover:text-foreground sm:min-h-0 sm:py-1"
              >
                Reset to built-in rules
              </button>
            )}
          </div>
        </section>

        <div className="space-y-3">
          <span className={LABEL_CLASS}>Voice sources</span>
          <Toggle
            checked={form.styleCorpusEnabled}
            onChange={(v) => update("styleCorpusEnabled", v)}
            label="Learn from my past DMs"
            hint="Show the setter a few of your own hand-typed replies to similar messages, in the chat's language."
          />
          <Toggle
            checked={form.strictVoiceEvidence}
            onChange={(v) => update("strictVoiceEvidence", v)}
            label="Autopilot only where I've written myself"
            hint="Strict mode: in chats where you never typed a message by hand, drafts are held for review instead of sent."
          />
        </div>

        {saveBar}
      </div>

      <div className="min-w-0 space-y-4">
        <StyleCorpusCard accountId={accountId} />
        <VoiceCorrectionsCard accountId={accountId} />
      </div>
    </div>
  );
}
