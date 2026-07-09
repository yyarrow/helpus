import type { DemandCard } from "@/lib/types";

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
