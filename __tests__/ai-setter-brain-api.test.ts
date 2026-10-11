/**
 * Brain API retrieval backend (SECOND_BRAIN_BACKEND=brain-api)
 *
 * The setter keeps replying when retrieval breaks, so these tests pin
 * the request contract, the privacy boundary of the style mapping, and
 * the loud log lines that make a broken backend visible.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const { pipelineSpy } = vi.hoisted(() => ({
  pipelineSpy: vi.fn(
    async () => async () => ({ data: new Float32Array(384).fill(0.01) })
  ),
}));

vi.mock("@huggingface/transformers", () => ({ pipeline: pipelineSpy }));
vi.mock("../lib/ai-setter/knowledge-local", () => ({
  isLocalKnowledgeAvailable: () => false,
  fetchLocalKnowledgeContext: async () => "",
}));

type KnowledgeModule = typeof import("../lib/ai-setter/knowledge");

/** Fresh module per test so the embedder cache never leaks between tests. */
async function loadKnowledge(): Promise<KnowledgeModule> {
  vi.resetModules();
  return import("../lib/ai-setter/knowledge");
}

const PROSPECT_TEXT =
  "hey ich bin Jana, meine nummer ist +49 151 23456789 und mail jana.private@example.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof mockFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(String(init.body)) : null,
  };
}

