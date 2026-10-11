/**
 * Second-brain retrieval for the AI setter.
 *
 * Backend is chosen by SECOND_BRAIN_BACKEND (brain-api | supabase |
 * sqlite). Unset keeps auto-detect: Supabase when its credentials are
 * set, else the local SQLite file. brain-api talks to a self-hosted second-brain
 * brain REST API (see brain-api.ts), which embeds queries server-side.
 *
 * The Supabase backend talks straight to PostgREST:
 *  - a hybrid-search RPC (semantic + full-text over knowledge chunks)
 *  - a style-search RPC (isolated index of the operator's own reply
 *    style); only the operator's outbound text is used, redacted again
 *    here, and the prospect message it answered is never rendered
 *
 * Object names default to the schema shipped in schema/knowledge-base.sql
 * and can be overridden per deployment (SECOND_BRAIN_*_RPC vars) to point
 * at an existing knowledge base.
 *
 * Query embeddings come from the same local model the brain indexes with
 * (paraphrase-multilingual-MiniLM-L12-v2, 384 dims, symmetric so no
 * query prefix). If the embedding model is unavailable the knowledge
 * lookup falls back to plain full-text search and style examples are
 * skipped. Every path fails open: retrieval trouble must never block a
 * reply, it just makes it less informed. Because failing open is silent,
 * every error and every empty result is logged loudly (retrieval-log.ts).
 */

import { hasAutomationMarker, normalizeForMatch } from "./authorship";
import {
  fetchBrainHealth,
  readBrainApiConfig,
  searchBrainKnowledge,
  searchBrainStyle,
  type BrainApiConfig,
  type BrainApiConfigProblem,
} from "./brain-api";
import {
  fetchLocalKnowledgeContext,
  isLocalKnowledgeAvailable,
} from "./knowledge-local";
import {
  describeError,
  logRetrievalConfigError,
  logRetrievalEmpty,
  logRetrievalError,
  logRetrievalHealth,
  type RetrievalKind,
} from "./retrieval-log";
import { redactCorpusText } from "./style-corpus-core";

const RPC_TIMEOUT_MS = 30_000;
const MAX_KNOWLEDGE_ITEMS = 5;
const MAX_KNOWLEDGE_CHARS = 3000;
/**
 * Brain API context per hit. About one old Supabase chunk (~1k chars), so
 * 2-3 hits fit MAX_KNOWLEDGE_CHARS instead of one 2000-char default
 * crowding out the rest.
 */
const KNOWLEDGE_TEXT_CHARS = 1000;
const MAX_STYLE_EXAMPLES = 4;
const MAX_STYLE_EXAMPLE_CHARS = 180;
/** Over-fetch (the RPC caps at 6) since unsafe rows are dropped client-side. */
const STYLE_CANDIDATES = 6;
const EMBEDDING_DIMENSIONS = 384;

const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

function hybridSearchRpc(): string {
  return process.env.SECOND_BRAIN_HYBRID_SEARCH_RPC ?? "opensetter_hybrid_search";
}

function styleSearchRpc(): string {
  return process.env.SECOND_BRAIN_STYLE_SEARCH_RPC ?? "opensetter_style_search";
}

function documentsTable(): string {
  return process.env.SECOND_BRAIN_DOCUMENTS_TABLE ?? "opensetter_documents";
}

interface SecondBrainCredentials {
  url: string;
  serviceRoleKey: string;
}

function readCredentials(): SecondBrainCredentials | null {
  const url = process.env.SECOND_BRAIN_SUPABASE_URL;
  const serviceRoleKey = process.env.SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/$/, ""), serviceRoleKey };
}

export type KnowledgeBackend = "brain-api" | "supabase" | "sqlite" | null;

const SELECTABLE_BACKENDS = new Set(["brain-api", "supabase", "sqlite"]);
let reportedUnknownBackend: string | null = null;

/** Explicit SECOND_BRAIN_BACKEND choice, or null for auto-detect. */
function selectedBackend(): string | null {
  const raw = process.env.SECOND_BRAIN_BACKEND?.trim().toLowerCase();
  if (!raw) return null;
  if (SELECTABLE_BACKENDS.has(raw)) return raw;
  if (reportedUnknownBackend !== raw) {
    reportedUnknownBackend = raw;
    logRetrievalConfigError(
      `unknown SECOND_BRAIN_BACKEND=${raw.slice(0, 40)}; using auto-detect`
    );
  }
  return null;
}

