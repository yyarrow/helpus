import { generateText, Output } from "ai";
import { z } from "zod";
import type { Candidate, DemandCard } from "@/lib/types";

// LLM stage: turn filtered candidates into normalized demand cards.
// Uses a cheap model through the Vercel AI Gateway. If no gateway credentials
// are available (bare local dev), falls back to pass-through cards so the
// pipeline still runs end-to-end.

const MODEL = process.env.DEMAND_MODEL ?? "anthropic/claude-haiku-4.5";
const BATCH_SIZE = 12;

const itemSchema = z.object({
  id: z.string(),
  isDemand: z
    .boolean()
    .describe("true only if the post expresses a concrete unmet need for a tool/product/service"),
  demand: z
    .string()
    .describe("one-line statement of the need, in the same language as the post; empty if isDemand=false"),
  audience: z.string().describe("who has this need, short phrase"),
  scenario: z.string().describe("when/where the need arises, short phrase"),
  category: z.string().describe("short category, e.g. 'dev tools' / '效率工具'"),
  paySignal: z
    .enum(["none", "weak", "strong"])
    .describe("willingness-to-pay signal expressed in the text"),
  confidence: z.number().min(0).max(1),
});

function hasGatewayCredentials(): boolean {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
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

  const { output } = await generateText({
    model: MODEL,
    output: Output.array({ element: itemSchema }),
    prompt: [
      "You are mining community posts for real product demands (unmet needs someone might build a product for).",
      "For EACH input post below, output exactly one result object with the same id.",
      "Mark isDemand=false for: memes, rants without a concrete need, self-promotion, job posts, news, questions already well-served by existing mainstream tools.",
      "Write `demand` as a crisp one-liner in the SAME language as the post (Chinese post -> Chinese demand).",
      "",
      "Posts:",
      JSON.stringify(input, null, 2),
    ].join("\n"),
  });

  const byId = new Map(output.map((o) => [o.id, o]));
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

  if (!hasGatewayCredentials()) {
    console.warn("classify: no AI gateway credentials, using pass-through cards");
    return candidates.map((c) => passthroughCard(c, now));
  }

  const cards: DemandCard[] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    try {
      cards.push(...(await classifyBatch(batch, now)));
    } catch (err) {
      console.warn(`classify: batch ${i / BATCH_SIZE} failed, passing through`, err);
      cards.push(...batch.map((c) => passthroughCard(c, now)));
    }
  }
  return cards;
}
