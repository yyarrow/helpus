"""Agent-Reach's Reddit backend, hosted as a private Vercel service."""

import json
import logging
import os
import secrets
from typing import Literal

from agent_reach.channels.reddit import RedditChannel
from fastapi import FastAPI, Header, HTTPException, Response
from rdt_cli.auth import Credential
from rdt_cli.client import RedditClient

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
Subreddit = Literal["SomebodyMakeThis", "AppIdeas", "SideProject", "Entrepreneur"]
logger = logging.getLogger(__name__)


def credential_from_env() -> Credential:
    try:
        cookies = json.loads(os.environ.get("REDDIT_COOKIES_JSON", "{}"))
        if not isinstance(cookies, dict) or not cookies.get("reddit_session"):
            raise ValueError("reddit_session is required")
        if not all(isinstance(k, str) and isinstance(v, str) for k, v in cookies.items()):
            raise ValueError("cookies must contain string values")
    except (ValueError, TypeError):
        raise HTTPException(503, "Reddit credentials are missing or invalid") from None
    # Explicit credentials avoid rdt-cli's local cookie files and browser refresh.
    return Credential(cookies=cookies, source="environment")


@app.get("/posts")
def posts(subreddit: Subreddit, response: Response, authorization: str | None = Header(default=None)):
    token = os.environ.get("REDDIT_AGENT_REACH_TOKEN")
    if not token:
        raise HTTPException(503, "Reddit service token is missing")
    if not secrets.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Unauthorized")

    response.headers["Cache-Control"] = "no-store"
    channel = RedditChannel()
    # Agent-Reach delegates reads to upstream tools. Select its server backend;
    # OpenCLI requires a local browser session and cannot serve this function.
    if channel.ordered_backends({"reddit_backend": "rdt-cli"})[0] != "rdt-cli":
        raise HTTPException(503, "Agent-Reach Reddit backend is unavailable")
    credential = credential_from_env()
    try:
        with RedditClient(credential=credential, timeout=12, max_retries=1) as client:
            return client.get_subreddit(subreddit, sort="new", limit=50)
    except Exception as error:
        # Upstream errors can include request details; never log cookies or headers.
        logger.warning("Reddit fetch failed for r/%s (%s)", subreddit, type(error).__name__)
        raise HTTPException(502, "Reddit fetch failed") from None
