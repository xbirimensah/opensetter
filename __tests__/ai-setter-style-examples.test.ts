/**
 * Style index retrieval - cross-contact privacy regression tests
 *
 * The style index is shared across every contact, so whatever it returns
 * lands in prompts for OTHER prospects. Only the operator's own redacted,
 * human-typed outbound text may reach the prompt; the prospect message it
 * originally answered must never be rendered or sent to the model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: async () => async () => ({ data: new Float32Array(384).fill(0.01) }),
}));
vi.mock("../lib/ai-setter/knowledge-local", () => ({
  isLocalKnowledgeAvailable: () => false,
  fetchLocalKnowledgeContext: async () => "",
}));

import { fetchStyleExamples } from "../lib/ai-setter/knowledge";

const PROSPECT_TEXT =
  "hey ich bin Jana, meine nummer ist +49 151 23456789 und mail jana.private@example.com";

function mockRpcRows(rows: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.SECOND_BRAIN_SUPABASE_URL = "https://brain.example.supabase.co";
  process.env.SECOND_BRAIN_SUPABASE_SERVICE_ROLE_KEY = "service-role";
  delete process.env.AI_SETTER_EMBEDDINGS;
});

afterEach(() => {
  process.env = savedEnv;
  vi.unstubAllGlobals();
});

describe("fetchStyleExamples", () => {
  it("never renders the unrelated prospect's incoming text", async () => {
    mockRpcRows([
      {
        incoming_text: PROSPECT_TEXT,
        outgoing_text: "ja easy, schick mir kurz wann du kannst",
        language: "de",
        chat_kind: "direct",
        similarity: 0.91,
      },
    ]);

    const block = await fetchStyleExamples("wann hast du zeit?");

    expect(block).not.toContain("Incoming");
    expect(block).not.toContain("Jana");
    expect(block).not.toContain("23456789");
    expect(block).not.toContain("jana.private@example.com");
    expect(block).toContain("ja easy, schick mir kurz wann du kannst");
  });

  it("redacts contact details inside the operator's own outbound text", async () => {
    mockRpcRows([
      {
        incoming_text: "x",
        outgoing_text: "schreib mir an coach@example.com oder +49 170 1234567, @jana_fit hat das auch",
        language: "de",
      },
    ]);

    const block = await fetchStyleExamples("wie erreiche ich dich");

    expect(block).not.toContain("coach@example.com");
    expect(block).not.toContain("1234567");
    expect(block).not.toContain("@jana_fit");
    expect(block).toContain("[email]");
    expect(block).toContain("[phone]");
    expect(block).toContain("[handle]");
  });

  it("keeps an outbound example even when the stored incoming side is empty", async () => {
    mockRpcRows([{ incoming_text: "", outgoing_text: "safe, meld dich einfach", language: "de" }]);
    const block = await fetchStyleExamples("ok danke");
    expect(block).toContain("safe, meld dich einfach");
  });

  it("drops rows without operator text instead of falling back to the incoming side", async () => {
    mockRpcRows([{ incoming_text: PROSPECT_TEXT, outgoing_text: "   " }]);
    expect(await fetchStyleExamples("hi")).toBe("");
  });

  it("drops automation-authored replies such as tracked campaign links", async () => {
    mockRpcRows([
      { incoming_text: "link?", outgoing_text: "hier ist dein guide: https://app.example.com/r/abc123XYZ" },
      { incoming_text: "danke", outgoing_text: "gerne, sag bescheid wie es läuft" },
    ]);
    const block = await fetchStyleExamples("danke dir");
    expect(block).not.toContain("guide");
    expect(block).toContain("gerne, sag bescheid wie es läuft");
  });

  it("drops rows the index marked sensitive or ineligible", async () => {
    mockRpcRows([
      { outgoing_text: "das bleibt privat", is_sensitive: true },
      { outgoing_text: "das auch", eligible_for_retrieval: false },
    ]);
    expect(await fetchStyleExamples("hi")).toBe("");
  });

  it("renders only safe metadata alongside the operator's words", async () => {
    mockRpcRows([
      {
        incoming_text: PROSPECT_TEXT,
        outgoing_text: "yo, klingt gut",
        language: "de",
        chat_kind: "direct",
        similarity: 0.88,
        source_message_id: "mid.SECRET123",
        contact_name: "Jana Private",
      },
    ]);

    const block = await fetchStyleExamples("klingt gut");
    const lines = block.split("\n");

    expect(lines[0]).toMatch(/STYLE EXAMPLES/);
    expect(lines.slice(1)).toEqual(["- You wrote (de): yo, klingt gut"]);
    expect(block).not.toContain("mid.SECRET123");
    expect(block).not.toContain("Jana Private");
    expect(block).not.toContain("0.88");
  });

  it("does not forward stored incoming text anywhere in the RPC request", async () => {
    const fetchMock = mockRpcRows([]);
    await fetchStyleExamples("wann hast du zeit?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(
      ["filter_chat_kind", "filter_language", "match_count", "query_embedding"].sort()
    );
  });
});