function logged(spy: MockInstance): string {
  return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

let savedEnv: NodeJS.ProcessEnv;
let tempHome: string;
let errorSpy: MockInstance;
let warnSpy: MockInstance;
let logSpy: MockInstance;

beforeEach(() => {
  savedEnv = { ...process.env };
  tempHome = mkdtempSync(join(tmpdir(), "brain-api-test-"));
  // The default token file resolves under HOME; never the real one.
  process.env.HOME = tempHome;
  process.env.SECOND_BRAIN_BACKEND = "brain-api";
  process.env.BRAIN_API_TOKEN = "test-token";
  delete process.env.BRAIN_API_URL;
  delete process.env.BRAIN_API_TOKEN_FILE;
  delete process.env.BRAIN_API_SEARCH_FOLDERS;
  delete process.env.AI_SETTER_EMBEDDINGS;
  // Supabase credentials stay present on purpose: the flag must win.
  process.env.SECOND_BRAIN_SUPABASE_URL = "https://brain.example.supabase.co";
  process.env.SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY = "service-role";
  pipelineSpy.mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = savedEnv;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(tempHome, { recursive: true, force: true });
});

describe("backend selection", () => {
  it("brain-api flag wins over present Supabase credentials", async () => {
    const { getKnowledgeBackend } = await loadKnowledge();
    expect(getKnowledgeBackend()).toBe("brain-api");
  });

  it("unset flag keeps today's Supabase auto-detect", async () => {
    delete process.env.SECOND_BRAIN_BACKEND;
    const { getKnowledgeBackend } = await loadKnowledge();
    expect(getKnowledgeBackend()).toBe("supabase");
  });

  it("unknown flag value falls back to auto-detect and says so", async () => {
    process.env.SECOND_BRAIN_BACKEND = "brainapi";
    const { getKnowledgeBackend } = await loadKnowledge();
    expect(getKnowledgeBackend()).toBe("supabase");
    expect(logged(errorSpy)).toContain("CONFIG_ERROR unknown SECOND_BRAIN_BACKEND=brainapi");
  });
});

describe("knowledge search", () => {
  it("posts a hybrid search with the bearer token and maps results", async () => {
    const fetchMock = mockFetch(() =>
      json({
        results: [
          {
            id: "vault:Knowledge/Offer.md",
            root: "vault",
            path: "Knowledge/Offer.md",
            title: "Offer",
            heading: "Pricing",
            snippet: "costs 2k",
            text: "Coaching costs 2k per month, paid monthly, cancel any time.",
            score: 0.8,
            folder: "Knowledge",
            updated: "2026-10-01",
          },
          // Older server without `text`: falls back to the snippet.
          { title: "Bio", heading: "", snippet: "Based in Frankfurt" },
          { title: "Empty text", text: "   ", snippet: "Snippet wins over blank text" },
        ],
      })
    );
    const { fetchKnowledgeContext } = await loadKnowledge();

    const block = await fetchKnowledgeContext("was kostet das coaching");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestOf(fetchMock);
    expect(request.url).toBe("http://127.0.0.1:8790/v1/search");
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer test-token");
    expect(request.body).toEqual({
      query: "was kostet das coaching",
      mode: "hybrid",
      limit: 5,
      text_chars: 1000,
    });
    expect(block).toContain("RELEVANT PRIVATE CONTEXT");
    expect(block).toContain("- Offer > Pricing: Coaching costs 2k per month, paid monthly, cancel any time.");
    expect(block).not.toContain("- Offer > Pricing: costs 2k");
    expect(block).toContain("- Bio: Based in Frankfurt");
    expect(block).toContain("- Empty text: Snippet wins over blank text");
    expect(pipelineSpy).not.toHaveBeenCalled();
  });

  it("honours BRAIN_API_URL and BRAIN_API_SEARCH_FOLDERS", async () => {
    process.env.BRAIN_API_URL = "https://brain.example.test:9000/";
    process.env.BRAIN_API_SEARCH_FOLDERS = "Knowledge, Areas ,";
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    const request = requestOf(fetchMock);
    expect(request.url).toBe("https://brain.example.test:9000/v1/search");
    expect(request.body.folders).toEqual(["Knowledge", "Areas"]);
  });

  it("returns empty and logs RETRIEVAL_ERROR on a non-2xx response", async () => {
    mockFetch(() => json({ detail: "down" }, 503));
    const { fetchKnowledgeContext } = await loadKnowledge();

    expect(await fetchKnowledgeContext("geheime frage")).toBe("");

    const errors = logged(errorSpy);
    expect(errors).toContain("[ai-setter][retrieval] RETRIEVAL_ERROR backend=brain-api kind=knowledge");
    expect(errors).toContain("503");
    expect(errors).not.toContain("geheime frage");
    expect(errors).not.toContain("test-token");
  });

  it("logs RETRIEVAL_EMPTY when the search finds nothing", async () => {
    mockFetch(() => json({ results: [] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    expect(await fetchKnowledgeContext("offer")).toBe("");
    expect(logged(warnSpy)).toContain(
      "[ai-setter][retrieval] RETRIEVAL_EMPTY backend=brain-api kind=knowledge"
    );
  });

  it("fails open with a loud error and no request when no token exists", async () => {
    delete process.env.BRAIN_API_TOKEN;
    process.env.BRAIN_API_TOKEN_FILE = join(tempHome, "missing-token");
    const fetchMock = mockFetch(() => json({ results: [] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    expect(await fetchKnowledgeContext("offer")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(errorSpy)).toContain("RETRIEVAL_ERROR backend=brain-api kind=knowledge reason=missing-token");
  });
});

describe("token sources", () => {
  it("reads the token from BRAIN_API_TOKEN_FILE", async () => {
    delete process.env.BRAIN_API_TOKEN;
    const file = join(tempHome, "token");
    writeFileSync(file, "file-token\n", { mode: 0o600 });
    process.env.BRAIN_API_TOKEN_FILE = file;
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    expect(requestOf(fetchMock).headers.Authorization).toBe("Bearer file-token");
  });

  it("defaults to the read-only ~/.config/opensetter/brain-api-token", async () => {
    delete process.env.BRAIN_API_TOKEN;
    mkdirSync(join(tempHome, ".config", "opensetter"), { recursive: true });
    writeFileSync(join(tempHome, ".config", "opensetter", "brain-api-token"), "home-token", {
      mode: 0o600,
    });
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    expect(requestOf(fetchMock).headers.Authorization).toBe("Bearer home-token");
  });

  it("refuses a group- or world-readable token file and never sends it", async () => {
    delete process.env.BRAIN_API_TOKEN;
    const file = join(tempHome, "token");
    writeFileSync(file, "leaky-token", { mode: 0o600 });
    chmodSync(file, 0o640);
    process.env.BRAIN_API_TOKEN_FILE = file;
    const fetchMock = mockFetch(() => json({ results: [] }));
    const { fetchKnowledgeContext, checkKnowledgeHealth } = await loadKnowledge();

    expect(await fetchKnowledgeContext("offer")).toBe("");
    const health = await checkKnowledgeHealth();

    expect(fetchMock).not.toHaveBeenCalled();
    const errors = logged(errorSpy);
    expect(errors).toContain(
      `RETRIEVAL_ERROR backend=brain-api kind=knowledge reason=token_file_permissions path=${file}`
    );
    expect(errors).not.toContain("leaky-token");
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("token_file_permissions");
  });

  it("still uses BRAIN_API_TOKEN when the token file has bad permissions", async () => {
    const file = join(tempHome, "token");
    writeFileSync(file, "leaky-token", { mode: 0o600 });
    chmodSync(file, 0o644);
    process.env.BRAIN_API_TOKEN_FILE = file;
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    expect(requestOf(fetchMock).headers.Authorization).toBe("Bearer test-token");
  });

  it("prefers BRAIN_API_TOKEN over the token file", async () => {
    const file = join(tempHome, "token");
    writeFileSync(file, "file-token", { mode: 0o600 });
    process.env.BRAIN_API_TOKEN_FILE = file;
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    expect(requestOf(fetchMock).headers.Authorization).toBe("Bearer test-token");
  });
});

describe("BRAIN_API_URL safety", () => {
  it.each([
    "http://127.0.0.1:8790",
    "http://localhost:8790/",
    "http://[::1]:8790",
    "https://brain.example.test",
  ])("sends the token to %s", async (url) => {
    process.env.BRAIN_API_URL = url;
    const fetchMock = mockFetch(() => json({ results: [{ title: "A", snippet: "b" }] }));
    const { fetchKnowledgeContext } = await loadKnowledge();

    await fetchKnowledgeContext("offer");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http://brain.example.test:8790", "brain.example.test"],
    ["http://100.64.1.2:8790", "100.64.1.2"],
    ["ftp://127.0.0.1/", "127.0.0.1"],
    ["not a url", "unparseable"],
  ])("refuses %s with CONFIG_ERROR and no request", async (url, host) => {
    process.env.BRAIN_API_URL = url;
    const fetchMock = mockFetch(() => json({ results: [] }));
    const { fetchKnowledgeContext, fetchStyleExamples, checkKnowledgeHealth } =
      await loadKnowledge();

    expect(await fetchKnowledgeContext("offer")).toBe("");
    expect(await fetchStyleExamples("wann hast du zeit?")).toBe("");
    const health = await checkKnowledgeHealth();

    expect(fetchMock).not.toHaveBeenCalled();
    const errors = logged(errorSpy);
    expect(errors).toContain(`CONFIG_ERROR BRAIN_API_URL must be loopback http or https; refusing host=${host}`);
    expect(errors).not.toContain("test-token");
    expect(health).toEqual({ backend: "brain-api", ok: false, detail: `insecure-url host=${host}` });
  });
});

describe("style search", () => {
  it("sends the text with safe filters only, never an embedding", async () => {
    const fetchMock = mockFetch(() => json({ results: [] }));
    const { fetchStyleExamples } = await loadKnowledge();

    await fetchStyleExamples("wann hast du zeit?");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestOf(fetchMock);
    expect(request.url).toBe("http://127.0.0.1:8790/v1/style/search");
    expect(request.method).toBe("POST");
    expect(request.headers.Authorization).toBe("Bearer test-token");
    expect(request.body).toEqual({
      query: "wann hast du zeit?",
      limit: 6,
      chat_kind: "direct",
      language: "de",
    });
    expect(pipelineSpy).not.toHaveBeenCalled();
  });

  it("omits the language filter when it cannot be inferred", async () => {
    const fetchMock = mockFetch(() => json({ results: [] }));
    const { fetchStyleExamples } = await loadKnowledge();

    await fetchStyleExamples("👍");

    expect(Object.keys(requestOf(fetchMock).body).sort()).toEqual(["chat_kind", "limit", "query"]);
  });

  it("never renders the unrelated prospect's incoming text", async () => {
    mockFetch(() =>
      json({
        results: [
          {
            incoming_text: PROSPECT_TEXT,
            outgoing_text: "ja easy, schick mir kurz wann du kannst",
            language: "de",
            chat_kind: "direct",
            intent: "availability",
            similarity: 0.91,
          },
        ],
      })
    );
    const { fetchStyleExamples } = await loadKnowledge();

    const block = await fetchStyleExamples("wann hast du zeit?");

    expect(block).toContain("- You wrote (de): ja easy, schick mir kurz wann du kannst");
    expect(block).not.toContain("Jana");
    expect(block).not.toContain("23456789");
    expect(block).not.toContain("jana.private@example.com");
    expect(block).not.toContain("0.91");
  });

  it("renders rows that carry the server's flags and redaction markers", async () => {
    mockFetch(() =>
      json({
        results: [
          {
            outgoing_text: "nimm einfach den key [REDACTED:api_key]",
            language: "de",
            chat_kind: "direct",
            eligible_for_retrieval: true,
            is_sensitive: false,
            similarity: 0.7,
          },
        ],
      })
    );
    const { fetchStyleExamples } = await loadKnowledge();

    const block = await fetchStyleExamples("wie geht das?");

    expect(block).toContain("- You wrote (de): nimm einfach den key [REDACTED:api_key]");
  });

  it("drops the incoming side at the mapping boundary", async () => {
    const { toStyleRows } = await import("../lib/ai-setter/brain-api");
    const rows = toStyleRows({
      results: [{ incoming_text: PROSPECT_TEXT, outgoing_text: "ok", language: "de", similarity: 0.5 }],
    });
    expect(Object.keys(rows[0]).sort()).toEqual([
      "eligible_for_retrieval",
      "is_sensitive",
      "language",
      "outgoing_text",
    ]);
    expect(JSON.stringify(rows)).not.toContain("Jana");
  });

  it("logs RETRIEVAL_EMPTY when every row is sensitive or ineligible", async () => {
    mockFetch(() =>
      json({
        results: [
          { outgoing_text: "das bleibt privat", is_sensitive: true },
          { outgoing_text: "das auch", eligible_for_retrieval: false },
        ],
      })
    );
    const { fetchStyleExamples } = await loadKnowledge();

    expect(await fetchStyleExamples("hi")).toBe("");
    expect(logged(warnSpy)).toContain("RETRIEVAL_EMPTY backend=brain-api kind=style");
  });

  it("returns empty and logs RETRIEVAL_ERROR on a non-2xx response", async () => {
    mockFetch(() => json({ detail: "unauthorized" }, 401));
    const { fetchStyleExamples } = await loadKnowledge();

    expect(await fetchStyleExamples("wann hast du zeit?")).toBe("");
    expect(logged(errorSpy)).toContain("RETRIEVAL_ERROR backend=brain-api kind=style");
  });
});

describe("health", () => {
  it("reports brain API health with note and chunk counts", async () => {
    const fetchMock = mockFetch(() =>
      json({
        ok: true,
        index: { notes: 120, chunks: 900, model: "m", dims: 384, last_build: "x" },
        data: { tables: [] },
      })
    );
    const { checkKnowledgeHealth } = await loadKnowledge();

    const health = await checkKnowledgeHealth();

    expect(health).toEqual({ backend: "brain-api", ok: true, detail: "notes=120 chunks=900" });
    const request = requestOf(fetchMock);
    expect(request.url).toBe("http://127.0.0.1:8790/v1/health");
    expect(request.method).toBe("GET");
    expect(request.headers.Authorization).toBe("Bearer test-token");
  });

  it("logs a failing HEALTH line when the brain API is unreachable", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    const { checkKnowledgeHealth, logKnowledgeHealth } = await loadKnowledge();

    const health = await checkKnowledgeHealth();
    await logKnowledgeHealth();

    expect(health.ok).toBe(false);
    expect(logged(errorSpy)).toContain("[ai-setter][retrieval] HEALTH backend=brain-api ok=false");
  });

  it("logs a passing HEALTH line on success", async () => {
    mockFetch(() => json({ ok: true, index: { notes: 1, chunks: 2 } }));
    const { logKnowledgeHealth } = await loadKnowledge();

    await logKnowledgeHealth();

    expect(logged(logSpy)).toContain("HEALTH backend=brain-api ok=true notes=1 chunks=2");
  });

  it("reports Supabase as configured without a request", async () => {
    delete process.env.SECOND_BRAIN_BACKEND;
    const fetchMock = mockFetch(() => json({}));
    const { checkKnowledgeHealth } = await loadKnowledge();

    expect(await checkKnowledgeHealth()).toEqual({
      backend: "supabase",
      ok: true,
      detail: "configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Supabase path (rollback) visibility", () => {
  it("logs RETRIEVAL_ERROR backend=supabase when the RPC fails", async () => {
    delete process.env.SECOND_BRAIN_BACKEND;
    mockFetch(() => json({ message: "boom" }, 500));
    const { fetchKnowledgeContext } = await loadKnowledge();

    expect(await fetchKnowledgeContext("offer")).toBe("");
    expect(logged(errorSpy)).toContain("RETRIEVAL_ERROR backend=supabase kind=knowledge");
  });
});
