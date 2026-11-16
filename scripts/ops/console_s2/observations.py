"""Genuine HTTP observation primitives for the root's OAuth/browser/incident driver.

No fake tokens/claims, request interception, metric publication or SNS publication.
Token values live only in caller memory; evidence is allowlisted metadata only.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from guards import Blocked, require

MAX_PAYLOAD = 65536


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Blocked("REDIRECT_FORBIDDEN")


def token_metadata(token, issuer, client_id):
    """Unverified metadata only; actual signed-token verification occurs at provider/API.

    This function must never be used as an authorization decision.
    """
    require(isinstance(token, str) and len(token) <= 16384, "INVALID_TOKEN")
    parts = token.split(".")
    require(len(parts) == 3 and all(parts), "INVALID_TOKEN")
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except Exception:
        raise Blocked("INVALID_TOKEN") from None
    require(claims.get("iss") == issuer, "WRONG_TOKEN_ISSUER")
    require(claims.get("aud", claims.get("client_id")) == client_id, "WRONG_TOKEN_CLIENT")
    require(type(claims.get("iat")) is int and type(claims.get("exp")) is int, "TOKEN_TIME_MISSING")
    require(claims["exp"] - claims["iat"] == 300, "TOKEN_NOT_FIVE_MINUTES")
    groups = claims.get("cognito:groups", [])
    require(isinstance(groups, list) and all(x in ("super_admin", "editor") for x in groups), "UNEXPECTED_TOKEN_GROUP")
    return {"sha256": hashlib.sha256(token.encode()).hexdigest(), "iat": claims["iat"],
            "exp": claims["exp"], "issuer": issuer, "clientId": client_id,
            "groups": groups, "claimsVerifiedLocally": False}


class Http:
    def __init__(self, manifest, ledger):
        self.manifest, self.ledger = manifest, ledger
        self.base = manifest.get("apiBase", "")
        parts = urlsplit(self.base)
        require(parts.scheme == "https" and parts.hostname and parts.hostname.endswith(".execute-api.ap-southeast-2.amazonaws.com") and not parts.username and not parts.query and not parts.fragment and parts.path in ("", "/"), "EXACT_ISOLATED_API_REQUIRED")
        require(parts.hostname.split(".")[0] == manifest.get("apiId"), "API_ID_MISMATCH")
        self.opener = build_opener(NoRedirect)

    def request(self, method, path, *, token, payload=None, inject=False):
        require(method in ("GET", "POST", "DELETE"), "UNSUPPORTED_HTTP_METHOD")
        require(path.startswith("/api/v1/") and "?" not in path and ".." not in path and "#" not in path and "\\" not in path, "UNSAFE_HTTP_PATH")
        allowed = self.manifest.get("httpPaths", {})
        require(method + " " + path in allowed, "HTTP_PATH_NOT_FROZEN")
        body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        require(body is None or len(body) <= MAX_PAYLOAD, "HTTP_PAYLOAD_TOO_LARGE")
        self.ledger.consume("businessHTTP", inject=inject)
        self.ledger.consume("handlerInvocations")
        request = Request(self.base.rstrip("/") + path, method=method, data=body,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Origin": "http://localhost:5188"})
        started = time.time()
        try:
            response = self.opener.open(request, timeout=30)
        except HTTPError as error:
            response = error
        # Read at most one bounded artifact; never log the raw body or headers.
        with response:
            raw = response.read(MAX_PAYLOAD + 1)
            require(len(raw) <= MAX_PAYLOAD, "HTTP_RESPONSE_TOO_LARGE")
            metadata = {"startedAtEpoch": started, "endedAtEpoch": time.time(),
                        "method": method, "path": path, "status": response.status,
                        "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        return metadata, raw


def sample_expiry(http, token, token_info, path, *, clock=time.time, sleep=time.sleep):
    """Observe real gateway acceptance near expiry; return intervals, never exact unseen second.

    Sleeps <=1s so caller cancellation/watchdog can run. Token never leaves memory/evidence.
    """
    observations = []
    for offset in (-15, 15, 75):
        target = token_info["exp"] + offset
        require(clock() <= target + 5, "EXPIRY_SAMPLE_MISSED")
        while clock() < target:
            sleep(min(1, target - clock()))
        metadata, _ = http.request("GET", path, token=token)
        metadata["targetOffsetSeconds"] = offset
        observations.append(metadata)
    return {"status": "OBSERVED", "token": token_info, "observations": observations,
            "precision": "Only observed acceptance/rejection intervals; gateway behavior, not internal exp+60 verifier."}


def incident_requirements():
    """Fixed real-business acceptance obligations, not substitutes for execution."""
    common = ["realEmf", "alarmHistory", "collectorRunAndSnapshot", "consoleObservation",
              "snsMetadata", "mailReceipt", "recoveryAlarm", "productionBaselineUnchanged"]
    return {
        "sync": common + ["fixtureRowLockMax45s", "failedValidE1", "lockReleasedFinally",
                          "retryE1", "duplicateE1", "olderE2", "exactEventSetAndWinner"],
        "publish": common + ["baselineSuccess", "mappingDisabledBeforeSecondPublish",
                             "realAgeOver900s", "actualPendingJob", "isolatedMappingRecovery",
                             "workerSuccess", "manifestDelivery", "downloadHashVersionCardCount",
                             "actualRollbackToBaseline", "learnerRowsUnchanged"],
    }
