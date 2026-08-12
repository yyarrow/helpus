import type { DemandCard, DemandCluster, ClusterStats } from "@/lib/types";

// Storage: Neon Postgres when DATABASE_URL is set (production on Vercel),
// otherwise a local JSON file under .data/ so the pipeline runs with zero setup in dev.

const LOCAL_FILE = ".data/demands.json";

function usePostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

// ---------- Postgres backend ----------

async function pgClient() {
  const { neon } = await import("@neondatabase/serverless");
  return neon(process.env.DATABASE_URL!);
}

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  const sql = await pgClient();
  await sql`
    CREATE TABLE IF NOT EXISTS demands (
      id text PRIMARY KEY,
      source text NOT NULL,
      url text NOT NULL,
      demand text NOT NULL,
      audience text NOT NULL DEFAULT '',
      scenario text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT '',
      pay_signal text NOT NULL DEFAULT 'none',
      confidence real NOT NULL DEFAULT 0,
      is_demand boolean NOT NULL DEFAULT false,
      raw_title text NOT NULL DEFAULT '',
      score int NOT NULL DEFAULT 0,
      num_comments int NOT NULL DEFAULT 0,
      lang text NOT NULL DEFAULT 'en',
      posted_at timestamptz,
      ingested_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS clusters (
      id text PRIMARY KEY,
      title text NOT NULL,
      summary text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE demands ADD COLUMN IF NOT EXISTS cluster_id text`;
  schemaReady = true;
}

function rowToCard(r: Record<string, unknown>): DemandCard {
  return {
    id: r.id as string,
    source: r.source as DemandCard["source"],
    url: r.url as string,
    demand: r.demand as string,
    audience: r.audience as string,
    scenario: r.scenario as string,
    category: r.category as string,
    paySignal: r.pay_signal as DemandCard["paySignal"],
    confidence: r.confidence as number,
    isDemand: r.is_demand as boolean,
    rawTitle: r.raw_title as string,
    score: r.score as number,
    numComments: r.num_comments as number,
    lang: r.lang as DemandCard["lang"],
    postedAt: new Date(r.posted_at as string).toISOString(),
    ingestedAt: new Date(r.ingested_at as string).toISOString(),
    clusterId: (r.cluster_id as string | null) ?? null,
  };
}

// ---------- Local JSON backend (dev) ----------

async function readLocal(): Promise<DemandCard[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile(LOCAL_FILE, "utf8")) as DemandCard[];
  } catch {
    return [];
  }
}

async function writeLocal(cards: DemandCard[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(".data", { recursive: true });
  await writeFile(LOCAL_FILE, JSON.stringify(cards, null, 2));
}

// ---------- Public API ----------

// Which of these ids have already been processed (classified) before?
export async function getSeenIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    const rows = await sql`SELECT id FROM demands WHERE id = ANY(${ids})`;
    return new Set(rows.map((r) => r.id as string));
  }
  const existing = new Set((await readLocal()).map((c) => c.id));
  return new Set(ids.filter((id) => existing.has(id)));
}

// Insert new cards (ids already present are skipped). Returns inserted count.
export async function saveDemands(cards: DemandCard[]): Promise<number> {
  if (cards.length === 0) return 0;
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    let inserted = 0;
    for (const c of cards) {
      const res = await sql`
        INSERT INTO demands (id, source, url, demand, audience, scenario, category,
          pay_signal, confidence, is_demand, raw_title, score, num_comments, lang,
          posted_at, ingested_at)
        VALUES (${c.id}, ${c.source}, ${c.url}, ${c.demand}, ${c.audience},
          ${c.scenario}, ${c.category}, ${c.paySignal}, ${c.confidence},
          ${c.isDemand}, ${c.rawTitle}, ${c.score}, ${c.numComments}, ${c.lang},
          ${c.postedAt}, ${c.ingestedAt})
        ON CONFLICT (id) DO NOTHING
        RETURNING id`;
      inserted += res.length;
    }
    return inserted;
  }
  const existing = await readLocal();
  const seen = new Set(existing.map((c) => c.id));
  const fresh = cards.filter((c) => !seen.has(c.id));
  if (fresh.length > 0) await writeLocal([...existing, ...fresh]);
  return fresh.length;
}

// ---------- Clustering support ----------

interface LocalClusterFile {
  clusters: DemandCluster[];
}

const LOCAL_CLUSTER_FILE = ".data/clusters.json";

async function readLocalClusters(): Promise<DemandCluster[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const parsed = JSON.parse(await readFile(LOCAL_CLUSTER_FILE, "utf8")) as LocalClusterFile;
    return parsed.clusters ?? [];
  } catch {
    return [];
  }
}

async function writeLocalClusters(clusters: DemandCluster[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(".data", { recursive: true });
  await writeFile(LOCAL_CLUSTER_FILE, JSON.stringify({ clusters }, null, 2));
}

// Demand cards not yet assigned to a cluster, oldest first.
export async function getUnclusteredDemands(limit: number): Promise<DemandCard[]> {
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    const rows = await sql`
      SELECT * FROM demands
      WHERE is_demand = true AND cluster_id IS NULL
      ORDER BY ingested_at ASC
      LIMIT ${limit}`;
    return rows.map(rowToCard);
  }
  return (await readLocal())
    .filter((c) => c.isDemand && !c.clusterId)
    .sort((a, b) => a.ingestedAt.localeCompare(b.ingestedAt))
    .slice(0, limit);
}

