import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

import main


class RedditServiceTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "REDDIT_AGENT_REACH_TOKEN": "shared-test-token",
            "REDDIT_COOKIES_JSON": json.dumps({"reddit_session": "fake-session", "extra": "cookie"}),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(main.app)
        self.headers = {"Authorization": "Bearer shared-test-token"}

    def test_explicit_cookies_reach_pinned_backend_without_browser_or_files(self):
        requests = []
        def upstream(request):
            requests.append(request)
            self.assertEqual(request.url.path, "/r/AppIdeas/new.json")
            self.assertEqual(request.url.params["limit"], "50")
            self.assertIn("reddit_session=fake-session", request.headers["cookie"])
            self.assertIn("extra=cookie", request.headers["cookie"])
            return httpx.Response(200, json={"data": {"children": [{"kind": "t3", "data": {"id": "demo"}}]}})

        original_client = httpx.Client
        def transport_client(*args, **kwargs):
            return original_client(*args, transport=httpx.MockTransport(upstream), **kwargs)

        with patch("rdt_cli.transports.httpx.Client", side_effect=transport_client), \
             patch("rdt_cli.auth.get_credential", side_effect=AssertionError("No local credentials")):
            response = self.client.get("/posts?subreddit=AppIdeas", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["children"][0]["data"]["id"], "demo")
        self.assertEqual(len(requests), 1)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_authentication_fails_closed(self):
        with patch("main.RedditClient") as backend:
            self.assertEqual(self.client.get("/posts?subreddit=AppIdeas").status_code, 401)
            self.assertEqual(self.client.get("/posts?subreddit=AppIdeas", headers={"Authorization": "Bearer wrong"}).status_code, 401)
            os.environ.pop("REDDIT_AGENT_REACH_TOKEN")
            self.assertEqual(self.client.get("/posts?subreddit=AppIdeas", headers=self.headers).status_code, 503)
            backend.assert_not_called()

    def test_missing_and_malformed_cookies_never_fetch(self):
        with patch("main.RedditClient") as backend:
            for value in ["{}", "not-json", "[]", '{"reddit_session": 123}', '{"reddit_session": ""}']:
                os.environ["REDDIT_COOKIES_JSON"] = value
                self.assertEqual(self.client.get("/posts?subreddit=AppIdeas", headers=self.headers).status_code, 503)
            backend.assert_not_called()

    def test_browser_backend_cannot_be_selected_in_the_cloud(self):
        with patch("main.RedditChannel") as channel, patch("main.RedditClient") as backend:
            channel.return_value.ordered_backends.return_value = ["OpenCLI"]
            self.assertEqual(self.client.get("/posts?subreddit=AppIdeas", headers=self.headers).status_code, 503)
            channel.return_value.ordered_backends.assert_called_once_with({"reddit_backend": "rdt-cli"})
            backend.assert_not_called()

    def test_arbitrary_subreddits_are_rejected(self):
        with patch("main.RedditClient") as backend:
            self.assertEqual(self.client.get("/posts?subreddit=other", headers=self.headers).status_code, 422)
            backend.assert_not_called()

    def test_upstream_failures_do_not_expose_sensitive_details(self):
        with patch("main.RedditClient", side_effect=RuntimeError("fake-session")):
            with self.assertLogs(main.logger, level="WARNING") as logs:
                response = self.client.get("/posts?subreddit=AppIdeas", headers=self.headers)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("fake-session", response.text)
        self.assertNotIn("fake-session", " ".join(logs.output))


if __name__ == "__main__":
    unittest.main()
