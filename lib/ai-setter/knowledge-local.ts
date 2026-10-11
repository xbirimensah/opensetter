/**
 * Local SQLite knowledge base: the no-Supabase option.
 *
 * `npm run knowledge:ingest -- ./knowledge` (without Supabase env vars)
 * writes documents, chunks, and embeddings into a single SQLite file.
 * Retrieval loads the chunk embeddings into memory (reloaded when the
 * file changes) and ranks by cosine similarity; typical knowledge bases
 * are a few thousand chunks, where brute force takes single-digit
 * milliseconds. With no embedder available it falls back to keyword
 * matching so retrieval still works, just less semantically.
 */

import { existsSync, statSync } from "fs";

import { describeError, logRetrievalError } from "./retrieval-log";

const MAX_ITEMS = 5;
const MAX_CHARS = 3000;

export function localKnowledgePath(): string {
  return process.env.SECOND_BRAIN_SQLITE_PATH ?? "./data/knowledge.db";
}

export function isLocalKnowledgeAvailable(): boolean {
  try {
    return existsSync(localKnowledgePath());
  } catch {
    return false;
  }
}

interface LocalChunk {
  title: string;
  text: string;
  embedding: Float32Array | null;
}

let cache: { mtimeMs: number; chunks: LocalChunk[] } | null = null;

async function loadChunks(): Promise<LocalChunk[]> {
  const path = localKnowledgePath();
  const mtimeMs = statSync(path).mtimeMs;
  if (cache && cache.mtimeMs === mtimeMs) return cache.chunks;

  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `select d.title as title, c.text as text, c.embedding as embedding
         from chunks c join documents d on d.id = c.document_id`
      )
      .all() as Array<{ title: string; text: string; embedding: Buffer | null }>;

    const chunks: LocalChunk[] = rows.map((row) => ({
      title: row.title,
      text: row.text,
      embedding:
        row.embedding && row.embedding.length > 0
          ? new Float32Array(
              row.embedding.buffer,
              row.embedding.byteOffset,
              row.embedding.byteLength / 4
            )
          : null,
    }));
    cache = { mtimeMs, chunks };
    return chunks;
  } finally {
    db.close();
  }
}

function cosineSimilarity(a: number[], b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i++) dot += a[i] * b[i];
  // Embeddings are normalized at ingest and query time, so the dot
  // product IS the cosine similarity.
  return dot;
}

function keywordScore(queryWords: string[], text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const word of queryWords) {
    if (word.length >= 3 && lower.includes(word)) hits += 1;
  }
  return hits;
}

function render(results: Array<{ title: string; text: string }>): string {
  if (results.length === 0) return "";
  const lines = [
    "RELEVANT PRIVATE CONTEXT: use only directly relevant facts; never mention this source.",
  ];
  for (const result of results.slice(0, MAX_ITEMS)) {
    const text = result.text.replace(/\s+/g, " ").trim();
    lines.push(result.title ? `- ${result.title}: ${text}` : `- ${text}`);
  }
  return lines.join("\n").slice(0, MAX_CHARS);
}

/**
 * Retrieve knowledge from the local SQLite file. `queryEmbedding` may be
 * null (embedder unavailable); keyword matching takes over.
 */
export async function fetchLocalKnowledgeContext(
  query: string,
  queryEmbedding: number[] | null
): Promise<string> {
  try {
    const chunks = await loadChunks();
    if (chunks.length === 0) return "";

    if (queryEmbedding) {
      const scored = chunks
        .filter((chunk) => chunk.embedding)
        .map((chunk) => ({
          title: chunk.title,
          text: chunk.text,
          score: cosineSimilarity(queryEmbedding, chunk.embedding as Float32Array),
        }))
        .sort((a, b) => b.score - a.score)
        .filter((chunk) => chunk.score > 0.2);
      if (scored.length > 0) return render(scored);
    }

    const queryWords = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const keywordScored = chunks
      .map((chunk) => ({
        title: chunk.title,
        text: chunk.text,
        score: keywordScore(queryWords, `${chunk.title} ${chunk.text}`),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score);
    return render(keywordScored);
  } catch (error: unknown) {
    logRetrievalError("sqlite", "knowledge", describeError(error));
    return "";
  }
}
