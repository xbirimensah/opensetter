"use client";

/**
 * AI Setter setup: persona, goal, knowledge access, safety thresholds.
 * Moved out of the page unchanged apart from mobile sizing.
 */

import {
  INPUT_CLASS,
  LABEL_CLASS,
  Toggle,
  type SetterConfigForm,
  type UpdateForm,
} from "./form";

export default function SetupPanel({
  form,
  update,
  knowledgeBackend,
  saveBar,
}: {
  form: SetterConfigForm;
  update: UpdateForm;
  knowledgeBackend: "supabase" | "sqlite" | null;
  saveBar: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className={LABEL_CLASS}>Who you are</span>
        <textarea
          value={form.persona}
          onChange={(e) => update("persona", e.target.value)}
          rows={4}
          placeholder="Your positioning, offer, audience, and how you talk. The setter grounds every reply in this."
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      <label className="block">
        <span className={LABEL_CLASS}>Setter goal</span>
        <textarea
          value={form.goal}
          onChange={(e) => update("goal", e.target.value)}
          rows={2}
          placeholder="e.g. Qualify for the mentorship (already running a business, 2k+ budget) and book a call."
          className={`${INPUT_CLASS} resize-y`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLASS}>Booking link</span>
          <input
            value={form.bookingLink}
            onChange={(e) => update("bookingLink", e.target.value)}
            placeholder="https://cal.com/you/call"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Reply language</span>
          <select
            value={form.language}
            onChange={(e) => update("language", e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Match the incoming message</option>
            <option value="German">Always German</option>
            <option value="English">Always English</option>
          </select>
        </label>
      </div>

      <Toggle
        checked={form.knowledgeEnabled}
        onChange={(v) => update("knowledgeEnabled", v)}
        label="Second brain"
        hint={
          knowledgeBackend === "supabase"
            ? "Pull facts about you and your offer from your connected Supabase knowledge base."
            : knowledgeBackend === "sqlite"
              ? "Pull facts about you and your offer from your local knowledge base file."
              : "No knowledge base yet. Create one in 2 minutes: drop markdown files about you and your offer into ./knowledge on the server, then run: npm run knowledge:ingest -- ./knowledge (or connect Supabase, see docs/ai-setter.md)."
        }
      />
      <Toggle
        checked={form.styleExamplesEnabled}
        onChange={(v) => update("styleExamplesEnabled", v)}
        label="Style memory"
        hint="Imitate phrasing from your indexed message history, so replies sound like you texted them."
      />
      <Toggle
        checked={form.pauseOnHumanReply}
        onChange={(v) => update("pauseOnHumanReply", v)}
        label="Step aside for humans"
        hint="When you reply to a thread yourself, the setter stays out of it for a few hours."
      />
      <Toggle
        checked={form.windowNudgeEnabled}
        onChange={(v) => update("windowNudgeEnabled", v)}
        label="Follow-up nudge"
        hint={`If a prospect goes quiet, send one gentle follow-up after ${form.windowNudgeHours}h, before Instagram's 24h reply window closes. Draft mode holds it for review.`}
      />
      {form.windowNudgeEnabled && (
        <label className="block">
          <span className={LABEL_CLASS}>Nudge after (hours of silence)</span>
          <input
            type="number"
            min={1}
            max={23}
            value={form.windowNudgeHours}
            onChange={(e) =>
              update(
                "windowNudgeHours",
                Math.max(1, Math.min(23, Math.trunc(Number(e.target.value) || 20)))
              )
            }
            className={INPUT_CLASS}
          />
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-faint">
            Confidence to auto-send
            <span className="tabular-nums text-muted">
              {Math.round(form.minConfidence * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={0.5}
            max={0.95}
            step={0.01}
            value={form.minConfidence}
            onChange={(e) =>
              update("minConfidence", Number(e.target.value))
            }
            className="mt-3 h-11 w-full accent-[--color-accent] sm:h-auto"
          />
          <span className="mt-1 block text-xs text-muted">
            Below this the reply is held for review instead of sent.
          </span>
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Reply delay (seconds)</span>
          <input
            type="number"
            min={0}
            max={600}
            value={form.replyDelaySeconds}
            onChange={(e) =>
              update(
                "replyDelaySeconds",
                Math.max(0, Math.min(600, Number(e.target.value) || 0))
              )
            }
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-muted">
            Lets rapid-fire messages collapse into one reply.
          </span>
        </label>
      </div>

      {saveBar}
    </div>
  );
}
