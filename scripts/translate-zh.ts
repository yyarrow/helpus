// Translate existing English demand cards and clusters to Simplified Chinese,
// matching what the classify/cluster prompts now produce. Idempotent: only
// rows without any CJK characters are picked up, so re-run to retry failures.
// Backs up the original text to .data/ first.
//
//   npx tsx --env-file=.env.local scripts/translate-zh.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { neon } from "@neondatabase/serverless";
import { extractJson } from "@/lib/json";

const MODEL = process.env.DEMAND_MODEL ?? "google/gemini-3.8-flash";
const BATCH_SIZE = 40;
const NO_CJK = "^[^一-鿿]*$";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = neon(process.env.DATABASE_URL);
const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

type Row = Record<string, string>;

async function translate(rows: Row[], fields: string[]): Promise<Row[]> {
  const { text } = await generateText({
    model: openrouter(MODEL),
    providerOptions: { openrouter: { reasoningEffort: "low" } },
    timeout: 120_000,
    prompt: [
      `Translate the ${fields.join("/")} fields of each item below into natural Simplified Chinese for a Chinese product researcher.`,
      "Keep product names and technical terms like API, MCP, LLM, SDK as-is. Keep empty strings empty. Do not add or drop information.",
      `Respond with ONLY a JSON array, one object per item: {"id": string, ${fields.map((f) => `"${f}": string`).join(", ")}}`,
      "",
      JSON.stringify(rows),
    ].join("\n"),
  });
  const out = extractJson(text);
  if (!Array.isArray(out)) throw new Error("model did not return an array");
  const ids = new Set(rows.map((r) => r.id));
  return (out as Row[]).filter(
    (o) => ids.has(o.id) && fields.every((f) => typeof o[f] === "string") && /[一-鿿]/.test(o[fields[0]]),
  );
}

async function run(label: string, rows: Row[], fields: string[], update: (r: Row) => ReturnType<typeof sql>) {
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    try {
      const translated = await translate(rows.slice(i, i + BATCH_SIZE), fields);
      if (translated.length) await sql.transaction(translated.map(update));
      done += translated.length;
    } catch (err) {
      console.warn(`${label}: batch ${i / BATCH_SIZE} failed (${(err as Error).message}); re-run to retry`);
    }
    console.log(`${label}: ${done}/${rows.length}`);
  }
}

async function main() {
  const cards = (await sql`
    SELECT id, demand, audience, scenario, category FROM demands
    WHERE is_demand AND demand ~ ${NO_CJK} ORDER BY id`) as Row[];
  const clusters = (await sql`
    SELECT id, title, summary, category FROM clusters
    WHERE title ~ ${NO_CJK} ORDER BY id`) as Row[];

  mkdirSync(".data", { recursive: true });
  const backupPath = `.data/en-text-backup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify({ cards, clusters }));
  console.log(`backed up ${cards.length} cards and ${clusters.length} clusters to ${backupPath}`);

  await run("clusters", clusters, ["title", "summary", "category"], (r) =>
    sql`UPDATE clusters SET title = ${r.title}, summary = ${r.summary}, category = ${r.category} WHERE id = ${r.id}`);
  await run("cards", cards, ["demand", "audience", "scenario", "category"], (r) =>
    sql`UPDATE demands SET demand = ${r.demand}, audience = ${r.audience}, scenario = ${r.scenario}, category = ${r.category} WHERE id = ${r.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
