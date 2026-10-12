"use client";

/**
 * AI Setter
 *
 * Per-account control room for the AI DM setter: operating mode, persona
 * and goal, knowledge-base access, safety thresholds, the review queue
 * and activity feed (Setup), the owner's voice (Sprachprofil), and which
 * model provider drafts the replies (Models).
 */

import { useCallback, useEffect, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import AiSetterActivity, {
  type AiReplyItem,
} from "@/components/ai-setter-activity";
import SetupPanel from "@/components/ai-setter/setup-panel";
import VoiceProfilePanel from "@/components/ai-setter/voice-profile-panel";
import ModelProviderPanel from "@/components/ai-setter/model-provider-panel";
import {
  DEFAULT_FORM,
  SaveBar,
  type SetterConfigForm,
} from "@/components/ai-setter/form";

const POLL_MS = 15_000;

type Tab = "setup" | "voice" | "models";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "setup", label: "Setup" },
  { value: "voice", label: "Sprachprofil" },
  { value: "models", label: "Models" },
];

const MODES: Array<{
  value: SetterConfigForm["mode"];
  label: string;
  description: string;
}> = [
  {
    value: "OFF",
    label: "Off",
    description: "Messages are mirrored, nothing is drafted.",
  },
  {
    value: "DRAFT",
    label: "Draft",
    description: "Every reply is drafted and held for your approval.",
  },
  {
    value: "AUTO",
    label: "Autopilot",
    description: "Confident replies send themselves; edge cases wait for you.",
  },
];

