import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { fetchCandidates } from "../src/lib/sources/reddit.ts";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const subreddits = ["SomebodyMakeThis", "AppIdeas", "SideProject", "Entrepreneur"];
const post = (overrides = {}) => ({
  kind: "t3",
  data: {
    id: "demo", title: "I wish this existed", selftext: "A repeated manual task",
    permalink: "/r/AppIdeas/comments/demo/test/", author: "reader", score: 7,
    num_comments: 3, created_utc: Date.now() / 1000, stickied: false,
    over_18: false, ...overrides,
  },
});
const listing = (children) => Response.json({ data: { children } });

beforeEach(() => {
  delete process.env.REDDIT_AGENT_REACH_URL;
  delete process.env.REDDIT_AGENT_REACH_TOKEN;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ["REDDIT_AGENT_REACH_URL", "REDDIT_AGENT_REACH_TOKEN"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function enableService() {
  process.env.REDDIT_AGENT_REACH_URL = "https://private.example/reddit/";
  process.env.REDDIT_AGENT_REACH_TOKEN = "test-token";
}

test("service listings preserve candidate mapping, exclusions and deduplication", async () => {
  enableService();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return listing([
      post(), post({ id: "pinned", stickied: true }), post({ id: "nsfw", over_18: true }),
      post({ id: "old", created_utc: Date.now() / 1000 - 49 * 3600 }),
      { kind: "t1", data: {} },
    ]);
  };
  const candidates = await fetchCandidates();
  assert.equal(candidates.length, 1);
  assert.deepEqual({ ...candidates[0], createdAt: undefined }, {
    id: "reddit:demo", source: "reddit", title: "I wish this existed",
    text: "A repeated manual task", url: "https://www.reddit.com/r/AppIdeas/comments/demo/test/",
    author: "reader", score: 7, numComments: 3, createdAt: undefined, lang: "en",
  });
  assert.ok(Number.isFinite(Date.parse(candidates[0].createdAt)));
  assert.deepEqual(calls.map(([url]) => url.searchParams.get("subreddit")), subreddits);
  for (const [url, options] of calls) {
    assert.equal(url.origin, "https://private.example");
    assert.equal(url.pathname, "/reddit/posts");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("service base without a trailing slash retains its binding path", async () => {
  enableService();
  process.env.REDDIT_AGENT_REACH_URL = "https://private.example/reddit";
  globalThis.fetch = async (url) => {
    assert.equal(url.pathname, "/reddit/posts");
    return listing([]);
  };
  assert.deepEqual(await fetchCandidates(), []);
});

test("one failed subreddit does not discard successful subreddit results", async () => {
  enableService();
  globalThis.fetch = async (url) => url.searchParams.get("subreddit") === "AppIdeas"
    ? listing([post()]) : new Response(null, { status: 502 });
  assert.equal((await fetchCandidates()).length, 1);
});

test("timeouts and malformed responses degrade to an empty source", async () => {
  enableService();
  globalThis.fetch = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  assert.deepEqual(await fetchCandidates(), []);
  globalThis.fetch = async () => Response.json({ invalid: true });
  assert.deepEqual(await fetchCandidates(), []);
});

test("configured service without a token never makes an anonymous request", async () => {
  enableService();
  delete process.env.REDDIT_AGENT_REACH_TOKEN;
  globalThis.fetch = async () => { assert.fail("must not fetch"); };
  assert.deepEqual(await fetchCandidates(), []);
});

test("unset service URL keeps the original public API path", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url.origin, "https://www.reddit.com");
    assert.ok(subreddits.some((sub) => url.pathname === `/r/${sub}/new.json`));
    assert.equal(url.searchParams.get("limit"), "50");
    assert.equal(options.headers["User-Agent"], "helpus-demand-miner/0.1");
    assert.equal(options.headers.Authorization, undefined);
    return listing([post()]);
  };
  assert.equal((await fetchCandidates()).length, 1);
});
