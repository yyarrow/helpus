import type { Candidate } from "@/lib/types";

// Demand-native subs (every post is a request) plus small-business / prosumer /
// consumer subs where people ask how to get something done. Dev showcase subs
// like r/SideProject were dropped: almost all "I built X" posts, no demand.
const SUBREDDITS = [
  "SomebodyMakeThis",
  "AppIdeas",
  "Entrepreneur",
  "smallbusiness",
  "Accounting",
  "productivity",
  "weddingplanning",
];
const USER_AGENT = "helpus-demand-miner/0.1";
const CHROME_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
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

function redditAuthHeaders(): Record<string, string> | null | "invalid" {
  const cookiesJson = process.env.REDDIT_COOKIES_JSON;

  if (!cookiesJson || cookiesJson.trim() === "") {
    return null;
  }

  let cookies: unknown;
  try {
    cookies = JSON.parse(cookiesJson);
  } catch {
    return "invalid";
  }

  if (typeof cookies !== "object" || cookies === null || Array.isArray(cookies)) {
    return "invalid";
  }

  const cookiesObj = cookies as Record<string, unknown>;
  for (const value of Object.values(cookiesObj)) {
    if (typeof value !== "string") {
      return "invalid";
    }
  }

  const redditSession = cookiesObj.reddit_session;
  if (typeof redditSession !== "string" || redditSession === "") {
    return "invalid";
  }

  const cookieString = Object.entries(cookiesObj)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  return {
    "User-Agent": CHROME_USER_AGENT,
    "sec-ch-ua": '"Chromium";v="133", "Not(A:Brand";v="99", "Google Chrome";v="133"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": cookieString,
  };
}

async function fetchSubreddit(
  subreddit: string,
  headers: Record<string, string> | null
): Promise<Candidate[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=100&raw_json=1`;
    const fetchHeaders = headers ?? { "User-Agent": USER_AGENT };

    const response = await fetch(url, {
      headers: fetchHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
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
  const authHeaders = redditAuthHeaders();

  if (authHeaders === "invalid") {
    console.warn("REDDIT_COOKIES_JSON is invalid; skipping Reddit");
    return [];
  }

  const results = await Promise.all(
    SUBREDDITS.map((sub) => fetchSubreddit(sub, authHeaders))
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
