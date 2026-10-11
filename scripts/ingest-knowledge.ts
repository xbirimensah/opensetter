/**
 * Knowledge-base ingester.
 *
 * Reads a folder of .md / .txt files, chunks them, embeds every chunk
 * locally (same model the setter queries with), and writes documents +
 * chunks into the knowledge base:
 *
 *  - With SECOND_BRAIN_SUPABASE_URL set: upserts into the Supabase
 *    schema from schema/knowledge-base.sql.
 *  - Without it: writes a local SQLite file (SECOND_BRAIN_SQLITE_PATH,
 *    default ./data/knowledge.db). No accounts, no setup.
 *  - With SECOND_BRAIN_BACKEND=brain-api: refuses. That knowledge base is
 *    the second-brain vault, indexed on the server; add files there instead.
 *
 * Usage:
 *   npm run knowledge:ingest -- ./knowledge
 *
 * Re-running is safe: documents upsert by relative path and their chunks
 * are replaced wholesale.
 */

import { readdir, readFile, mkdir } from "fs/promises";
import { join, relative, extname, basename, dirname } from "path";

const CHUNK_TARGET_CHARS = 1100;
const EMBED_BATCH = 16;
const EMBEDDING_DIMENSIONS = 384;
const DEFAULT_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

const SUPABASE_URL = process.env.SECOND_BRAIN_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = process.env.SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY;
const DOCUMENTS_TABLE =
  process.env.SECOND_BRAIN_DOCUMENTS_TABLE ?? "opensetter_documents";
const CHUNKS_TABLE =
  process.env.SECOND_BRAIN_CHUNKS_TABLE ?? "opensetter_chunks";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY as string,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if ([".md", ".txt", ".markdown"].includes(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function extractTitle(content: string, filePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return basename(filePath, extname(filePath)).replace(/[-_]/g, " ");
}

/** Split on paragraph boundaries into chunks around CHUNK_TARGET_CHARS. */
function chunkText(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > CHUNK_TARGET_CHARS) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk.slice(0, CHUNK_TARGET_CHARS * 2));
}

type Embedder = (texts: string[]) => Promise<number[][]>;

async function loadEmbedder(): Promise<Embedder> {
  const { pipeline } = await import("@huggingface/transformers");
  const model =
    process.env.SECOND_BRAIN_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  console.log(`loading embedding model ${model} (first run downloads it)...`);
  const extractor = await pipeline("feature-extraction", model);
  return async (texts: string[]) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const flat = Array.from(output.data as Float32Array);
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const vector = flat.slice(
        i * EMBEDDING_DIMENSIONS,
        (i + 1) * EMBEDDING_DIMENSIONS
      );
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error("unexpected embedding dimensions");
      }
      vectors.push(vector);
    }
    return vectors;
  };
}

async function upsertDocument(
  sourceId: string,
  title: string,
  bodyText: string
): Promise<string> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${DOCUMENTS_TABLE}?on_conflict=source_id`,
    {
      method: "POST",
      headers: headers({
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify({
        source_id: sourceId,
        title,
        body_text: bodyText.slice(0, 20000),
        last_edited_time: new Date().toISOString(),
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`document upsert failed (${response.status}): ${await response.text()}`);
  }
  const rows = (await response.json()) as Array<{ id: string }>;
  return rows[0].id;
}

async function replaceChunks(
  documentId: string,
  chunks: string[],
  embed: Embedder
): Promise<void> {
  const del = await fetch(
    `${SUPABASE_URL}/rest/v1/${CHUNKS_TABLE}?document_id=eq.${documentId}`,
    { method: "DELETE", headers: headers() }
  );
  if (!del.ok) {
    throw new Error(`chunk delete failed (${del.status})`);
  }

  for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
    const batch = chunks.slice(start, start + EMBED_BATCH);
    const vectors = await embed(batch);
    const rows = batch.map((text, index) => ({
      document_id: documentId,
      chunk_index: start + index,
      text,
      embedding: JSON.stringify(vectors[index]),
    }));
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${CHUNKS_TABLE}`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(rows),
    });
    if (!response.ok) {
      throw new Error(`chunk insert failed (${response.status}): ${await response.text()}`);
    }
  }
}