export function getKnowledgeBackend(): KnowledgeBackend {
  const selected = selectedBackend();
  if (selected === "brain-api") return "brain-api";
  if (selected === "supabase") return readCredentials() ? "supabase" : null;
  if (selected === "sqlite") return isLocalKnowledgeAvailable() ? "sqlite" : null;
  if (readCredentials()) return "supabase";
  if (isLocalKnowledgeAvailable()) return "sqlite";
  return null;
}

export function isSecondBrainConfigured(): boolean {
  return getKnowledgeBackend() !== null;
}

// ─── Embeddings ─────────────────────────────────────────────────────────────

type EmbedFunction = (text: string) => Promise<number[]>;

let embedderPromise: Promise<EmbedFunction | null> | null = null;

async function loadEmbedder(): Promise<EmbedFunction | null> {
  if (process.env.AI_SETTER_EMBEDDINGS === "off") return null;
  try {
    const { pipeline } = await import("@huggingface/transformers");
    const model =
      process.env.SECOND_BRAIN_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    const extractor = await pipeline("feature-extraction", model);
    return async (text: string) => {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data as Float32Array);
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `embedding has ${vector.length} dims, expected ${EMBEDDING_DIMENSIONS}`
        );
      }
      return vector;
    };
  } catch (error: unknown) {
    console.error("[ai-setter] embedding model unavailable:", error);
    return null;
  }
}

async function embedQuery(text: string): Promise<number[] | null> {
  if (!embedderPromise) embedderPromise = loadEmbedder();
  const embed = await embedderPromise;
  if (!embed) return null;
  try {
    return await embed(text);
  } catch (error: unknown) {
    console.error("[ai-setter] embedding failed:", error);
    return null;
  }
}

/** A missing embedding is only an error when embeddings were not switched off. */
function reportMissingEmbedding(backend: string, kind: RetrievalKind): void {
  if (process.env.AI_SETTER_EMBEDDINGS === "off") return;
  logRetrievalError(backend, kind, "embedder-unavailable");
}

/**
 * Run one rendered lookup, logging errors and empty results loudly.
 * Fails open to "" exactly like the unguarded paths did.
 */
async function guardedLookup(
  backend: string,
  kind: RetrievalKind,
  lookup: () => Promise<string>
): Promise<string> {
  try {
    const rendered = await lookup();
    if (!rendered) logRetrievalEmpty(backend, kind);
    return rendered;
  } catch (error: unknown) {
    logRetrievalError(backend, kind, describeError(error));
    return "";
  }
}

function describeConfigProblem(problem: BrainApiConfigProblem): string {
  if (problem.reason === "insecure-url") {
    return `insecure-url host=${problem.host}`;
  }
  if (problem.reason === "token_file_permissions") {
    return `token_file_permissions path=${problem.path}`;
  }
  return "missing-token";
}

/**
 * Brain API config for one lookup, or null after logging why not. An
 * unsafe BRAIN_API_URL is a CONFIG_ERROR (the token is never sent);
 * token trouble is a RETRIEVAL_ERROR. Both fail open.
 */
function brainConfigOrLog(kind: RetrievalKind): BrainApiConfig | null {
  const result = readBrainApiConfig();
  if (result.ok) return result.config;
  if (result.reason === "insecure-url") {
    logRetrievalConfigError(
      `BRAIN_API_URL must be loopback http or https; refusing host=${result.host}`
    );
  } else {
    logRetrievalError("brain-api", kind, describeConfigProblem(result));
  }
  return null;
}

// ─── Supabase REST helpers ──────────────────────────────────────────────────

