import type { Candidate } from "@/lib/types";

// Business owners are the audience most willing to pay. Subs were picked by a
// 2026-10-06 probe (48h of posts each through the classifier); see
// docs/signal-roadmap.md. Which of these skip the regex filter is decided in
// filter.ts. Dropped: r/SideProject ("I built X" showcases), r/productivity
// (venting), and restaurant / salon / food-truck subs (no demand found).
const SUBREDDITS = [
  "SomebodyMakeThis",
  "AppIdeas",
  "Entrepreneur",
  "smallbusiness",
  "Accounting",
  "weddingplanning",
  "shopify",
  "printondemand",
  "ecommerce",
  "FulfillmentByAmazon",
  "Flipping",
  "Contractor",
  "electricians",
  "PropertyManagement",
  "msp",
  "WeddingPhotography",
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

// Parses a cookie name -> value JSON map (must include reddit_session) into
// browser-like request headers. null = no cookies configured (anonymous).
export function cookieHeaders(cookiesJson: string | undefined | null): Record<string, string> | null | "invalid" {
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

// Turns what an admin pastes from DevTools — the bare value or
// "reddit_session=<value>" — into the cookie JSON map. null if malformed.
export function sessionCookiesJson(input: string): string | null {
  const value = input.trim().replace(/^reddit_session=/, "").replace(/;$/, "").trim();
  if (!value || /[\s;]/.test(value)) return null;
  return JSON.stringify({ reddit_session: value });
}

export type CookieSource = "db" | "env" | "none";

// The cookie set from /admin wins over the REDDIT_COOKIES_JSON env var.
export async function currentCookies(): Promise<{ json: string | undefined; source: CookieSource }> {
  if (process.env.DATABASE_URL) {
    try {
      const { getSetting, SETTINGS } = await import("@/lib/settings");
      const setting = await getSetting(SETTINGS.redditCookies);
      if (setting) return { json: setting.value, source: "db" };
    } catch (error) {
      console.warn(`Reading Reddit cookie setting failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  const env = process.env.REDDIT_COOKIES_JSON;
  return env?.trim() ? { json: env, source: "env" } : { json: undefined, source: "none" };
}

// One cheap request to check whether Reddit accepts these cookies.
// Returns the HTTP status, or 0 for a network error.
export async function probeCookies(cookiesJson: string): Promise<number> {
  const headers = cookieHeaders(cookiesJson);
  if (!headers || headers === "invalid") return 0;
  try {
    const response = await fetch("https://www.reddit.com/r/smallbusiness/new.json?limit=1&raw_json=1", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

export interface RedditFetchReport {
  at: string;
  auth: CookieSource;
  candidates: number;
  okSubreddits: number;
  totalSubreddits: number;
  // subreddit -> HTTP status (0 = network error / bad response)
  failed: Record<string, number>;
}

interface SubredditResult {
  candidates: Candidate[];
  status: number;
}

async function fetchSubreddit(
  subreddit: string,
  headers: Record<string, string> | null
): Promise<SubredditResult> {
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
      return { candidates: [], status: response.status };
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

    return { candidates, status: response.status };
  } catch (error) {
    console.warn(`Error fetching r/${subreddit}:`, error);
    return { candidates: [], status: 0 };
  }
}

async function saveReport(report: RedditFetchReport) {
  if (!process.env.DATABASE_URL) return;
  try {
    const { setSetting, SETTINGS } = await import("@/lib/settings");
    await setSetting(SETTINGS.redditLastFetch, JSON.stringify(report));
  } catch (error) {
    console.warn(`Saving Reddit fetch report failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const cookies = await currentCookies();
  const authHeaders = cookieHeaders(cookies.json);

  if (authHeaders === "invalid") {
    console.warn(`Reddit cookies from ${cookies.source} are invalid; skipping Reddit`);
    return [];
  }

  const results = await Promise.all(
    SUBREDDITS.map((sub) => fetchSubreddit(sub, authHeaders))
  );

  const allCandidates = results.flatMap((r) => r.candidates);

  const seen = new Set<string>();
  const deduped: Candidate[] = [];

  for (const candidate of allCandidates) {
    if (!seen.has(candidate.id)) {
      seen.add(candidate.id);
      deduped.push(candidate);
    }
  }

  const failed: Record<string, number> = {};
  results.forEach((r, i) => {
    if (r.status !== 200) failed[SUBREDDITS[i]] = r.status;
  });
  await saveReport({
    at: new Date().toISOString(),
    auth: cookies.source,
    candidates: deduped.length,
    okSubreddits: SUBREDDITS.length - Object.keys(failed).length,
    totalSubreddits: SUBREDDITS.length,
    failed,
  });

  return deduped;
}
