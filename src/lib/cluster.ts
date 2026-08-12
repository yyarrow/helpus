import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { extractJson } from "@/lib/json";
import {
  assignCardsToCluster,
  createCluster,
  getClusters,
  getUnclusteredDemands,
} from "@/lib/store";
import type { DemandCard, DemandCluster } from "@/lib/types";

// Clustering stage: group demand cards that express the same underlying need.
// Incremental LLM assignment — no embeddings needed at the current scale
// (hundreds of cards); revisit with pgvector if cards grow past a few thousand.

const MODEL = process.env.CLUSTER_MODEL ?? "deepseek/deepseek-v4-flash-0731";
const BATCH_SIZE = 20;
// Safety valve: one run never processes more than this many cards.
const MAX_CARDS_PER_RUN = 300;

const openrouter = createOpenAICompatible({
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

const assignmentSchema = z.object({
  cardId: z.string(),
  clusterId: z.string().nullish(),
  newCluster: z
    .object({
      title: z.string(),
      summary: z
        .string()
        .nullish()
        .transform((v) => v ?? ""),
      category: z
        .string()
        .nullish()
        .transform((v) => v ?? ""),
    })
    .nullish(),
});

function parseAssignments(text: string) {
  const raw = extractJson(text);
  const arr = Array.isArray(raw)
    ? raw
    : (Object.values(raw as Record<string, unknown>).find(Array.isArray) as unknown[]);
  if (!Array.isArray(arr)) throw new Error("no JSON array in model response");
  return arr
    .map((el) => assignmentSchema.safeParse(el))
    .filter((r) => r.success)
    .map((r) => r.data);
}

function newClusterId(): string {
  return `cl_${Math.random().toString(36).slice(2, 10)}`;
}

async function clusterBatch(batch: DemandCard[], clusters: DemandCluster[]): Promise<number> {
  const clusterList = clusters.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary,
  }));
  const cardList = batch.map((c) => ({
    id: c.id,
    demand: c.demand,
    audience: c.audience,
    category: c.category,
    lang: c.lang,
  }));

  const { text } = await generateText({
    model: openrouter(MODEL),
    prompt: [
      "You are grouping product-demand cards into clusters. Two cards belong to the same cluster only if they express the SAME underlying need (same job to be done), not merely the same broad category.",
      "Cards in different languages CAN share a cluster when the need is the same.",
      "For EACH card below, either assign an existing cluster id, or propose a new cluster.",
      "New cluster titles: short noun phrase naming the need. Write title/summary in English unless the need is specific to the Chinese market, then use Chinese.",
      "",
      "Respond with ONLY a JSON array, one object per card:",
      '{"cardId": string, "clusterId": string | null, "newCluster": {"title": string, "summary": string, "category": string} | null}',
      "Set clusterId for an existing cluster (and newCluster to null), OR set newCluster (and clusterId to null). Never both.",
      "clusterId MUST be copied verbatim from the existing clusters list below — never invent one. If several cards in this batch share the same NEW need, repeat the identical newCluster (exact same title) for each of them.",
      "",
      "Existing clusters:",
      JSON.stringify(clusterList, null, 2),
      "",
      "Cards:",
      JSON.stringify(cardList, null, 2),
    ].join("\n"),
  });

  const known = new Set(clusters.map((c) => c.id));
  const now = new Date().toISOString();
  // clusterId -> cardIds, resolving proposed clusters to real ids as we go.
  const assignments = new Map<string, string[]>();
  // Reuse identical proposed titles within the batch so the model proposing
  // the same new cluster for several cards yields one cluster, not many.
  const proposedByTitle = new Map<string, string>();
  let created = 0;

  for (const a of parseAssignments(text)) {
    if (!batch.some((c) => c.id === a.cardId)) continue;
    let target: string | undefined;
    if (a.clusterId && known.has(a.clusterId)) {
      target = a.clusterId;
    } else if (a.newCluster?.title) {
      const titleKey = a.newCluster.title.trim().toLowerCase();
      target = proposedByTitle.get(titleKey);
      if (!target) {
        target = newClusterId();
        const cluster: DemandCluster = {
          id: target,
          title: a.newCluster.title.trim(),
          summary: a.newCluster.summary,
          category: a.newCluster.category,
          createdAt: now,
          updatedAt: now,
        };
        await createCluster(cluster);
        clusters.push(cluster); // visible to subsequent batches
        proposedByTitle.set(titleKey, target);
        created++;
      }
    }
    // Neither a valid existing id nor a usable proposal: leave the card
    // unclustered; the next run will retry it.
    if (!target) continue;
    assignments.set(target, [...(assignments.get(target) ?? []), a.cardId]);
  }

  let assigned = 0;
  for (const [clusterId, cardIds] of assignments) {
    await assignCardsToCluster(cardIds, clusterId);
    assigned += cardIds.length;
  }
  console.log(`cluster: batch assigned ${assigned}/${batch.length} cards, ${created} new clusters`);
  return assigned;
}

export interface ClusterStageStats {
  processed: number;
  assigned: number;
}

export async function clusterNewDemands(): Promise<ClusterStageStats> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("cluster: OPENROUTER_API_KEY not set, skipping clustering");
    return { processed: 0, assigned: 0 };
  }

  const pending = await getUnclusteredDemands(MAX_CARDS_PER_RUN);
  if (pending.length === 0) return { processed: 0, assigned: 0 };

  const clusters = await getClusters();
  let assigned = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      assigned += await clusterBatch(batch, clusters);
    } catch (err) {
      // Skip the failed batch; those cards stay unclustered and are retried
      // on the next run.
      console.warn(`cluster: batch ${i / BATCH_SIZE} failed`, err);
    }
  }
  return { processed: pending.length, assigned };
}
