import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { fetchCandidates, sessionCookiesJson } from "../src/lib/sources/reddit.ts";

const originalFetch = globalThis.fetch;
const originalCookies = process.env.REDDIT_COOKIES_JSON;
const SUBREDDITS = [
  "SomebodyMakeThis", "AppIdeas", "Entrepreneur", "smallbusiness", "Accounting",
  "weddingplanning", "shopify", "printondemand", "ecommerce", "FulfillmentByAmazon",
  "Flipping", "Contractor", "electricians", "PropertyManagement", "msp", "WeddingPhotography",
];

const post = (overrides = {}) => ({
  kind: "t3",
  data: {
    id: "demo", title: "I wish this existed", selftext: "A repeated manual task",
    permalink: "/r/AppIdeas/comments/demo/x/", author: "reader", score: 7,
    num_comments: 3, created_utc: Date.now() / 1000, stickied: false, over_18: false,
    ...overrides,
  },
});
const listing = (children) => Response.json({ data: { children } });

beforeEach(() => {
  delete process.env.REDDIT_COOKIES_JSON;
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCookies === undefined) delete process.env.REDDIT_COOKIES_JSON;
  else process.env.REDDIT_COOKIES_JSON = originalCookies;
});

test("without cookies, requests stay anonymous", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return listing([post()]);
  };
  const candidates = await fetchCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "reddit:demo");
  assert.deepEqual(calls.map(([url]) => url),
    SUBREDDITS.map((sub) => `https://www.reddit.com/r/${sub}/new.json?limit=100&raw_json=1`));
  for (const [, options] of calls) {
    assert.deepEqual(options.headers, { "User-Agent": "helpus-demand-miner/0.1" });
  }
});

test("valid cookies are sent with browser headers", async () => {
  process.env.REDDIT_COOKIES_JSON = JSON.stringify({ reddit_session: "s", token_v2: "t" });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    return listing([]);
  };
  await fetchCandidates();
  assert.equal(calls.length, SUBREDDITS.length);
  for (const options of calls) {
    assert.equal(options.headers.Cookie, "reddit_session=s; token_v2=t");
    assert.match(options.headers["User-Agent"], /Chrome\/133/);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("listings keep exclusions and deduplicate across subreddits", async () => {
  globalThis.fetch = async () => listing([
    post(), post({ id: "pinned", stickied: true }), post({ id: "nsfw", over_18: true }),
    post({ id: "old", created_utc: Date.now() / 1000 - 49 * 3600 }), { kind: "t1", data: {} },
  ]);
  const candidates = await fetchCandidates();
  assert.deepEqual(candidates.map((c) => c.id), ["reddit:demo"]);
  assert.equal(candidates[0].url, "https://www.reddit.com/r/AppIdeas/comments/demo/x/");
});

test("invalid cookie config skips Reddit without any request", async () => {
  globalThis.fetch = async () => assert.fail("must not fetch");
  for (const value of ["not-json", "[]", "null", "{}", '{"reddit_session":""}', '{"reddit_session":1}']) {
    process.env.REDDIT_COOKIES_JSON = value;
    assert.deepEqual(await fetchCandidates(), [], value);
  }
});

test("failed subreddits do not discard the others", async () => {
  globalThis.fetch = async (url) => {
    if (url.includes("/AppIdeas/")) return listing([post()]);
    if (url.includes("/smallbusiness/")) throw new DOMException("Timed out", "TimeoutError");
    return new Response(null, { status: 403 });
  };
  assert.equal((await fetchCandidates()).length, 1);
});

test("pasted reddit_session values become a cookie map", () => {
  const expected = JSON.stringify({ reddit_session: "abc.def" });
  assert.equal(sessionCookiesJson("abc.def"), expected);
  assert.equal(sessionCookiesJson("  reddit_session=abc.def; "), expected);
  for (const bad of ["", "   ", "a b", "a;b", "reddit_session="]) {
    assert.equal(sessionCookiesJson(bad), null, JSON.stringify(bad));
  }
});
