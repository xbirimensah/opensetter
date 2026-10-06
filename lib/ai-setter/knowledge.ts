/**
 * Second-brain retrieval for the AI setter.
 *
 * Talks straight to the knowledge base's Supabase project via PostgREST:
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
 * reply, it just makes it less informed.
 */

import { hasAutomationMarker, normalizeForMatch } from "./authorship";
import {
  fetchLocalKnowledgeContext,
  isLocalKnowledgeAvailable,
} from "./knowledge-local";
import { redactCorpusText } from "./style-corpus-core";

const RPC_TIMEOUT_MS = 30_000;
const MAX_KNOWLEDGE_ITEMS = 5;
const MAX_KNOWLEDGE_CHARS = 3000;
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

export type KnowledgeBackend = "supabase" | "sqlite" | null;

export function getKnowledgeBackend(): KnowledgeBackend {
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
  if (!response.ok) return "";
  const rows = (await response.json()) as KnowledgeRow[];
  return renderKnowledgeRows(
    rows,
    "RELEVANT PRIVATE CONTEXT (keyword fallback): use only directly relevant facts; never mention this source."
  );
}

/**
 * Hybrid semantic + full-text lookup over the knowledge base. Routes to
 * Supabase when configured, otherwise to the local SQLite file. Returns
 * a rendered block ready for the prompt, or "" when nothing relevant or
 * no knowledge base is reachable.
 */
export async function fetchKnowledgeContext(query: string): Promise<string> {
  if (!query.trim()) return "";

  const credentials = readCredentials();
  if (!credentials) {
    if (!isLocalKnowledgeAvailable()) return "";
    const embedding = await embedQuery(query);
    return fetchLocalKnowledgeContext(query, embedding);
  }

  try {
    const embedding = await embedQuery(query);
    if (!embedding) return fetchFullTextFallback(credentials, query);

    const rows = (await callRpc(credentials, hybridSearchRpc(), {
      query_embedding: embedding,
      query_text: query,
      match_count: MAX_KNOWLEDGE_ITEMS,
      semantic_weight: 0.75,
    })) as KnowledgeRow[];

    const rendered = renderKnowledgeRows(
      rows,
      "RELEVANT PRIVATE CONTEXT: use only directly relevant facts; never mention this source."
    );
    if (rendered) return rendered;
    return fetchFullTextFallback(credentials, query);
  } catch (error: unknown) {
    console.error("[ai-setter] knowledge lookup failed:", error);
    return "";
  }
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
 * other contact's side of the exchange. Requires the local embedding
 * model; skipped silently without it.
 */
export async function fetchStyleExamples(incomingText: string): Promise<string> {
  const credentials = readCredentials();
  if (!credentials || !incomingText.trim()) return "";

  try {
    const embedding = await embedQuery(incomingText);
    if (!embedding) return "";

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
  } catch (error: unknown) {
    console.error("[ai-setter] style lookup failed:", error);
    return "";
  }
}
