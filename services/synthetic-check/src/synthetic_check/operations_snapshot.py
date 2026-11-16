"""Bounded private observation snapshot; this never changes the probe's verdict.

The sample time is captured before probing. ETag CAS plus that watermark prevents
an old successful invocation from replacing a newer failure, including on replay.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .checks import ADVISORY_CHECKS, CHECK_NAMES, CheckResult
from .logs import log

KEY = "ops/console-monitor/v1/current.json"
MAX_BYTES = 65536
MAX_ATTEMPTS = 3
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9:_./# -]{0,254}\Z")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\Z")
_RUN = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,47}\Z")
_TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)\Z")


class SnapshotError(Exception):
    """Only fixed reason codes leave this module; never provider error text."""


def timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: Any) -> datetime:
    if not isinstance(value, str) or not _TIME.fullmatch(value):
        raise SnapshotError("invalid_time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise SnapshotError("invalid_time") from None
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise SnapshotError("invalid_time")
    return parsed


def _remaining(context: Any) -> int:
    try:
        return int(context.get_remaining_time_in_millis()) if context is not None else 30000
    except Exception:
        return 0


def _budget(context: Any) -> None:
    if _remaining(context) < 2000:
        raise SnapshotError("deadline")


def _error_code(error: Exception) -> str:
    response = getattr(error, "response", {})
    return str(response.get("Error", {}).get("Code", "")) if isinstance(response, dict) else ""


def alarm_names(raw: str | None) -> list[str]:
    try:
        names = json.loads(raw) if raw else []
    except (ValueError, TypeError):
        raise SnapshotError("invalid_alarm_config") from None
    if not isinstance(names, list) or len(names) > 20 or any(not isinstance(n, str) or not _NAME.fullmatch(n) for n in names):
        raise SnapshotError("invalid_alarm_config")
    if len(set(names)) != len(names):
        raise SnapshotError("invalid_alarm_config")
    return names


def collect_alarms(client: Any, names: list[str], now: datetime, context: Any = None) -> dict[str, Any]:
    base = {"state": "unknown", "observedAt": timestamp(now), "items": [], "reason": "not_configured"}
    if not names:
        return base
    try:
        _budget(context)
        response = client.describe_alarms(AlarmNames=names, AlarmTypes=["MetricAlarm"])
        rows = response.get("MetricAlarms", [])
        by_name = {r.get("AlarmName"): r for r in rows if isinstance(r, dict) and r.get("AlarmName") in names}
        items = []
        for name in names:
            row = by_name.get(name, {})
            state = row.get("StateValue")
            state = state if state in ("OK", "ALARM", "INSUFFICIENT_DATA") else "UNKNOWN"
            at = row.get("StateUpdatedTimestamp")
            items.append({"name": name, "state": state, "stateUpdatedAt": timestamp(at) if isinstance(at, datetime) else None})
        return {**base, "state": "known", "items": items, "reason": None}
    except Exception:
        return {**base, "reason": "source_unavailable"}


def make_snapshot(results: list[CheckResult], run_id: str, started: datetime, completed: datetime, alarms: dict[str, Any]) -> dict[str, Any]:
    if not _RUN.fullmatch(run_id) or completed < started:
        raise SnapshotError("invalid_run")
    if len(results) != len(CHECK_NAMES) or {r.name for r in results} != set(CHECK_NAMES):
        raise SnapshotError("invalid_checks")
    by_name = {r.name: r for r in results}
    checks = []
    for name in CHECK_NAMES:
        r = by_name[name]
        code = r.code if isinstance(r.code, str) and _CODE.fullmatch(r.code) else (None if r.code is None else "ERROR")
        status = "healthy" if r.ok else ("unknown" if code in ("CONFIG", "ERROR") else "failed")
        checks.append({"name": name, "status": status, "advisory": name in ADVISORY_CHECKS,
                       "httpStatus": r.status if type(r.status) is int and 100 <= r.status <= 599 else None,
                       "latencyMs": r.ms if type(r.ms) is int and 0 <= r.ms <= 60000 else None, "code": code})
    return {"schemaVersion": 1, "runId": run_id, "observedAt": timestamp(started), "completedAt": timestamp(completed),
            "expiresAt": timestamp(started + timedelta(minutes=30)), "checks": checks, "alarms": alarms}


def _validate(document: Any, now: datetime) -> datetime:
    if not isinstance(document, dict) or type(document.get("schemaVersion")) is not int or document["schemaVersion"] != 1:
        raise SnapshotError("invalid_snapshot")
    if set(document) != {"schemaVersion", "runId", "observedAt", "completedAt", "expiresAt", "checks", "alarms"}:
        raise SnapshotError("invalid_snapshot")
    if not isinstance(document["runId"], str) or not _RUN.fullmatch(document["runId"]):
        raise SnapshotError("invalid_snapshot")
    started = parse_time(document["observedAt"])
    completed = parse_time(document["completedAt"])
    if started > now + timedelta(seconds=60) or completed < started or completed > now + timedelta(seconds=60):
        raise SnapshotError("invalid_snapshot")
    if parse_time(document["expiresAt"]) != started + timedelta(minutes=30):
        raise SnapshotError("invalid_snapshot")
    checks = document["checks"]
    if not isinstance(checks, list) or len(checks) != len(CHECK_NAMES) or any(not isinstance(r, dict) for r in checks):
        raise SnapshotError("invalid_snapshot")
    if [r.get("name") for r in checks] != list(CHECK_NAMES):
        raise SnapshotError("invalid_snapshot")
    for row in checks:
        if set(row) != {"name", "status", "advisory", "httpStatus", "latencyMs", "code"}:
            raise SnapshotError("invalid_snapshot")
        if row["status"] not in ("healthy", "degraded", "failed", "unknown") or type(row["advisory"]) is not bool or row["advisory"] != (row["name"] in ADVISORY_CHECKS):
            raise SnapshotError("invalid_snapshot")
        for field, low, high in (("httpStatus", 100, 599), ("latencyMs", 0, 60000)):
            if row[field] is not None and (type(row[field]) is not int or not low <= row[field] <= high):
                raise SnapshotError("invalid_snapshot")
        if row["code"] is not None and (not isinstance(row["code"], str) or not _CODE.fullmatch(row["code"])):
            raise SnapshotError("invalid_snapshot")
    alarms = document["alarms"]
    if not isinstance(alarms, dict) or set(alarms) != {"state", "observedAt", "items", "reason"} or alarms["state"] not in ("known", "unknown"):
        raise SnapshotError("invalid_snapshot")
    alarm_at = parse_time(alarms["observedAt"])
    if alarm_at < started or alarm_at > completed:
        raise SnapshotError("invalid_snapshot")
    rows = alarms["items"]
    if not isinstance(rows, list) or len(rows) > 20 or alarms["reason"] not in (None, "not_configured", "source_unavailable"):
        raise SnapshotError("invalid_snapshot")
    if alarms["state"] == "unknown" and rows:
        raise SnapshotError("invalid_snapshot")
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"name", "state", "stateUpdatedAt"}:
            raise SnapshotError("invalid_snapshot")
        if not isinstance(row["name"], str) or not _NAME.fullmatch(row["name"]) or row["name"] in seen or row["state"] not in ("OK", "ALARM", "INSUFFICIENT_DATA", "UNKNOWN"):
            raise SnapshotError("invalid_snapshot")
        seen.add(row["name"])
        if row["stateUpdatedAt"] is not None and parse_time(row["stateUpdatedAt"]) > now + timedelta(seconds=60):
            raise SnapshotError("invalid_snapshot")
    return started


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    obj: dict[str, Any] = {}
    for key, value in pairs:
        if key in obj:
            raise SnapshotError("invalid_snapshot")
        obj[key] = value
    return obj


def publish_snapshot(client: Any, bucket: str, document: dict[str, Any], now: datetime, context: Any = None) -> str:
    if not _BUCKET.fullmatch(bucket):
        raise SnapshotError("invalid_config")
    incoming = _validate(document, now)
    body = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    if len(body) > MAX_BYTES:
        raise SnapshotError("oversized_snapshot")
    for _ in range(MAX_ATTEMPTS):
        _budget(context)
        etag = None
        try:
            response = client.get_object(Bucket=bucket, Key=KEY)
            stream = response["Body"]
            try:
                if response.get("ContentLength", MAX_BYTES + 1) > MAX_BYTES:
                    raise SnapshotError("invalid_existing")
                raw = stream.read(MAX_BYTES + 1)
            finally:
                stream.close()
            if len(raw) > MAX_BYTES:
                raise SnapshotError("invalid_existing")
            try:
                existing = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
                prior = _validate(existing, now)
            except (ValueError, TypeError, SnapshotError):
                raise SnapshotError("invalid_existing") from None
            if prior >= incoming:
                return "superseded"
            etag = response.get("ETag")
            if not isinstance(etag, str) or not 1 <= len(etag) <= 128 or any(c in etag for c in "\r\n"):
                raise SnapshotError("invalid_existing")
        except Exception as error:
            if _error_code(error) not in ("NoSuchKey", "404"):
                raise
        _budget(context)
        condition = {"IfMatch": etag} if etag is not None else {"IfNoneMatch": "*"}
        try:
            client.put_object(Bucket=bucket, Key=KEY, Body=body, ContentType="application/json", CacheControl="private, no-store",
                              ServerSideEncryption="AES256", **condition)
            return "published"
        except Exception as error:
            if _error_code(error) not in ("PreconditionFailed", "ConditionalRequestConflict", "412", "409"):
                raise
    raise SnapshotError("cas_exhausted")


def publish_observation(results: list[CheckResult], started: datetime, context: Any = None) -> None:
    bucket = os.environ.get("OPS_SNAPSHOT_BUCKET", "")
    if not bucket:
        return
    try:
        if os.environ.get("OPS_SNAPSHOT_KEY", KEY) != KEY:
            raise SnapshotError("invalid_config")
        names = alarm_names(os.environ.get("OPS_ALARM_NAMES"))
        _budget(context)
        import boto3
        from botocore.config import Config

        config = Config(connect_timeout=0.5, read_timeout=0.5, retries={"total_max_attempts": 1})
        sampled = datetime.now(timezone.utc)
        alarms = collect_alarms(boto3.client("cloudwatch", config=config), names, sampled, context) if names else collect_alarms(None, [], sampled)
        run_id = getattr(context, "aws_request_id", None) or uuid.uuid4().hex
        document = make_snapshot(results, run_id, started, datetime.now(timezone.utc), alarms)
        outcome = publish_snapshot(boto3.client("s3", config=config), bucket, document, datetime.now(timezone.utc), context)
        log("info", "operations-snapshot", outcome=outcome)
    except Exception as error:
        reason = str(error) if isinstance(error, SnapshotError) else "source_unavailable"
        log("warn", "operations-snapshot", outcome="unavailable", reason=reason)
