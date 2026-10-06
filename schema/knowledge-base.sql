-- OpenSetter knowledge base schema (Supabase / Postgres with pgvector).
--
-- Apply this to a Supabase project (SQL editor or `supabase db push`) to
-- give the AI setter a knowledge base and a style index. Then fill it with
-- `npm run knowledge:ingest -- ./path/to/markdown-folder`.
--
-- Embeddings are 384-dimensional vectors from
-- sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2, generated
-- locally by OpenSetter at ingest and query time. If you change the model,
-- change the vector dimension here to match and re-ingest.
--
-- Everything is locked to service_role: the setter talks to these tables
-- with the service role key, and anon/authenticated API access stays off.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── Documents and chunks ────────────────────────────────────────────────────

create table if not exists public.opensetter_documents (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  title text not null,
  body_text text,
  url text,
  last_edited_time timestamptz default now(),
  search_tsv tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_text, ''))
  ) stored,
  created_at timestamptz not null default now()
);

create index if not exists opensetter_documents_search_tsv_idx
  on public.opensetter_documents using gin (search_tsv);

create table if not exists public.opensetter_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.opensetter_documents(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  embedding vector(384) not null,
  search_tsv tsvector generated always as (to_tsvector('simple', text)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists opensetter_chunks_embedding_hnsw_idx
  on public.opensetter_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists opensetter_chunks_search_tsv_idx
  on public.opensetter_chunks using gin (search_tsv);

alter table public.opensetter_documents enable row level security;
alter table public.opensetter_chunks enable row level security;
revoke all on table public.opensetter_documents from anon, authenticated;
revoke all on table public.opensetter_chunks from anon, authenticated;
grant select, insert, update, delete on table public.opensetter_documents to service_role;
grant select, insert, update, delete on table public.opensetter_chunks to service_role;

-- ── Hybrid search (semantic + full-text) ────────────────────────────────────

create or replace function public.opensetter_hybrid_search(
  query_embedding vector(384),
  query_text text,
  match_count integer default 5,
  semantic_weight double precision default 0.75
)
returns table (
  title text,
  text text,
  score double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  with semantic as (
    select
      c.id,
      d.title,
      c.text,
      1 - (c.embedding <=> query_embedding) as semantic_score
    from public.opensetter_chunks c
    join public.opensetter_documents d on d.id = c.document_id
    order by c.embedding <=> query_embedding
    limit greatest(match_count * 4, 20)
  ),
  lexical as (
    select
      c.id,
      ts_rank(c.search_tsv, plainto_tsquery('simple', query_text)) as fts_score
    from public.opensetter_chunks c
    where c.search_tsv @@ plainto_tsquery('simple', query_text)
    limit greatest(match_count * 4, 20)
  )
  select
    s.title,
    s.text,
    (semantic_weight * s.semantic_score
      + (1 - semantic_weight) * coalesce(l.fts_score, 0)) as score
  from semantic s
  left join lexical l on l.id = s.id
  order by score desc
  limit greatest(1, least(match_count, 10));
$$;

revoke all on function public.opensetter_hybrid_search(vector, text, integer, double precision) from public;
grant execute on function public.opensetter_hybrid_search(vector, text, integer, double precision) to service_role;

-- ── Style index (how the operator actually writes) ──────────────────────────
--
-- Optional. Each row pairs a real incoming message with the reply the
-- operator actually sent, redacted before insert. The setter retrieves
-- only the operator's reply as a phrasing example, never as fact. The
-- incoming side belongs to another contact: the search below returns it
-- as null so it never leaves the database (the column stays in the
-- signature for compatibility with older clients).

create table if not exists public.opensetter_style_examples (
  id uuid primary key default gen_random_uuid(),
  source_message_id text not null unique,
  incoming_text text not null,
  outgoing_text text not null,
  language text not null default 'unknown',
  chat_kind text not null default 'direct' check (chat_kind in ('direct', 'group')),
  intent text not null default 'casual',
  eligible_for_retrieval boolean not null default true,
  is_sensitive boolean not null default false,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);

create index if not exists opensetter_style_examples_embedding_hnsw_idx
  on public.opensetter_style_examples
  using hnsw (embedding vector_cosine_ops)
  where eligible_for_retrieval = true and is_sensitive = false;

alter table public.opensetter_style_examples enable row level security;
revoke all on table public.opensetter_style_examples from anon, authenticated;
grant select, insert, update, delete on table public.opensetter_style_examples to service_role;

create or replace function public.opensetter_style_search(
  query_embedding vector(384),
  match_count integer default 4,
  filter_language text default null,
  filter_chat_kind text default null
)
returns table (
  incoming_text text,
  outgoing_text text,
  language text,
  chat_kind text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    null::text as incoming_text,
    s.outgoing_text,
    s.language,
    s.chat_kind,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.opensetter_style_examples s
  where s.eligible_for_retrieval = true
    and s.is_sensitive = false
    and (filter_language is null or s.language = filter_language or s.language = 'unknown')
    and (filter_chat_kind is null or s.chat_kind = filter_chat_kind)
  order by s.embedding <=> query_embedding
  limit greatest(1, least(match_count, 6));
$$;

revoke all on function public.opensetter_style_search(vector, integer, text, text) from public;
grant execute on function public.opensetter_style_search(vector, integer, text, text) to service_role;
