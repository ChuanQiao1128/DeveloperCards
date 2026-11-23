import hashlib
import json
import uuid

import pytest
from conftest import SECRET, envelope, verify_signature
from notifier import content_cdn
from notifier.internal_client import InternalClient


@pytest.mark.parametrize(("scenario", "last", "ack", "report"), [
    ("verified", False, True, {"failure": None}),
    ("other_deck", False, True, {"failure": None}),
    ("old_index", False, False, None),
    ("changed_bytes", False, False, None),
    ("changed_bytes", True, True, {"failure": "HASH_MISMATCH"}),
    ("redirect", True, True, {"failure": "CDN_UNAVAILABLE"}),
    ("superseded", False, True, None),
])
def test_uses_the_public_index_and_hash_of_the_certified_bytes(local_server, monkeypatch, scenario, last, ack, report):
    build = "build-42"
    deck = b'{"version":"build-42","cards":[]}'
    sha = hashlib.sha256(deck).hexdigest()
    job = str(uuid.uuid4())
    slug = "foundations" if scenario == "other_deck" else content_cdn.SLUG
    card_count = 501 if scenario == "other_deck" else 1
    path = f"decks/{slug}/builds/{build}/deck.json"
    manifest = {"decks": [{
        "slug": slug, "path": path, "sha256": sha, "totalCards": card_count, "buildId": build,
        "availability": "live", "downloadMode": "public",
    }]}
    if scenario == "old_index":
        manifest["decks"][0]["buildId"] = "build-41"

    def respond(_, req):
        if req.method == "GET":
            if req.path == "/manifest.json":
                return 200, {}, json.dumps(manifest).encode()
            if req.path == "/" + path:
                if scenario == "redirect":
                    return 302, {"Location": "/different"}, b""
                return 200, {}, deck + b" " if scenario == "changed_bytes" else deck
            raise AssertionError(f"unexpected fetch: {req.path}")
        assert verify_signature(req, (SECRET,))
        if req.json()["operation"] == "prepare-content-cdn":
            data = {"skip": True} if scenario == "superseded" else {"buildId": build, "sha256": sha, "cards": card_count}
            if scenario == "other_deck":
                data.update(slug=slug, bytes=len(deck))
        else:
            data = {"recorded": True}
        return 200, {"Content-Type": "application/json"}, envelope(data)

    server = local_server(respond)
    monkeypatch.setattr(content_cdn, "PUBLIC_ROOT", server.base_url + "/")
    assert content_cdn.verify(InternalClient(server.base_url, SECRET), job, final_receive=last) is ack
    reads = [req.path for req in server.requests if req.method == "GET"]
    expected_reads = [] if scenario == "superseded" else ["/manifest.json"]
    if scenario not in ("superseded", "old_index"):
        expected_reads.append("/" + path)
    assert reads == expected_reads
    reports = [req.json() for req in server.requests if req.method == "POST" and req.json()["operation"] == "report-content-cdn"]
    assert reports == ([] if report is None else [{
        "v": 1, "operation": "report-content-cdn", "jobId": job, "buildId": build, "sha256": sha, **report,
    }])
