import type { Candidate } from "@/lib/types";

const QUERIES_EN = [
  "how to automate with google sheets",
  "I use a spreadsheet to manage",
  "my workflow using multiple apps",
  "how I track without an app",
  "manual process automation tutorial",
];

const QUERIES_ZH = [
  "用表格管理",
  "手动整理 教程",
  "我的工作流 多个软件",
];

const QUERIES = [...QUERIES_EN, ...QUERIES_ZH];
const API_KEY = process.env.YOUTUBE_API_KEY;

function hasCJK(text: string): boolean {
  return /[一-鿿]/.test(text);
}

function detectLanguage(title: string, queryLang: "en" | "zh"): "en" | "zh" {
  if (queryLang === "zh" || hasCJK(title)) {
    return "zh";
  }
  return "en";
}

async function searchVideos(query: string): Promise<any[]> {
  if (!API_KEY) {
    console.warn("youtube: YOUTUBE_API_KEY not set, skipping search");
    return [];
  }

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const publishedAfter = sevenDaysAgo.toISOString();

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "viewCount");
    url.searchParams.set("maxResults", "25");
    url.searchParams.set("publishedAfter", publishedAfter);
    url.searchParams.set("q", query);
    url.searchParams.set("key", API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(`YouTube search failed for "${query}": ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      queryLang: QUERIES_EN.includes(query) ? "en" : "zh",
    }));
  } catch (error) {
    console.warn(`YouTube search error for "${query}": ${error}`);
    return [];
  }
}

async function getVideoStats(
  videoIds: string[]
): Promise<Map<string, { viewCount: string; commentCount: string }>> {
  if (!API_KEY || videoIds.length === 0) {
    return new Map();
  }

  const stats = new Map<string, { viewCount: string; commentCount: string }>();

  // YouTube API allows up to 50 video IDs per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("part", "statistics,snippet");
      url.searchParams.set("id", batch.join(","));
      url.searchParams.set("key", API_KEY);

      const response = await fetch(url.toString());
      if (!response.ok) {
        console.warn(`YouTube stats fetch failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      for (const item of data.items || []) {
        stats.set(item.id, {
          viewCount: item.statistics.viewCount || "0",
          commentCount: item.statistics.commentCount || "0",
        });
      }
    } catch (error) {
      console.warn(`YouTube stats fetch error: ${error}`);
    }
  }

  return stats;
}

export async function fetchCandidates(): Promise<Candidate[]> {
  if (!API_KEY) {
    console.warn("youtube: YOUTUBE_API_KEY not set, returning empty candidates");
    return [];
  }

  const videoSet = new Map<string, any>();

  // Fetch videos from all queries
  const searchResults = await Promise.all(
    QUERIES.map((query) => searchVideos(query))
  );

  for (const results of searchResults) {
    for (const video of results) {
      if (!videoSet.has(video.videoId)) {
        videoSet.set(video.videoId, video);
      }
    }
  }

  const videoIds = Array.from(videoSet.keys());
  const stats = await getVideoStats(videoIds);

  const candidates: Candidate[] = [];
  for (const [videoId, video] of videoSet) {
    const stat = stats.get(videoId);
    const viewCount = Number(stat?.viewCount || "0");
    const commentCount = Number(stat?.commentCount || "0");

    // Drop videos with < 1000 views
    if (viewCount < 1000) {
      continue;
    }

    const lang = detectLanguage(video.title, video.queryLang);
    const textContent = video.description.slice(0, 500);

    candidates.push({
      id: `youtube:${videoId}`,
      source: "youtube",
      title: video.title,
      text: textContent,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: video.channelTitle,
      score: Math.min(viewCount, 1000000),
      numComments: commentCount,
      createdAt: video.publishedAt,
      lang,
    });
  }

  return candidates;
}
