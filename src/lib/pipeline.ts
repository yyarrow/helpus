import { filterCandidates } from "@/lib/filter";
import { classifyCandidates } from "@/lib/classify";
import { clusterNewDemands } from "@/lib/cluster";
import { getSeenIds, saveDemands } from "@/lib/store";
import type { Candidate } from "@/lib/types";

export interface IngestStats {
  fetched: number;
  matchedSignal: number;
  newCandidates: number;
  classified: number;
  savedDemands: number;
  clustered: number;
  bySource: Record<string, number>;
}

export async function runIngest(): Promise<IngestStats> {
  const sources = await Promise.all([
    import("@/lib/sources/hn"),
    import("@/lib/sources/reddit"),
    import("@/lib/sources/v2ex"),
    import("@/lib/sources/github"),
  ]);

  const results = await Promise.all(sources.map((s) => s.fetchCandidates()));
  const all: Candidate[] = results.flat();

  const bySource: Record<string, number> = {};
  for (const c of all) bySource[c.source] = (bySource[c.source] ?? 0) + 1;

  const matched = filterCandidates(all);
  const seen = await getSeenIds(matched.map((c) => c.id));
  const fresh = matched.filter((c) => !seen.has(c.id));

  const cards = await classifyCandidates(fresh);
  await saveDemands(cards);
  // Cluster whatever is pending (this run's cards plus any backlog from
  // previously failed batches).
  const clusterStats = await clusterNewDemands();

  return {
    fetched: all.length,
    matchedSignal: matched.length,
    newCandidates: fresh.length,
    classified: cards.length,
    savedDemands: cards.filter((c) => c.isDemand).length,
    clustered: clusterStats.assigned,
    bySource,
  };
}
