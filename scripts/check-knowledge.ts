/**
 * Retrieval smoke check for the AI setter's second brain.
 *
 * Runs the same knowledge and style lookups the worker runs, against
 * whatever SECOND_BRAIN_BACKEND selects, and prints the backend, its
 * health, and how many items came back. Exits 1 when the backend is
 * unhealthy or either lookup returns nothing, so it doubles as the
 * cutover gate.
 *
 * Usage (env from the worker's .env):
 *   set -a && source .env && set +a && npm run knowledge:check -- "some query"
 *   ... npm run knowledge:check -- --show "some query"   (also print the blocks)
 */

import {
  checkKnowledgeHealth,
  fetchKnowledgeContext,
  fetchStyleExamples,
} from "../lib/ai-setter/knowledge";

const DEFAULT_QUERY = "wann hast du zeit für einen kurzen call?";

/** Rendered blocks are a label line plus one "- " line per item. */
function countItems(block: string): number {
  return block.split("\n").filter((line) => line.startsWith("- ")).length;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const query =
    args.filter((arg) => arg !== "--show").join(" ").trim() || DEFAULT_QUERY;

  const health = await checkKnowledgeHealth();
  console.log(
    `backend=${health.backend ?? "none"} health_ok=${health.ok} ${health.detail}`
  );

  const knowledge = await fetchKnowledgeContext(query);
  const style = await fetchStyleExamples(query);
  const knowledgeItems = countItems(knowledge);
  const styleItems = countItems(style);
  console.log(`knowledge_items=${knowledgeItems} style_examples=${styleItems}`);

  if (show) {
    console.log(`\n${knowledge || "(no knowledge block)"}\n\n${style || "(no style block)"}`);
  }

  const passed = health.ok && knowledgeItems > 0 && styleItems > 0;
  console.log(passed ? "PASS" : "FAIL");
  return passed ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
