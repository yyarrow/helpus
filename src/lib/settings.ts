// Runtime-editable settings (e.g. the Reddit cookie set from /admin), so a
// rotated secret doesn't need an env change and redeploy. Postgres only:
// without DATABASE_URL reads return null and writes throw.

export const SETTINGS = {
  // JSON cookie name -> value map, same format as REDDIT_COOKIES_JSON.
  redditCookies: "reddit_cookies",
  // JSON RedditFetchReport from the latest ingest, shown on /admin.
  redditLastFetch: "reddit_last_fetch",
} as const;

export interface Setting {
  value: string;
  updatedAt: string;
}

async function pgClient() {
  const { neon } = await import("@neondatabase/serverless");
  return neon(process.env.DATABASE_URL!);
}

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  const sql = await pgClient();
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  tableReady = true;
}

export async function getSetting(key: string): Promise<Setting | null> {
  if (!process.env.DATABASE_URL) return null;
  await ensureTable();
  const sql = await pgClient();
  const rows = await sql`SELECT value, updated_at FROM settings WHERE key = ${key}`;
  if (rows.length === 0) return null;
  return {
    value: rows[0].value as string,
    updatedAt: new Date(rows[0].updated_at as string).toISOString(),
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  await ensureTable();
  const sql = await pgClient();
  await sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
