/**
 * Client for a self-hosted second-brain REST API (a vault-backed
 * knowledge base on the same server, default http://127.0.0.1:8790).
 *
 * Selected with SECOND_BRAIN_BACKEND=brain-api. The server embeds
 * queries itself, so this path never loads a local embedding model.
 * Auth is a bearer token from BRAIN_API_TOKEN, else from the token file
 * (BRAIN_API_TOKEN_FILE, default ~/.config/opensetter/brain-api-token, the
 * read-only search scope). The file is re-read per call so a rotated
 * token needs no restart, and it is refused when group- or
 * world-readable. The token is only ever sent to a loopback http URL or
 * to https; any other BRAIN_API_URL is treated as misconfigured.
 *
 * All brain API field names are mapped to the setter's row shapes here
 * and nowhere else. The style mapping keeps only the operator's own
 * outbound side: the prospect message a reply answered (incoming_text)
 * belongs to an unrelated contact and is dropped at this boundary.
 */

import { readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_BRAIN_API_URL = "http://127.0.0.1:8790";
const DEFAULT_TOKEN_FILE = "~/.config/opensetter/brain-api-token";
/** Any of these permission bits means someone besides the owner can read it. */
const GROUP_OR_WORLD_BITS = 0o077;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
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

/** Why no usable config exists; callers log and fail open. */
export type BrainApiConfigProblem =
  | { reason: "insecure-url"; host: string }
  | { reason: "missing-token" }
  | { reason: "token_file_permissions"; path: string };

export type BrainApiConfigResult =
  | { ok: true; config: BrainApiConfig }
  | ({ ok: false } & BrainApiConfigProblem);

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

/**
 * True when the token may be sent to `url`: loopback over http, or any
 * host over https.
 */
export function isAllowedBrainApiUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return (
    parsed.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  );
}

function hostForLog(url: string): string {
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unparseable";
  }
}

type TokenResult =
  | { token: string }
  | { problem: "missing-token" }
  | { problem: "token_file_permissions"; path: string };

function readToken(): TokenResult {
  const fromEnv = process.env.BRAIN_API_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv };
  const file = expandHome(
    process.env.BRAIN_API_TOKEN_FILE?.trim() || DEFAULT_TOKEN_FILE
  );
  try {
    if ((statSync(file).mode & GROUP_OR_WORLD_BITS) !== 0) {
      return { problem: "token_file_permissions", path: file };
    }
    const token = readFileSync(file, "utf8").trim();
    return token ? { token } : { problem: "missing-token" };
  } catch {
    return { problem: "missing-token" };
  }
}

/**
 * Resolve URL and token. The URL is checked first so the token is not
 * even read when it could leave the machine in clear text.
 */
export function readBrainApiConfig(): BrainApiConfigResult {
  const url = brainApiUrl();
  if (!isAllowedBrainApiUrl(url)) {
    return { ok: false, reason: "insecure-url", host: hostForLog(url) };
  }
  const token = readToken();
  if ("token" in token) return { ok: true, config: { url, token: token.token } };
  if (token.problem === "token_file_permissions") {
    return { ok: false, reason: "token_file_permissions", path: token.path };
  }
  return { ok: false, reason: "missing-token" };
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
    // `text` is the best chunk widened to text_chars; `snippet` is a short
    // highlight, kept only as a fallback for servers without `text`.
    return { title: label, text: text(row.text) || text(row.snippet) };
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
  options: { limit: number; textChars: number }
): Promise<BrainKnowledgeRow[]> {
  const body: Record<string, unknown> = {
    query,
    mode: "hybrid",
    limit: options.limit,
    text_chars: options.textChars,
  };
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