// All clusters, compact form for the assignment prompt.
export async function getClusters(): Promise<DemandCluster[]> {
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    const rows = await sql`SELECT * FROM clusters ORDER BY created_at ASC`;
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      summary: r.summary as string,
      category: r.category as string,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date(r.updated_at as string).toISOString(),
    }));
  }
  return readLocalClusters();
}

export async function createCluster(cluster: DemandCluster): Promise<void> {
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    await sql`
      INSERT INTO clusters (id, title, summary, category, created_at, updated_at)
      VALUES (${cluster.id}, ${cluster.title}, ${cluster.summary}, ${cluster.category},
        ${cluster.createdAt}, ${cluster.updatedAt})
      ON CONFLICT (id) DO NOTHING`;
    return;
  }
  const clusters = await readLocalClusters();
  if (!clusters.some((c) => c.id === cluster.id)) {
    await writeLocalClusters([...clusters, cluster]);
  }
}

export async function assignCardsToCluster(cardIds: string[], clusterId: string): Promise<void> {
  if (cardIds.length === 0) return;
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    await sql`UPDATE demands SET cluster_id = ${clusterId} WHERE id = ANY(${cardIds})`;
    await sql`UPDATE clusters SET updated_at = now() WHERE id = ${clusterId}`;
    return;
  }
  const cards = await readLocal();
  const ids = new Set(cardIds);
  await writeLocal(cards.map((c) => (ids.has(c.id) ? { ...c, clusterId } : c)));
}

// Clusters with read-time aggregates, ranked by validation strength:
// distinct sources first, then card count, then recency.
export async function getClusterStats(limit = 100): Promise<ClusterStats[]> {
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    const rows = await sql`
      SELECT c.*,
        count(d.id)::int AS card_count,
        count(DISTINCT d.source)::int AS source_count,
        count(d.id) FILTER (WHERE d.pay_signal = 'strong')::int AS strong_pay_count,
        max(d.ingested_at) AS last_seen_at
      FROM clusters c
      JOIN demands d ON d.cluster_id = c.id
      GROUP BY c.id
      ORDER BY count(DISTINCT d.source) DESC, count(d.id) DESC, max(d.ingested_at) DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      summary: r.summary as string,
      category: r.category as string,
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date(r.updated_at as string).toISOString(),
      cardCount: r.card_count as number,
      sourceCount: r.source_count as number,
      strongPayCount: r.strong_pay_count as number,
      lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
    }));
  }
  const [clusters, cards] = await Promise.all([readLocalClusters(), readLocal()]);
  const stats = clusters
    .map((c) => {
      const members = cards.filter((d) => d.clusterId === c.id && d.isDemand);
      return {
        ...c,
        cardCount: members.length,
        sourceCount: new Set(members.map((m) => m.source)).size,
        strongPayCount: members.filter((m) => m.paySignal === "strong").length,
        lastSeenAt: members.reduce((max, m) => (m.ingestedAt > max ? m.ingestedAt : max), ""),
      };
    })
    .filter((c) => c.cardCount > 0);
  return stats
    .sort(
      (a, b) =>
        b.sourceCount - a.sourceCount ||
        b.cardCount - a.cardCount ||
        b.lastSeenAt.localeCompare(a.lastSeenAt),
    )
    .slice(0, limit);
}

export interface DemandQuery {
  source?: string;
  lang?: string;
  days?: number; // only cards ingested within the last N days
  limit?: number;
}

// Real demands only (isDemand = true), newest engagement first.
export async function getDemands(q: DemandQuery = {}): Promise<DemandCard[]> {
  const limit = q.limit ?? 200;
  if (usePostgres()) {
    await ensureSchema();
    const sql = await pgClient();
    const rows = await sql`
      SELECT * FROM demands
      WHERE is_demand = true
        AND (${q.source ?? null}::text IS NULL OR source = ${q.source ?? null})
        AND (${q.lang ?? null}::text IS NULL OR lang = ${q.lang ?? null})
        AND (${q.days ?? null}::int IS NULL OR ingested_at > now() - make_interval(days => ${q.days ?? null}))
      ORDER BY ingested_at DESC, score DESC
      LIMIT ${limit}`;
    return rows.map(rowToCard);
  }
  let cards = (await readLocal()).filter((c) => c.isDemand);
  if (q.source) cards = cards.filter((c) => c.source === q.source);
  if (q.lang) cards = cards.filter((c) => c.lang === q.lang);
  if (q.days) {
    const cutoff = Date.now() - q.days * 86400_000;
    cards = cards.filter((c) => new Date(c.ingestedAt).getTime() > cutoff);
  }
  return cards
    .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt) || b.score - a.score)
    .slice(0, limit);
}
