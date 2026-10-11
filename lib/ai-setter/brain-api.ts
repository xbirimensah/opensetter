/**
 * Client for a self-hosted second-brain REST API (a vault-backed
 * knowledge base on the same server, default http://127.0.0.1:8790).
 *
 * Selected with SECOND_BRAIN_BACKEND=brain-api. The server embeds
 * queries itself, so this path never loads a local embedding model.
 * Auth is a bearer token from BRAIN_API_TOKEN, else from the token file
 * (BRAIN_API_TOKEN_FILE, default ~/.config/opensetter/brain-api-token). The
 * file is re-read per call so a rotated token needs no restart.
 *
 * All brain API field names are mapped to the setter's row shapes here
 * and nowhere else. The style mapping keeps only the operator's own
 * outbound side: the prospect message a reply answered (incoming_text)
 * belongs to an unrelated contact and is dropped at this boundary.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_BRAIN_API_URL = "http://127.0.0.1:8790";
const DEFAULT_TOKEN_FILE = "~/.config/opensetter/brain-api-token";
/** Same budget as the Supabase RPC path. */
const BRAIN_API_TIMEOUT_MS = 30_000;

export interface BrainApiConfig {
  url: string;
  token: string;
}

/** Knowledge row in the shape renderKnowledgeRows expects. */
export interface BrainKnowledgeRow {
  title: string;
  text: string;
}

/** Style row in the shape renderStyleExamples expects; no incoming side. */
export interface BrainStyleRow {
  outgoing_text: string | null;
  language: string | null;
  is_sensitive: boolean | null;
  eligible_for_retrieval: boolean | null;
}

export interface BrainHealth {
  ok: boolean;
  notes: number | null;
  chunks: number | null;
}

function expandHome(path: string): string {
  const home = process.env.HOME?.trim() || homedir();
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function brainApiUrl(): string {
  const url = process.env.BRAIN_API_URL?.trim() || DEFAULT_BRAIN_API_URL;
  return url.replace(/\/+$/, "");
}

export function readBrainApiToken(): string | null {
  const fromEnv = process.env.BRAIN_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = expandHome(
    process.env.BRAIN_API_TOKEN_FILE?.trim() || DEFAULT_TOKEN_FILE
  );
  try {
    const token = readFileSync(file, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

/** Null when no token is available (caller logs and fails open). */
export function readBrainApiConfig(): BrainApiConfig | null {
  const token = readBrainApiToken();
  if (!token) return null;
  return { url: brainApiUrl(), token };
}

function searchFolders(): string[] | null {
  const raw = process.env.BRAIN_API_SEARCH_FOLDERS?.trim();
  if (!raw) return null;
  const folders = raw
    .split(",")
    .map((folder) => folder.trim())
    .filter(Boolean);
  return folders.length > 0 ? folders : null;
}

async function brainRequest(
  config: BrainApiConfig,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
  };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${config.url}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(BRAIN_API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`brain API ${path} returned ${response.status}`);
  }
  return response.json();
}

// ─── Field mapping (the only place brain API fields are read) ─────────────

type Fields = Record<string, unknown>;

function resultsOf(payload: unknown): Fields[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as Fields).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (row): row is Fields => Boolean(row) && typeof row === "object"
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toKnowledgeRows(payload: unknown): BrainKnowledgeRow[] {
  return resultsOf(payload).map((row) => {
    const title = text(row.title);
    const heading = text(row.heading);
    const label =
      title && heading && heading !== title
        ? `${title} > ${heading}`
        : title || heading;
    return { title: label, text: text(row.snippet) };
  });
}

export function toStyleRows(payload: unknown): BrainStyleRow[] {
  return resultsOf(payload).map((row) => ({
    outgoing_text: nullableText(row.outgoing_text),
    language: nullableText(row.language),
    is_sensitive: nullableBoolean(row.is_sensitive),
    eligible_for_retrieval: nullableBoolean(row.eligible_for_retrieval),
  }));
}

export function toBrainHealth(payload: unknown): BrainHealth {
  const fields = payload && typeof payload === "object" ? (payload as Fields) : {};
  const index =
    fields.index && typeof fields.index === "object"
      ? (fields.index as Fields)
      : {};
  return {
    ok: fields.ok === true,
    notes: nullableCount(index.notes),
    chunks: nullableCount(index.chunks),
  };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function searchBrainKnowledge(
  config: BrainApiConfig,
  query: string,
  limit: number
): Promise<BrainKnowledgeRow[]> {
  const body: Record<string, unknown> = { query, mode: "hybrid", limit };
  const folders = searchFolders();
  if (folders) body.folders = folders;
  return toKnowledgeRows(await brainRequest(config, "/v1/search", body));
}

export async function searchBrainStyle(
  config: BrainApiConfig,
  query: string,
  options: { limit: number; language: string | null; chatKind: string }
): Promise<BrainStyleRow[]> {
  const body: Record<string, unknown> = {
    query,
    limit: options.limit,
    chat_kind: options.chatKind,
  };
  if (options.language) body.language = options.language;
  return toStyleRows(await brainRequest(config, "/v1/style/search", body));
}

export async function fetchBrainHealth(
  config: BrainApiConfig
): Promise<BrainHealth> {
  return toBrainHealth(await brainRequest(config, "/v1/health"));
}
