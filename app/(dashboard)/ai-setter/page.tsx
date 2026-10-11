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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="hidden text-lg font-semibold text-foreground sm:block">
            AI Setter
          </h1>
          <p className="text-sm text-muted sm:mt-1">
            An AI that answers your DMs in your voice, qualifies prospects,
            and books the right ones.
          </p>
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            includeAll={false}
          />
        )}
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {MODES.map((mode) => {
          const isActive = form.mode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => update("mode", mode.value)}
              aria-pressed={isActive}
              className={`min-h-11 min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors sm:px-4 sm:py-3 ${
                isActive
                  ? "border-accent/60 bg-accent/10"
                  : "border-border bg-surface hover:border-border-hover"
              }`}
            >
              <span
                className={`block text-sm font-medium ${
                  isActive ? "text-accent" : "text-foreground"
                }`}
              >
                {mode.label}
              </span>
              <span className="mt-1 hidden text-xs text-muted sm:block">
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>
      <p className="-mt-3 text-xs text-muted sm:hidden">
        {MODES.find((mode) => mode.value === form.mode)?.description}{" "}
        Changes apply after saving.
      </p>

      {/* Tabs scroll sideways on narrow screens instead of wrapping. */}
      <div
        role="tablist"
        aria-label="AI Setter sections"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0"
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
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm ${
                isActive
                  ? "border-accent font-medium text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {item.label}
              {item.value === "setup" && held.length > 0 && (
                <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  {held.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {configLoading ? (
          <p className="text-sm text-muted">Loading configuration…</p>
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