export default function AiSetterPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [tab, setTab] = useState<Tab>("setup");

  const [form, setForm] = useState<SetterConfigForm>(DEFAULT_FORM);
  const [defaultVoiceRules, setDefaultVoiceRules] = useState("");
  const [knowledgeBackend, setKnowledgeBackend] = useState<
    "brain-api" | "supabase" | "sqlite" | null
  >(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [replies, setReplies] = useState<AiReplyItem[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(true);

  useEffect(() => {
    fetch("/api/instagram/accounts")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) =>
            prev ||
            payload.data.selectedInstagramAccountId ||
            next[0]?.id ||
            ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    // Intentional reset while the new account's config loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfigLoading(true);
    setSaveState("idle");
    fetch(`/api/ai-setter/config?instagramAccountId=${selectedAccountId}`)
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const config = payload.data.config;
        const builtInRules: string = payload.data.defaultVoiceRules ?? "";
        setKnowledgeBackend(payload.data.knowledgeBackend ?? null);
        setDefaultVoiceRules(builtInRules);
        setForm({
          mode: config.mode,
          persona: config.persona ?? "",
          goal: config.goal ?? "",
          bookingLink: config.bookingLink ?? "",
          language: config.language ?? "",
          knowledgeEnabled: config.knowledgeEnabled,
          styleExamplesEnabled: config.styleExamplesEnabled,
          minConfidence: config.minConfidence,
          replyDelaySeconds: config.replyDelaySeconds,
          pauseOnHumanReply: config.pauseOnHumanReply,
          windowNudgeEnabled: config.windowNudgeEnabled ?? false,
          windowNudgeHours: config.windowNudgeHours ?? 20,
          voiceRules: config.voiceRules ?? builtInRules,
          styleCorpusEnabled: config.styleCorpusEnabled ?? true,
          strictVoiceEvidence: config.strictVoiceEvidence ?? false,
          llmProvider: config.llmProvider ?? "",
          llmModel: config.llmModel ?? "",
        });
      })
      .finally(() => setConfigLoading(false));
  }, [selectedAccountId]);

  const loadReplies = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setRepliesLoading(true);
      try {
        const res = await fetch(
          `/api/ai-setter/replies?instagramAccountId=${selectedAccountId}&limit=60`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (data.success) setReplies(data.data.replies);
      } catch {
        // keep whatever is shown
      } finally {
        if (!silent) setRepliesLoading(false);
      }
    },
    [selectedAccountId]
  );

  useEffect(() => {
    if (!selectedAccountId) return;
    // Initial fetch flips the loading flag synchronously on account
    // change; intentional reset, matching the inbox pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReplies(false);
    const timer = window.setInterval(() => void loadReplies(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadReplies]);

  async function handleSave() {
    if (!selectedAccountId || saving) return;
    setSaving(true);
    setSaveState("idle");
    setSaveError(null);
    try {
      const res = await fetch("/api/ai-setter/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramAccountId: selectedAccountId,
          mode: form.mode,
          persona: form.persona || null,
          goal: form.goal || null,
          bookingLink: form.bookingLink || null,
          language: form.language || null,
          knowledgeEnabled: form.knowledgeEnabled,
          styleExamplesEnabled: form.styleExamplesEnabled,
          minConfidence: form.minConfidence,
          replyDelaySeconds: form.replyDelaySeconds,
          pauseOnHumanReply: form.pauseOnHumanReply,
          windowNudgeEnabled: form.windowNudgeEnabled,
          windowNudgeHours: form.windowNudgeHours,
          blockedUserIds: [],
          voiceRules: form.voiceRules,
          styleCorpusEnabled: form.styleCorpusEnabled,
          strictVoiceEvidence: form.strictVoiceEvidence,
          llmProvider: form.llmProvider || null,
          llmModel: form.llmModel || null,
        }),
      });
      const data = await res.json();
      setSaveState(data.success ? "saved" : "error");
      if (!data.success) setSaveError(data.error ?? null);
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof SetterConfigForm>(
    key: K,
    value: SetterConfigForm[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveState("idle");
  }

  const held = replies.filter((r) => r.status === "HELD");
  const recent = replies.filter((r) => r.status !== "HELD").slice(0, 25);

  const saveBar = (
    <SaveBar
      saving={saving}
      saveState={saveState}
      errorMessage={saveError}
      disabled={!selectedAccountId || configLoading}
      onSave={() => void handleSave()}
    />
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm text-muted">
          An AI that answers your DMs in your voice, qualifies prospects,
          and books the right ones.
        </p>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
            hideLabel
          />
        )}
      </div>

      {/* Mode: the one decision that changes what the setter does. */}
      <section aria-labelledby="setter-mode">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
          <h2 id="setter-mode" className="section-title">
            Mode
          </h2>
          <p className="hidden text-caption text-faint sm:block">Changes apply after saving</p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {MODES.map((mode) => {
            const isActive = form.mode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => update("mode", mode.value)}
                aria-pressed={isActive}
                className={`press flex min-h-11 min-w-0 flex-col justify-start rounded-2xl border px-3 py-3 text-left sm:px-4 sm:py-4 ${
                  isActive
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-border-hover hover:bg-surface-hover"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={`block text-headline font-semibold ${
                      isActive ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {mode.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`hidden h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px] sm:inline-flex ${
                      isActive ? "border-accent bg-accent" : "border-border-hover"
                    }`}
                  >
                    {isActive && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                </span>
                <span className="mt-1 hidden text-footnote leading-snug text-muted sm:block">
                  {mode.description}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-footnote text-muted sm:hidden">
          {MODES.find((mode) => mode.value === form.mode)?.description}{" "}
          Changes apply after saving.
        </p>
      </section>

      {/* Segmented control; scrolls sideways on narrow screens instead of wrapping. */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
        <div
          role="tablist"
          aria-label="AI Setter sections"
          className="inline-flex gap-0.5 rounded-full bg-fill p-1"
        >
          {TABS.map((item) => {
            const isActive = tab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`tab-${item.value}`}
                aria-selected={isActive}
                aria-controls={`panel-${item.value}`}
                onClick={() => setTab(item.value)}
                className={`press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm ${
                  isActive
                    ? "bg-segment font-semibold text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.18)]"
                    : "font-medium text-muted hover:text-foreground"
                }`}
              >
                {item.label}
                {item.value === "setup" && held.length > 0 && (
                  <span className="rounded-full bg-warning/15 px-1.5 py-px text-caption font-semibold tabular-nums text-warning">
                    {held.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {configLoading ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]" aria-busy="true">
            <div className="space-y-4">
              <div className="skeleton h-4 w-28" />
              <div className="panel h-28" />
              <div className="panel h-16" />
              <div className="panel h-48" />
            </div>
            <div className="panel h-64" />
          </div>
        ) : tab === "setup" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
            {/* On phones the review queue comes first: it is what needs a thumb. */}
            <div className="order-2 min-w-0 lg:order-1">
              <SetupPanel
                form={form}
                update={update}
                knowledgeBackend={knowledgeBackend}
                saveBar={saveBar}
              />
            </div>
            <div className="order-1 min-w-0 lg:order-2">
              <AiSetterActivity
                held={held}
                recent={recent}
                loading={repliesLoading}
                onRefresh={() => void loadReplies(true)}
              />
            </div>
          </div>
        ) : tab === "voice" ? (
          selectedAccountId && (
            <VoiceProfilePanel
              accountId={selectedAccountId}
              form={form}
              update={update}
              defaultVoiceRules={defaultVoiceRules}
              saveBar={saveBar}
            />
          )
        ) : (
          <ModelProviderPanel form={form} update={update} saveBar={saveBar} />
        )}
      </div>
    </div>
  );
}
