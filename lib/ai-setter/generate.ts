/**
 * Draft generation: retrieval, prompt assembly, model call, parsing.
 */

import { completeSetterPrompt } from "./llm";
import { fetchKnowledgeContext, fetchStyleExamples } from "./knowledge";
import { fetchCorpusStyleExamples } from "./style-corpus";
import {
  findOffLanguageFillers,
  isReplyLanguageCompatible,
  type ChatLanguage,
} from "./language";
import { requireSelection, resolveLlmTarget, type LlmSelection } from "./providers/resolve";
import { isOperatorWorkspace } from "./operator";
import { containsSecretMaterial, redactSecretValues } from "./secret-guard";
import type { DraftReply as GuardedDraft } from "./types";

/** A draft carrying secret material is redacted and always held for review. */
function guardSecrets(draft: GuardedDraft): GuardedDraft {
  if (!containsSecretMaterial(draft.reply)) return draft;
  return {
    ...draft,
    reply: redactSecretValues(draft.reply),
    shouldSend: false,
    needsReview: true,
    reasons: [...draft.reasons, "draft contained secret-looking material and was redacted"],
  };
}
import {
  buildNudgeUserPrompt,
  buildSetterSystemPrompt,
  buildSetterUserPrompt,
} from "./prompt";
import type { DraftReply, SetterPromptContext } from "./types";

/**
 * Tolerant JSON extraction: slice from the first "{" to the last "}"
 * so chatty providers still parse. Every default fails safe toward
 * human review.
 */
export function extractDraftReply(raw: string): DraftReply {
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;

  let parsed: Partial<DraftReply> & { should_send?: boolean; needs_review?: boolean };
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return {
      reply: "",
      confidence: 0,
      shouldSend: false,
      needsReview: true,
      reasons: ["model output was not valid JSON"],
    };
  }

  const confidence = Number(parsed.confidence ?? 0);
  return {
    reply: String(parsed.reply ?? "").trim(),
    confidence: Number.isFinite(confidence) ? confidence : 0,
    shouldSend: Boolean(parsed.should_send ?? parsed.shouldSend),
    needsReview: Boolean(parsed.needs_review ?? parsed.needsReview ?? true),
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map((value) => String(value))
      : [],
  };
}

/**
 * A draft in the wrong language is never auto-sent: force review and
 * say why. Unchanged drafts are returned as-is.
 */
export function enforceDraftLanguage(
  draft: DraftReply,
  chatLanguage: ChatLanguage
): DraftReply {
  if (isReplyLanguageCompatible(draft.reply, chatLanguage)) return draft;
  const reason =
    findOffLanguageFillers(draft.reply, chatLanguage).length > 0
      ? "off_language_filler"
      : "off_language_draft";
  return {
    ...draft,
    shouldSend: false,
    needsReview: true,
    reasons: [...new Set([...draft.reasons, reason])],
  };
}

export interface GenerateDraftParams {
  incomingText: string;
  participantUsername?: string | null;
  history: SetterPromptContext["history"];
  humanStyleAnchor: string[];
  /** Rendered contact-scoped corrections for this chat. */
  voiceCorrections?: string[];
  /** Resolved chat language; drives the prompt and the language guard. */
  chatLanguage?: ChatLanguage;
  config: {
    persona?: string | null;
    goal?: string | null;
    bookingLink?: string | null;
    language?: string | null;
    knowledgeEnabled: boolean;
    styleExamplesEnabled: boolean;
    minConfidence: number;
    /** Owner-edited voice rules (Sprachprofil). */
    voiceRules?: string | null;
    /** Pull examples from the local style corpus of this account. */
    styleCorpusEnabled?: boolean;
    instagramAccountId?: string;
    /** UI-selected model provider; absent/empty uses the env provider. */
    llmSelection?: LlmSelection;
  };
}

async function loadCorpusExamples(
  config: GenerateDraftParams["config"],
  incomingText: string,
  language: ChatLanguage
): Promise<string> {
  if (!config.styleCorpusEnabled || !config.instagramAccountId) return "";
  return fetchCorpusStyleExamples({
    instagramAccountId: config.instagramAccountId,
    incomingText,
    language,
  }).catch((error: unknown) => {
    console.error("[ai-setter] style corpus lookup failed:", error);
    return "";
  });
}

