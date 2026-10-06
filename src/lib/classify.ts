import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { Candidate, DemandCard } from "@/lib/types";

// LLM stage: turn filtered candidates into normalized demand cards.
// Uses a cheap model through OpenRouter (OPENROUTER_API_KEY). If the key is
// missing, falls back to pass-through cards so the pipeline still runs
// end-to-end.

const MODEL = process.env.DEMAND_MODEL ?? "deepseek/deepseek-v4.1-flash";
const BATCH_SIZE = 12;

const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

// Lenient by design: models (esp. via OpenRouter) drop or null fields freely,
// so everything except id gets a fallback instead of failing the batch.
const itemSchema = z.object({
  id: z.string(),
  isDemand: z.boolean().catch(false),
  demand: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  audience: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  scenario: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  category: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  paySignal: z.enum(["none", "weak", "strong"]).catch("none"),
  confidence: z.number().min(0).max(1).catch(0.5),
});

type Item = z.infer<typeof itemSchema>;

// Accept a bare JSON array, a fenced ```json block, or an object wrapping the
// array under a common key — with or without trailing prose after the JSON.
function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/g, "").trim();
  const start = unfenced.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in model response");
  const attempts = [
    unfenced.slice(start),
    unfenced.slice(start, unfenced.lastIndexOf("]") + 1),
    unfenced.slice(start, unfenced.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next, shorter slice
    }
  }
  throw new Error("unparseable JSON in model response");
}

function parseItems(text: string): Item[] {
  const raw = extractJson(text);
  const arr = Array.isArray(raw)
    ? raw
    : (Object.values(raw as Record<string, unknown>).find(Array.isArray) as unknown[]);
  if (!Array.isArray(arr)) throw new Error("no JSON array in model response");
  return arr
    .map((el) => itemSchema.safeParse(el))
    .filter((r) => r.success)
    .map((r) => r.data);
}

function hasCredentials(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function passthroughCard(c: Candidate, now: string): DemandCard {
  return {
    id: c.id,
    source: c.source,
    url: c.url,
    demand: c.title || c.text.slice(0, 120),
    audience: "",
    scenario: "",
    category: "unclassified",
    paySignal: "none",
    confidence: 0.3,
    isDemand: true,
    rawTitle: c.title,
    score: c.score,
    numComments: c.numComments,
    lang: c.lang,
    postedAt: c.createdAt,
    ingestedAt: now,
  };
}

async function classifyBatch(batch: Candidate[], now: string): Promise<DemandCard[]> {
  const input = batch.map((c) => ({
    id: c.id,
    lang: c.lang,
    title: c.title,
    text: c.text.slice(0, 800),
    score: c.score,
    numComments: c.numComments,
  }));

  const { text } = await generateText({
    model: openrouter(MODEL),
    // Default effort is 3-4x slower; ingest must fit in 300s.
    providerOptions: { openrouter: { reasoningEffort: "low" } },
    prompt: [
      "You are mining community posts for real product demands (unmet needs someone might build a product for).",
      "For EACH input post below, output exactly one result object with the same id.",
      "Mark isDemand=false for: memes, rants without a concrete need, self-promotion, job posts, news, questions already well-served by existing mainstream tools.",
      "Workaround-tutorial posts (someone demonstrating how they accomplish a task by cobbling together spreadsheets or multiple apps) DO indicate a real unmet need: set isDemand=true and write `demand` as the underlying product need being worked around, not a description of the tutorial.",
      "Write `demand` as a crisp one-liner in the SAME language as the post (Chinese post -> Chinese demand).",
      "",
      "Respond with ONLY a JSON array (no prose, no markdown fences). One object per post:",
      '{"id": string, "isDemand": boolean, "demand": string, "audience": string, "scenario": string, "category": string, "paySignal": "none"|"weak"|"strong", "confidence": number 0-1}',
      'Use empty strings for demand/audience/scenario/category when isDemand=false. `category` is a short label like "dev tools" / "效率工具".',
      "",
      "Posts:",
      JSON.stringify(input, null, 2),
    ].join("\n"),
  });

  const byId = new Map(parseItems(text).map((o) => [o.id, o]));
  return batch.map((c) => {
    const o = byId.get(c.id);
    if (!o) return { ...passthroughCard(c, now), confidence: 0.1 };
    return {
      id: c.id,
      source: c.source,
      url: c.url,
      demand: o.demand,
      audience: o.audience,
      scenario: o.scenario,
      category: o.category,
      paySignal: o.paySignal,
      confidence: o.confidence,
      isDemand: o.isDemand,
      rawTitle: c.title,
      score: c.score,
      numComments: c.numComments,
      lang: c.lang,
      postedAt: c.createdAt,
      ingestedAt: now,
    };
  });
}

export async function classifyCandidates(candidates: Candidate[]): Promise<DemandCard[]> {
  const now = new Date().toISOString();
  if (candidates.length === 0) return [];

  if (!hasCredentials()) {
    console.warn("classify: OPENROUTER_API_KEY not set, using pass-through cards");
    return candidates.map((c) => passthroughCard(c, now));
  }

  const cards: DemandCard[] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        cards.push(...(await classifyBatch(batch, now)));
        done = true;
      } catch (err) {
        console.warn(`classify: batch ${i / BATCH_SIZE} attempt ${attempt + 1} failed`, err);
      }
    }
    if (!done) {
      console.warn(`classify: batch ${i / BATCH_SIZE} exhausted retries, passing through`);
      cards.push(...batch.map((c) => passthroughCard(c, now)));
    }
  }
  return cards;
}
