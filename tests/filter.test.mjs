import assert from "node:assert/strict";
import { test } from "node:test";
import { isDemandSignal } from "../src/lib/filter.ts";

const reddit = (sub, title) => ({
  source: "reddit", lang: "en", title, text: "",
  url: `https://www.reddit.com/r/${sub}/comments/abc/x/`,
});

test("demand-native subreddits pass without a pattern match", () => {
  assert.ok(isDemandSignal(reddit("AppIdeas", "An app that lets you see what used to be there")));
  assert.ok(isDemandSignal(reddit("somebodymakethis", "A physical shutter for phones")));
});

test("other subreddits still need a demand pattern", () => {
  assert.ok(!isDemandSignal(reddit("smallbusiness", "Hit 10 paid users this month")));
  assert.ok(isDemandSignal(reddit("weddingplanning", "Is there an app that lets me drag and drop seating names?")));
});

test("the bypass is limited to reddit", () => {
  assert.ok(!isDemandSignal({ ...reddit("AppIdeas", "An app that"), source: "hn" }));
});
