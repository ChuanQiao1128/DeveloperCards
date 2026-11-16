"""One bounded observer Invoke. No response payload enters the v1 snapshot."""
from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from .logs import log
from .operations_snapshot import parse_time, _unique_object

MAX_BYTES = 16384
INVOKE_SECONDS = 10.0
_NAMESPACE = re.compile(r"(?:DeveloperCards|DeveloperCardsConsoleS2_[A-Za-z0-9_-]{1,64})\Z")
_ARN = re.compile(r"arn:aws:lambda:[a-z]{2}-[a-z]+-\d:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[A-Za-z][A-Za-z0-9_-]{0,127}\Z")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
EVENT = b'{"schemaVersion":1,"job":"observe-publishing"}'


def metric_namespace() -> str | None:
    # Freeze the raw namespace before settings can replace an invalid value with its default.
    value = os.environ.get("METRICS_NAMESPACE", "DeveloperCards")
    return value if _NAMESPACE.fullmatch(value) else None


def isolated_targets_configured(namespace: str | None) -> bool:
    if namespace is None or namespace == "DeveloperCards":
        return True
    return all(os.environ.get(name) for name in ("API_BASE", "CDN_BASE", "CONSOLE_BASE", "REMOTE_CONFIG_URL",
                                                "COGNITO_CONSOLE_ISSUER", "COGNITO_MOBILE_ISSUER"))


def _validate(document: Any, started: datetime, completed: datetime) -> None:
    if not isinstance(document, dict) or set(document) != {"schemaVersion", "observedAt", "status", "stalled", "truncated", "items", "reason"}:
        raise ValueError("invalid_response")
    if type(document["schemaVersion"]) is not int or document["schemaVersion"] != 1:
        raise ValueError("invalid_response")
    sampled = parse_time(document["observedAt"])
    if not started - timedelta(seconds=60) <= sampled <= completed + timedelta(seconds=60):
        raise ValueError("invalid_response")
    items = document["items"]
    if type(document["truncated"]) is not bool or not isinstance(items, list) or len(items) > 20:
        raise ValueError("invalid_response")
    if document["status"] == "unknown":
        if document["stalled"] is not None or document["truncated"] or items or document["reason"] not in ("DB_UNAVAILABLE", "QUERY_TIMEOUT", "INVALID_CONFIG"):
            raise ValueError("invalid_response")
    elif document["status"] == "known":
        if type(document["stalled"]) is not bool or document["stalled"] != bool(items) or document["reason"] is not None:
            raise ValueError("invalid_response")
        if document["truncated"] and len(items) != 20:
            raise ValueError("invalid_response")
    else:
        raise ValueError("invalid_response")
    seen = set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {"phase", "jobId", "deckSlug", "buildId", "sinceAt"}:
            raise ValueError("invalid_response")
        if item["phase"] not in ("dispatch", "processing", "manifest"):
            raise ValueError("invalid_response")
        if any(not isinstance(item[field], str) or not _IDENTIFIER.fullmatch(item[field]) for field in ("jobId", "deckSlug", "buildId")):
            raise ValueError("invalid_response")
        key = (item["phase"], item["jobId"])
        if key in seen or parse_time(item["sinceAt"]) > sampled + timedelta(seconds=60):
            raise ValueError("invalid_response")
        seen.add(key)


def invoke_once(client: Any, arn: str, started: datetime, *, timeout_s: float = INVOKE_SECONDS) -> bool:
    """Wall deadline also bounds a slow/dripping SDK body; a late response is discarded."""
    if not _ARN.fullmatch(arn):
        return False
    outcome: queue.Queue[bool] = queue.Queue(maxsize=1)
    streams: list[Any] = []
    expired = threading.Event()

    def request() -> None:
        stream = None
        try:
            response = client.invoke(FunctionName=arn, InvocationType="RequestResponse", Payload=EVENT)
            stream = response.get("Payload")
            streams.append(stream)
            if expired.is_set() or response.get("StatusCode") != 200 or response.get("FunctionError") or stream is None:
                raise ValueError("invoke_failed")
            raw = stream.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise ValueError("invalid_response")
            document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
            _validate(document, started, datetime.now(timezone.utc))
            # A successful transport of an unknown sample is not successful observation.
            outcome.put_nowait(not expired.is_set() and document["status"] == "known")
        except Exception:
            outcome.put_nowait(False)
        finally:
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass

    threading.Thread(target=request, daemon=True, name="operations-observer").start()
    try:
        return outcome.get(timeout=max(0.001, timeout_s))
    except queue.Empty:
        expired.set()
        # Closing the SDK body cancels a slow read; close itself must not block the collector.
        if streams and streams[0] is not None:
            def close_late_body() -> None:
                try:
                    streams[0].close()
                except Exception:
                    pass
            threading.Thread(target=close_late_body, daemon=True, name="operations-observer-close").start()
        return False


def _metric(namespace: str | None, success: bool) -> None:
    if namespace is None:
        return
    line = {"_aws": {"Timestamp": int(time.time() * 1000), "CloudWatchMetrics": [
        {"Namespace": namespace, "Dimensions": [["Service"]],
         "Metrics": [{"Name": "ObserverInvokeSuccess", "Unit": "Count"}]}]},
        "Service": "synthetic-check", "ObserverInvokeSuccess": int(success)}
    sys.stdout.write(json.dumps(line, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def observe(namespace: str | None, context: Any, started: float, *, config_valid: bool = True) -> None:
    arn = os.environ.get("OPS_OBSERVER_FUNCTION_ARN", "")
    # Existing deployments without the opt-in retain their original log/metric shape.
    if not arn:
        return
    success = False
    try:
        remaining = int(context.get_remaining_time_in_millis()) / 1000 if context is not None else 60 - (time.monotonic() - started)
        budget = min(remaining, 60 - (time.monotonic() - started))
        if namespace is not None and config_valid and budget >= 12 and _ARN.fullmatch(arn):
            import boto3
            from botocore.config import Config
            client = boto3.client("lambda", config=Config(connect_timeout=1, read_timeout=9,
                                  retries={"total_max_attempts": 1}))
            success = invoke_once(client, arn, datetime.now(timezone.utc))
    except Exception:
        pass
    _metric(namespace, success)
    log("info" if success else "warn", "operations-observer-invoke", outcome="known" if success else "unavailable")