// ── Local SQLite backend ────────────────────────────────────────────────────

interface SqliteHandle {
  upsertDocument(sourceId: string, title: string, bodyText: string): number;
  replaceChunks(
    documentId: number,
    chunks: string[],
    vectors: number[][]
  ): void;
  close(): void;
}

async function openSqlite(): Promise<SqliteHandle> {
  const path = process.env.SECOND_BRAIN_SQLITE_PATH ?? "./data/knowledge.db";
  await mkdir(dirname(path), { recursive: true });
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists documents (
      id integer primary key autoincrement,
      source_id text not null unique,
      title text not null,
      body_text text
    );
    create table if not exists chunks (
      id integer primary key autoincrement,
      document_id integer not null references documents(id) on delete cascade,
      chunk_index integer not null,
      text text not null,
      embedding blob
    );
    create index if not exists chunks_document_idx on chunks(document_id);
  `);
  console.log(`writing local knowledge base at ${path}`);

  return {
    upsertDocument(sourceId, title, bodyText) {
      db.prepare(
        `insert into documents (source_id, title, body_text) values (?, ?, ?)
         on conflict(source_id) do update set title = excluded.title, body_text = excluded.body_text`
      ).run(sourceId, title, bodyText.slice(0, 20000));
      const row = db
        .prepare(`select id from documents where source_id = ?`)
        .get(sourceId) as { id: number };
      return row.id;
    },
    replaceChunks(documentId, chunks, vectors) {
      const insert = db.prepare(
        `insert into chunks (document_id, chunk_index, text, embedding) values (?, ?, ?, ?)`
      );
      const replaceAll = db.transaction(() => {
        db.prepare(`delete from chunks where document_id = ?`).run(documentId);
        chunks.forEach((text, index) => {
          const vector = vectors[index];
          const blob = vector
            ? Buffer.from(new Float32Array(vector).buffer)
            : null;
          insert.run(documentId, index, text, blob);
        });
      });
      replaceAll();
    },
    close() {
      db.close();
    },
  };
}

async function main(): Promise<void> {
  if (process.env.SECOND_BRAIN_BACKEND?.trim().toLowerCase() === "brain-api") {
    console.error(
      "SECOND_BRAIN_BACKEND=brain-api: knowledge now lives in the second-brain vault on the server. " +
        "Add .md files under the vault Knowledge/ folder; the vault indexer picks them up. Nothing was ingested."
    );
    process.exit(1);
  }

  const useSupabase = Boolean(SUPABASE_URL && SERVICE_KEY);

  const dir = process.argv[2] ?? "./knowledge";
  const files = await collectFiles(dir).catch(() => []);
  if (files.length === 0) {
    console.error(`No .md or .txt files found under ${dir}`);
    process.exit(1);
  }

  const embed = await loadEmbedder();
  const sqlite = useSupabase ? null : await openSqlite();
  let totalChunks = 0;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const sourceId = relative(dir, file);
    const title = extractTitle(content, file);
    const chunks = chunkText(content);
    if (chunks.length === 0) continue;

    if (sqlite) {
      const vectors: number[][] = [];
      for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
        const batch = chunks.slice(start, start + EMBED_BATCH);
        vectors.push(...(await embed(batch)));
      }
      const documentId = sqlite.upsertDocument(sourceId, title, content);
      sqlite.replaceChunks(documentId, chunks, vectors);
    } else {
      const documentId = await upsertDocument(sourceId, title, content);
      await replaceChunks(documentId, chunks, embed);
    }
    totalChunks += chunks.length;
    console.log(`${sourceId}: ${chunks.length} chunks ("${title}")`);
  }

  sqlite?.close();
  console.log(
    `Done. ${files.length} documents, ${totalChunks} chunks (${useSupabase ? "supabase" : "local sqlite"}).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