async function callRpc(
  credentials: SecondBrainCredentials,
  fn: string,
  body: Record<string, unknown>
): Promise<unknown[]> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: credentials.serviceRoleKey,
      Authorization: `Bearer ${credentials.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${fn} returned ${response.status}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

// ─── Knowledge context ──────────────────────────────────────────────────────

interface KnowledgeRow {
  title?: string | null;
  text?: string | null;
  chunk_text?: string | null;
  body_text?: string | null;
}

function renderKnowledgeRows(rows: KnowledgeRow[], label: string): string {
  const lines: string[] = [label];
  for (const row of rows.slice(0, MAX_KNOWLEDGE_ITEMS)) {
    const text = (row.text ?? row.chunk_text ?? row.body_text ?? "").trim();
    if (!text) continue;
    const title = (row.title ?? "").trim();
    lines.push(title ? `- ${title}: ${text}` : `- ${text}`);
  }
  if (lines.length === 1) return "";
  return lines.join("\n").slice(0, MAX_KNOWLEDGE_CHARS);
}

async function fetchFullTextFallback(
  credentials: SecondBrainCredentials,
  query: string
): Promise<string> {
  const params = new URLSearchParams({
    select: "title,body_text",
    search_tsv: `plfts.${query}`,
    order: "last_edited_time.desc.nullslast",
    limit: String(MAX_KNOWLEDGE_ITEMS),
  });
  const response = await fetch(
    `${credentials.url}/rest/v1/${documentsTable()}?${params}`,
    {
      headers: {
        apikey: credentials.serviceRoleKey,
        Authorization: `Bearer ${credentials.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    logRetrievalError(
      "supabase",
      "knowledge",
      `fulltext fallback returned ${response.status}`
    );
    return "";
  }
  const rows = (await response.json()) as KnowledgeRow[];
  return renderKnowledgeRows(
    rows,
    "RELEVANT PRIVATE CONTEXT (keyword fallback): use only directly relevant facts; never mention this source."
  );
}

const KNOWLEDGE_LABEL =
  "RELEVANT PRIVATE CONTEXT: use only directly relevant facts; never mention this source.";

/**
 * Hybrid semantic + full-text lookup over the knowledge base, routed by
 * getKnowledgeBackend(). Returns a rendered block ready for the prompt,
 * or "" when nothing relevant or no knowledge base is reachable.
 */
export async function fetchKnowledgeContext(query: string): Promise<string> {
  if (!query.trim()) return "";

  const backend = getKnowledgeBackend();
  if (backend === "brain-api") return fetchBrainKnowledgeContext(query);
  if (backend === "sqlite") {
    return guardedLookup("sqlite", "knowledge", async () => {
      const embedding = await embedQuery(query);
      return fetchLocalKnowledgeContext(query, embedding);
    });
  }

  const credentials = backend === "supabase" ? readCredentials() : null;
  if (!credentials) return "";

  return guardedLookup("supabase", "knowledge", async () => {
    const embedding = await embedQuery(query);
    if (!embedding) {
      reportMissingEmbedding("supabase", "knowledge");
      return fetchFullTextFallback(credentials, query);
    }

    const rows = (await callRpc(credentials, hybridSearchRpc(), {
      query_embedding: embedding,
      query_text: query,
      match_count: MAX_KNOWLEDGE_ITEMS,
      semantic_weight: 0.75,
    })) as KnowledgeRow[];

    const rendered = renderKnowledgeRows(rows, KNOWLEDGE_LABEL);
    if (rendered) return rendered;
    return fetchFullTextFallback(credentials, query);
  });
}

async function fetchBrainKnowledgeContext(query: string): Promise<string> {
  const config = brainConfigOrLog("knowledge");
  if (!config) return "";
  return guardedLookup("brain-api", "knowledge", async () => {
    const rows = await searchBrainKnowledge(config, query, {
      limit: MAX_KNOWLEDGE_ITEMS,
      textChars: KNOWLEDGE_TEXT_CHARS,
    });
    return renderKnowledgeRows(rows, KNOWLEDGE_LABEL);
  });
}

// ─── Style examples ─────────────────────────────────────────────────────────

const GERMAN_STOPWORDS = new Set([
  "und", "der", "die", "das", "ich", "du", "nicht", "ist", "mit", "auf",
  "ein", "eine", "wir", "aber", "auch", "noch", "schon", "mal", "wie",
  "was", "dann", "wenn", "oder", "mir", "dir", "ja", "nein", "danke",
]);
const ENGLISH_STOPWORDS = new Set([
  "the", "and", "you", "not", "is", "with", "on", "a", "we", "but",
  "also", "still", "how", "what", "then", "if", "or", "me", "yes", "no",
  "thanks", "i", "it", "this", "that", "are", "was", "for",
]);

/** Cheap DE/EN guess so the style index can filter by language. */
export function inferLanguage(text: string): "de" | "en" | null {
  const words = text.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  let german = 0;
  let english = 0;
  for (const word of words) {
    if (GERMAN_STOPWORDS.has(word)) german += 1;
    if (ENGLISH_STOPWORDS.has(word)) english += 1;
  }
  if (german === 0 && english === 0) return null;
  return german >= english ? "de" : "en";
}

/**
 * One style-index row. The index pairs each operator reply with the
 * prospect message it answered (`incoming_text`); that side belongs to
 * an unrelated contact and is deliberately not part of this type, so it
 * can never be rendered into another prospect's prompt.
 */
