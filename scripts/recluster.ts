// Wipe all clusters and re-cluster every demand card with the current prompt.
// Run after changing clustering granularity. Backs up the old assignment first.
//
//   npx tsx --env-file=.env.local scripts/recluster.ts --yes
import { mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { clusterNewDemands } from "@/lib/cluster";

if (!process.argv.includes("--yes")) {
  console.error("This deletes every cluster in DATABASE_URL. Re-run with --yes.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const backup = {
    clusters: await sql`SELECT * FROM clusters`,
    assignments: await sql`SELECT id, cluster_id FROM demands WHERE cluster_id IS NOT NULL`,
  };
  mkdirSync(".data", { recursive: true });
  const backupPath = `.data/clusters-backup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(backup));
  console.log(`backed up ${backup.clusters.length} clusters to ${backupPath}`);

  await sql.transaction([
    sql`UPDATE demands SET cluster_id = NULL WHERE cluster_id IS NOT NULL`,
    sql`DELETE FROM clusters`,
  ]);

  for (let round = 1; ; round++) {
    const stats = await clusterNewDemands();
    console.log(`round ${round}: processed ${stats.processed}, assigned ${stats.assigned}`);
    if (stats.processed === 0 || stats.assigned === 0) break;
  }

  const [{ clusters, cards }] = await sql`
    SELECT (SELECT count(*) FROM clusters)::int AS clusters,
           (SELECT count(*) FROM demands WHERE cluster_id IS NOT NULL)::int AS cards`;
  console.log(`done: ${cards} cards in ${clusters} clusters`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
