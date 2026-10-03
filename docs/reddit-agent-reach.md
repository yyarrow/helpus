# Reddit via Agent-Reach on Vercel

The existing `fetchCandidates()` adapter calls a private Python service, then uses
its existing 48-hour window, NSFW/pinned exclusions and ID deduplication. The
filter, LLM, storage and daily Cron stay on the existing Next.js pipeline.

Agent-Reach is a backend router/installer, not a universal scraping SDK. This
service uses its `RedditChannel.ordered_backends()` to select `rdt-cli`, and calls
the pinned upstream Python client directly, as Agent-Reach's channel API intends.
It never calls `rdt login`, reads local credential files or refreshes a browser.

## Vercel setup

The root `vercel.json` uses [Vercel Services](https://vercel.com/docs/services)
(currently beta): `web` is the existing app and `reddit` is a Python function in
the same deployment. Only `web` has a public rewrite. A
[service binding](https://vercel.com/docs/services/bindings) injects
`REDDIT_AGENT_REACH_URL` into `web` automatically; do not set a production URL
manually. Preview calls stay within the preview deployment.

Set these server-side Vercel environment variables, then redeploy:

- `REDDIT_AGENT_REACH_TOKEN`: a random shared service token (available to both services).
- `REDDIT_COOKIES_JSON`: a JSON object of Reddit cookie name/value pairs, including
  `reddit_session`. If using an existing rdt-cli credential export, copy just its
  `cookies` object, not the entire credential file. Treat it as a secret.

`CRON_SECRET` still protects the ingest endpoint. Each subreddit request has a
20-second caller timeout and a 12-second upstream timeout with one attempt.
Failed requests return no candidates for that subreddit; other sources continue.
Missing/invalid service secrets fail closed. The service only accepts the four
existing subreddits and always fetches 50 newest posts. Responses are not cached.

Cookies may expire and Reddit may still reject Vercel IPs with 403. Agent-Reach
cannot guarantee that a cookie fixes datacenter blocking. No live Reddit session
or Vercel deployment was verified as part of this change. Before merging, test a
preview with real credentials and confirm Reddit candidates arrive in ingest stats.

## Local verification

Without `REDDIT_AGENT_REACH_URL`, the adapter retains the original anonymous API
path. To test the cloud adapter locally, install the Python requirements in an
isolated environment and run `uvicorn main:app --port 8790` from `services/reddit`
(install uvicorn separately for local serving). Set
`REDDIT_AGENT_REACH_URL=http://127.0.0.1:8790/`, the shared token and cookies in your
local environment. Secrets never belong in tracked files or logs.

Automated checks (Node 22.18+; Python uses the service environment):

```sh
node --test tests/reddit.test.mjs
cd services/reddit
python -m unittest discover -s tests
```

The tests use fixtures and HTTP mocks, not personal cookies or live Reddit.