interface StyleRow {
  outgoing_text?: string | null;
  language?: string | null;
  is_sensitive?: boolean | null;
  eligible_for_retrieval?: boolean | null;
}

const SAFE_LANGUAGE_TAG = /^[a-z]{2}$/;

/**
 * Prompt block for style-index rows ("" when none survive). Renders only
 * the operator's own outbound words, re-redacted (the index may predate
 * current redaction rules), plus a language tag. Automation-authored
 * replies and rows the index flags as sensitive are dropped.
 */
export function renderStyleExamples(rows: readonly StyleRow[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const row of rows) {
    if (row.is_sensitive === true || row.eligible_for_retrieval === false) continue;
    const outgoing = (row.outgoing_text ?? "").trim();
    if (!outgoing || hasAutomationMarker(outgoing)) continue;
    const text = redactCorpusText(outgoing).slice(0, MAX_STYLE_EXAMPLE_CHARS);
    const key = normalizeForMatch(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const language = (row.language ?? "").toLowerCase();
    const tag = SAFE_LANGUAGE_TAG.test(language) ? ` (${language})` : "";
    lines.push(`- You wrote${tag}: ${text}`);
    if (lines.length >= MAX_STYLE_EXAMPLES) break;
  }
  if (lines.length === 0) return "";
  return [
    "RELEVANT STYLE EXAMPLES (your own past replies to other people): imitate phrasing/tone only; never treat these as facts about this chat.",
    ...lines,
  ].join("\n");
}

/**
 * Pull examples of how the operator actually texts from the isolated
 * style index. Phrasing and tone only, never facts, and never the
 * other contact's side of the exchange. With brain-api the server
 * embeds; the Supabase path needs the local embedding model and is
 * skipped (with a logged error) without it.
 */
export async function fetchStyleExamples(incomingText: string): Promise<string> {
  if (!incomingText.trim()) return "";
  if (getKnowledgeBackend() === "brain-api") {
    return fetchBrainStyleExamples(incomingText);
  }

  const credentials = readCredentials();
  if (!credentials) return "";

  return guardedLookup("supabase", "style", async () => {
    const embedding = await embedQuery(incomingText);
    if (!embedding) {
      reportMissingEmbedding("supabase", "style");
      return "";
    }

    const rows = (await callRpc(
      credentials,
      styleSearchRpc(),
      {
        query_embedding: embedding,
        match_count: STYLE_CANDIDATES,
        filter_language: inferLanguage(incomingText),
        filter_chat_kind: "direct",
      }
    )) as StyleRow[];

    return renderStyleExamples(rows);
  });
}

async function fetchBrainStyleExamples(incomingText: string): Promise<string> {
  const config = brainConfigOrLog("style");
  if (!config) return "";
  return guardedLookup("brain-api", "style", async () => {
    const rows = await searchBrainStyle(config, incomingText, {
      limit: STYLE_CANDIDATES,
      language: inferLanguage(incomingText),
      chatKind: "direct",
    });
    return renderStyleExamples(rows);
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface KnowledgeHealth {
  backend: KnowledgeBackend;
  ok: boolean;
  detail: string;
}

/**
 * One-shot reachability check for the selected backend. brain-api asks
 * GET /v1/health; Supabase and SQLite only report that they are
 * configured. Never throws.
 */
export async function checkKnowledgeHealth(): Promise<KnowledgeHealth> {
  const backend = getKnowledgeBackend();
  if (backend === null) {
    return { backend, ok: false, detail: "no-knowledge-base-configured" };
  }
  if (backend !== "brain-api") {
    return { backend, ok: true, detail: "configured" };
  }
  const result = readBrainApiConfig();
  if (!result.ok) {
    return { backend, ok: false, detail: describeConfigProblem(result) };
  }
  try {
    const health = await fetchBrainHealth(result.config);
    return {
      backend,
      ok: health.ok,
      detail: `notes=${health.notes ?? "?"} chunks=${health.chunks ?? "?"}`,
    };
  } catch (error: unknown) {
    return { backend, ok: false, detail: describeError(error) };
  }
}

/** Log one HEALTH line; safe to fire and forget at process start. */
export async function logKnowledgeHealth(): Promise<void> {
  try {
    const health = await checkKnowledgeHealth();
    logRetrievalHealth(health.backend ?? "none", health.ok, health.detail);
  } catch (error: unknown) {
    logRetrievalHealth("unknown", false, describeError(error));
  }
}
