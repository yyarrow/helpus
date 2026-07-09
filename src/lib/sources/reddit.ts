import type { Candidate } from "@/lib/types";

const SUBREDDITS = ["SomebodyMakeThis", "AppIdeas", "SideProject", "Entrepreneur"];
const USER_AGENT = "helpus-demand-miner/0.1";
const HOURS_48 = 48 * 60 * 60 * 1000;

interface RedditChild {
  kind: string;
  data: {
    id: string;
    title: string;
    selftext?: string;
    permalink: string;
    author?: string;
    score?: number;
    num_comments?: number;
    created_utc: number;
    stickied: boolean;
    over_18: boolean;
  };
}

interface RedditListing {
  data: {
    children: RedditChild[];
  };
}

async function fetchSubreddit(subreddit: string): Promise<Candidate[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=50&raw_json=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch r/${subreddit}: ${response.status}`);
      return [];
    }

    const listing: RedditListing = await response.json();
    const now = Date.now();
    const candidates: Candidate[] = [];

    for (const child of listing.data.children) {
      if (child.kind !== "t3") continue;

      const data = child.data;

      if (data.stickied || data.over_18) continue;

      const createdAt = new Date(data.created_utc * 1000);
      if (now - createdAt.getTime() > HOURS_48) continue;

      candidates.push({
        id: `reddit:${data.id}`,
        source: "reddit",
        title: data.title,
        text: data.selftext ?? "",
        url: `https://www.reddit.com${data.permalink}`,
        author: data.author ?? "",
        score: data.score ?? 0,
        numComments: data.num_comments ?? 0,
        createdAt: createdAt.toISOString(),
        lang: "en",
      });
    }

    return candidates;
  } catch (error) {
    console.warn(`Error fetching r/${subreddit}:`, error);
    return [];
  }
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const results = await Promise.all(
    SUBREDDITS.map((sub) => fetchSubreddit(sub))
  );

  const allCandidates = results.flat();

  const seen = new Set<string>();
  const deduped: Candidate[] = [];

  for (const candidate of allCandidates) {
    if (!seen.has(candidate.id)) {
      seen.add(candidate.id);
      deduped.push(candidate);
    }
  }

  return deduped;
}
