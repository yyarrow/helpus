import type { Candidate } from "@/lib/types";

interface GitHubIssue {
  id: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  reactions: { total_count: number } | null;
  comments: number;
  created_at: string;
  pull_request?: unknown;
}

interface GitHubSearchResponse {
  items: GitHubIssue[];
}

export async function fetchCandidates(): Promise<Candidate[]> {
  try {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    const dateStr = date.toISOString().split("T")[0];

    const q = `"feature request" in:title is:issue is:open created:>${dateStr}`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=50`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "helpus-demand-miner/0.1",
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.warn(`GitHub API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as GitHubSearchResponse;

    return data.items
      .filter((item) => !item.pull_request)
      .map((item): Candidate => ({
        id: `github:${item.id}`,
        source: "github",
        title: item.title,
        text: (item.body ?? "").slice(0, 2000),
        url: item.html_url,
        author: item.user?.login ?? "",
        score: item.reactions?.total_count ?? 0,
        numComments: item.comments,
        createdAt: item.created_at,
        lang: "en",
      }));
  } catch (error) {
    console.warn("Failed to fetch GitHub candidates:", error);
    return [];
  }
}
