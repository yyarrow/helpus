// Core data shapes shared by all pipeline stages.

export type SourceId = "hn" | "reddit" | "v2ex" | "github";

// A raw post/comment pulled from a source, before any filtering.
export interface Candidate {
  id: string; // globally unique: `${source}:${originalId}`
  source: SourceId;
  title: string;
  text: string; // body/content, plain text, may be empty
  url: string; // permalink to the original post
  author: string;
  score: number; // upvotes/points/likes, 0 if unknown
  numComments: number; // 0 if unknown
  createdAt: string; // ISO 8601
  lang: "zh" | "en";
}

// A group of demand cards expressing the same underlying need.
// Cross-source recurrence is the strongest validation signal we have.
export interface DemandCluster {
  id: string; // cl_<random>
  title: string; // short name of the underlying need
  summary: string; // 1-2 sentences
  category: string;
  createdAt: string;
  updatedAt: string;
}

// Cluster plus read-time aggregates for ranking on the dashboard.
export interface ClusterStats extends DemandCluster {
  cardCount: number;
  sourceCount: number; // distinct sources — the key validation signal
  strongPayCount: number;
  lastSeenAt: string; // newest member card's ingestedAt
}

// A normalized demand extracted from a candidate by the LLM.
export interface DemandCard {
  id: string; // same as candidate id
  source: SourceId;
  url: string;
  demand: string; // one-line statement of the need, in the candidate's language
  audience: string; // who has this need
  scenario: string; // when/where the need arises
  category: string; // short free-form category, e.g. "开发工具" / "productivity"
  paySignal: "none" | "weak" | "strong"; // willingness-to-pay signal in the text
  confidence: number; // 0-1, how confident the LLM is this is a real demand
  isDemand: boolean; // false => discarded by LLM as noise
  rawTitle: string;
  score: number; // engagement score carried over from candidate
  numComments: number;
  lang: "zh" | "en";
  postedAt: string; // candidate createdAt
  ingestedAt: string; // when we processed it
  clusterId?: string | null; // set by the clustering stage, null until assigned
}
