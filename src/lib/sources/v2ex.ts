import type { Candidate } from "@/lib/types";

interface V2ExTopic {
  id: number;
  title: string;
  content?: string;
  url: string;
  replies?: number;
  created: number;
  member?: {
    username?: string;
  };
  node?: {
    name?: string;
    title?: string;
  };
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const userAgent = "helpus-demand-miner/0.1";
  const headers = { "User-Agent": userAgent };

  const [latestResult, hotResult] = await Promise.all([
    fetchEndpoint("https://www.v2ex.com/api/topics/latest.json", headers),
    fetchEndpoint("https://www.v2ex.com/api/topics/hot.json", headers),
  ]);

  const allTopics = [...(latestResult || []), ...(hotResult || [])];

  const seenIds = new Set<string>();
  const candidates: Candidate[] = [];

  for (const topic of allTopics) {
    const candidateId = `v2ex:${topic.id}`;
    if (seenIds.has(candidateId)) continue;
    seenIds.add(candidateId);

    candidates.push({
      id: candidateId,
      source: "v2ex",
      title: topic.title,
      text: topic.content ?? "",
      url: topic.url,
      author: topic.member?.username ?? "",
      score: 0,
      numComments: topic.replies ?? 0,
      createdAt: new Date(topic.created * 1000).toISOString(),
      lang: "zh",
    });
  }

  return candidates;
}

async function fetchEndpoint(
  url: string,
  headers: Record<string, string>
): Promise<V2ExTopic[] | null> {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.warn(`Failed to fetch ${url}: ${response.status}`);
      return null;
    }
    const topics = await response.json();
    return Array.isArray(topics) ? topics : null;
  } catch (error) {
    console.warn(`Error fetching ${url}:`, error);
    return null;
  }
}
