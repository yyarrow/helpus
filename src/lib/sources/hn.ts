import type { Candidate } from "@/lib/types";

const PHRASES = [
  "I wish there was",
  "is there a tool",
  "why is there no",
  "looking for a tool",
  "does anyone know a tool",
];

function getCutoffTime(): number {
  const now = Date.now();
  const fortyEightHours = 48 * 60 * 60 * 1000;
  return Math.floor((now - fortyEightHours) / 1000);
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(str: string): string {
  const entities: Record<string, string> = {
    "&#x27;": "'",
    "&#39;": "'",
    "&quot;": '"',
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
  };
  return str.replace(/&#x27;|&#39;|&quot;|&lt;|&gt;|&amp;/g, (m) => entities[m]);
}

async function fetchHNData(url: string): Promise<any[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`HN fetch failed: ${response.status} ${url}`);
      return [];
    }
    const data = await response.json();
    return data.hits || [];
  } catch (error) {
    console.warn(`HN fetch error: ${error}`);
    return [];
  }
}

function mapToCandidates(hits: any[]): Candidate[] {
  return hits.map((hit) => ({
    id: `hn:${hit.objectID}`,
    source: "hn",
    title: hit.title ?? "",
    text: decodeHtmlEntities(stripHtmlTags(hit.story_text ?? hit.comment_text ?? "")),
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author ?? "",
    score: hit.points ?? 0,
    numComments: hit.num_comments ?? 0,
    createdAt: hit.created_at,
    lang: "en",
  }));
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const cutoff = getCutoffTime();
  const candidates = new Map<string, Candidate>();

  // Fetch Ask HN stories
  const askHNUrl = `https://hn.algolia.com/api/v1/search_by_date?tags=ask_hn&hitsPerPage=100&numericFilters=created_at_i>${cutoff}`;
  const askHNHits = await fetchHNData(askHNUrl);
  mapToCandidates(askHNHits).forEach((c) => candidates.set(c.id, c));

  // Fetch phrase searches in parallel
  const phraseUrls = PHRASES.map(
    (phrase) =>
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(
        phrase
      )}&tags=(story,comment)&hitsPerPage=50&numericFilters=created_at_i>${cutoff}`
  );

  const phraseResults = await Promise.all(phraseUrls.map(fetchHNData));
  phraseResults.forEach((hits) => {
    mapToCandidates(hits).forEach((c) => candidates.set(c.id, c));
  });

  return Array.from(candidates.values());
}