/**
 * Retrieval query built from the thread's recent turns, not just the
 * newest message: "wie viel kostet das?" alone retrieves nothing, but
 * with the last few messages it lands on the right offer facts.
 */
function buildKnowledgeQuery(
  history: SetterPromptContext["history"],
  incomingText: string | null,
  participantUsername?: string | null
): string {
  const recentTurns = history
    .slice(-6)
    .map((message) => message.text.replace(/\s+/g, " ").slice(0, 160));
  return [participantUsername, ...recentTurns, incomingText]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
}

export async function generateSetterDraft(
  params: GenerateDraftParams
): Promise<DraftReply> {
  const knowledgeQuery = buildKnowledgeQuery(
    params.history,
    params.incomingText,
    params.participantUsername
  );

  const chatLanguage = params.chatLanguage ?? "unknown";
  // Resolve the provider first: a misconfigured selection fails the job
  // before any retrieval work is spent.
  const target = await resolveLlmTarget(requireSelection(params.config.llmSelection));

  const knowledgeAllowed =
    params.config.knowledgeEnabled && (await isOperatorWorkspace(params.config.llmSelection?.workspaceId));
  const [knowledgeContext, styleExamples, corpusExamples] = await Promise.all([
    knowledgeAllowed
      ? fetchKnowledgeContext(knowledgeQuery).catch(() => "")
      : Promise.resolve(""),
    params.config.styleExamplesEnabled
      ? fetchStyleExamples(params.incomingText).catch(() => "")
      : Promise.resolve(""),
    loadCorpusExamples(params.config, params.incomingText, chatLanguage),
  ]);

  const context: SetterPromptContext = {
    incomingText: params.incomingText,
    participantUsername: params.participantUsername,
    history: params.history,
    humanStyleAnchor: params.humanStyleAnchor,
    knowledgeContext,
    styleExamples,
    corpusExamples,
    voiceCorrections: params.voiceCorrections ?? [],
    targetLanguage: chatLanguage,
    persona: params.config.persona,
    goal: params.config.goal,
    bookingLink: params.config.bookingLink,
    language: params.config.language,
    minConfidence: params.config.minConfidence,
  };

  const system = buildSetterSystemPrompt(params.config);
  const userPrompt = buildSetterUserPrompt(context);
  const raw = await completeSetterPrompt(system, userPrompt, target);
  return guardSecrets(enforceDraftLanguage(extractDraftReply(raw), chatLanguage));
}

/**
 * Draft a quiet-prospect nudge. Same persona, goal, and output contract
 * as a normal reply; the "incoming message" is replaced by the situation.
 */
export async function generateWindowNudge(params: {
  participantUsername?: string | null;
  history: SetterPromptContext["history"];
  humanStyleAnchor: string[];
  voiceCorrections?: string[];
  chatLanguage?: ChatLanguage;
  quietHours: number;
  config: GenerateDraftParams["config"];
}): Promise<DraftReply> {
  const chatLanguage = params.chatLanguage ?? "unknown";
  const target = await resolveLlmTarget(requireSelection(params.config.llmSelection));
  const knowledgeAllowed =
    params.config.knowledgeEnabled && (await isOperatorWorkspace(params.config.llmSelection?.workspaceId));
  const knowledgeContext = knowledgeAllowed
    ? await fetchKnowledgeContext(
        buildKnowledgeQuery(params.history, null, params.participantUsername)
      ).catch(() => "")
    : "";

  const context: Omit<SetterPromptContext, "incomingText"> = {
    participantUsername: params.participantUsername,
    history: params.history,
    humanStyleAnchor: params.humanStyleAnchor,
    knowledgeContext,
    styleExamples: "",
    voiceCorrections: params.voiceCorrections ?? [],
    targetLanguage: chatLanguage,
    persona: params.config.persona,
    goal: params.config.goal,
    bookingLink: params.config.bookingLink,
    language: params.config.language,
    minConfidence: params.config.minConfidence,
  };

  const system = buildSetterSystemPrompt(params.config);
  const userPrompt = buildNudgeUserPrompt(context, params.quietHours);
  const raw = await completeSetterPrompt(system, userPrompt, target);
  return guardSecrets(enforceDraftLanguage(extractDraftReply(raw), chatLanguage));
}
