"""Verify one certified build through the same public CloudFront origin as the app."""

from __future__ import annotations

import hashlib
import http.client
import json
import re
import time
import urllib.request
from collections.abc import Iterator
from typing import Any

from .internal_client import REPORT_PATH, InternalClient

EVENT_TYPE = "content_cdn_verification"
PUBLIC_ROOT = "https://d1ditdi9jqpy6n.cloudfront.net/content/"
SLUG = "aws-saa-fundamentals"
SHA256 = re.compile(r"[0-9a-f]{64}")
DECK_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
BUILD = re.compile(r"[a-zA-Z0-9_-]{1,100}")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _download(path: str, size_limit: int, deadline: float) -> Iterator[bytes]:
    request = urllib.request.Request(PUBLIC_ROOT + path, headers={
        "Accept": "application/json", "Cache-Control": "no-cache",
    })
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("CDN verification deadline")
    with urllib.request.build_opener(_NoRedirect()).open(request, timeout=min(remaining, 8)) as response:
        if response.status != 200:
            raise ValueError("Unexpected CDN response")
        size = 0
        while chunk := response.read1(65536):
            size += len(chunk)
            if size > size_limit or time.monotonic() >= deadline:
                raise ValueError("CDN verification limit exceeded")
            yield chunk


def _check(slug: str, build: str, expected: str, cards: int, size: int | None) -> str | None:
    path = f"decks/{slug}/builds/{build}/deck.json"
    deadline = time.monotonic() + 18
    try:
        manifest = json.loads(b"".join(_download("manifest.json", 1024 * 1024, deadline)))
        entries = manifest.get("decks") if isinstance(manifest, dict) else None
        matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("slug") == slug] if isinstance(entries, list) else []
        if len(matches) != 1:
            return "INDEX_MISMATCH"
        entry = matches[0]
        if (entry.get("buildId") != build or entry.get("path") != path or entry.get("sha256") != expected
                or type(entry.get("totalCards")) is not int or entry["totalCards"] != cards
                or entry.get("downloadMode") != "public" or entry.get("availability") != "live"):
            return "INDEX_MISMATCH"
        digest = hashlib.sha256()
        downloaded = 0
        for chunk in _download(path, size if size is not None else 8 * 1024 * 1024, deadline):
            digest.update(chunk)
            downloaded += len(chunk)
        return None if digest.hexdigest() == expected and (size is None or size == downloaded) else "HASH_MISMATCH"
    except (OSError, ValueError, http.client.HTTPException):
        return "CDN_UNAVAILABLE"


def verify(client: InternalClient, job_id: str, *, final_receive: bool) -> bool:
    """Return whether this queue delivery can be acknowledged."""
    request: dict[str, Any] = {"v": 1, "jobId": job_id}
    prepared = client.post(REPORT_PATH, {**request, "operation": "prepare-content-cdn"}, retry_pauses=())
    if not prepared.ok:
        return False
    target = prepared.data or {}
    if target.get("skip") is True:
        return True
    slug = target.get("slug", SLUG)
    size = target.get("bytes")
    build, expected, cards = target.get("buildId"), target.get("sha256"), target.get("cards")
    if (target.get("retry") is True or not isinstance(slug, str) or not DECK_SLUG.fullmatch(slug)
            or not isinstance(build, str) or not BUILD.fullmatch(build)
            or not isinstance(expected, str) or not SHA256.fullmatch(expected)
            or type(cards) is not int or cards < 1 or (size is not None and (type(size) is not int or size < 1))):
        return False
    failure = _check(slug, build, expected, cards, size)
    if failure and not final_receive:
        return False
    reported = client.post(REPORT_PATH, {
        **request, "operation": "report-content-cdn", "buildId": build, "sha256": expected, "failure": failure,
    }, retry_pauses=())
    return reported.ok and bool(reported.data and (reported.data.get("recorded") is True or reported.data.get("skip") is True))
