"""Private snapshot protocol tests with deterministic S3/CW boundaries, no AWS."""

from __future__ import annotations

import io
import json
import sys
from types import SimpleNamespace
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pytest

from synthetic_check import handler, operations_snapshot as ops
from synthetic_check.checks import CHECK_NAMES, CheckResult

NOW = datetime(2026, 11, 16, 0, 0, tzinfo=timezone.utc)
BUCKET = "private-monitor-test"


class AwsError(Exception):
    def __init__(self, code: str):
        self.response = {"Error": {"Code": code, "Message": "NEVER-LOG-SECRET"}}


class S3:
    def __init__(self, document=None):
        self.body = json.dumps(document).encode() if document is not None else None
        self.etag = '"v1"'
        self.puts = []
        self.gets = 0
        self.race = None
        self.conflict = False

    def get_object(self, **kw):
        assert kw == {"Bucket": BUCKET, "Key": ops.KEY}
        self.gets += 1
        if self.body is None:
            raise AwsError("NoSuchKey")
        return {"Body": io.BytesIO(self.body), "ContentLength": len(self.body), "ETag": self.etag}

    def put_object(self, **kw):
        assert kw["Bucket"] == BUCKET and kw["Key"] == ops.KEY
        assert kw["CacheControl"] == "private, no-store" and kw["ServerSideEncryption"] == "AES256"
        self.puts.append(kw)
        if self.race:
            self.body = json.dumps(self.race).encode()
            self.etag = '"v2"'
            self.race = None
            raise AwsError("PreconditionFailed")
        if self.conflict:
            raise AwsError("ConditionalRequestConflict")
        assert kw.get("IfMatch") == self.etag if self.body is not None else kw.get("IfNoneMatch") == "*"
        self.body = kw["Body"]
        self.etag = '"next"'


def snapshot(at=NOW, *, failed=False):
    results = [CheckResult(n, not failed, 503 if failed else 200, 12, "STATUS" if failed else None,
                           "SECRET-RAW-BODY") for n in CHECK_NAMES]
    return ops.make_snapshot(results, "test-run", at, at + timedelta(seconds=1), ops.collect_alarms(None, [], at))


def test_wire_fixture_matches_the_real_producer():
    fixture = Path(__file__).parent / "fixtures" / "operations-snapshot-v1.json"
    assert json.loads(fixture.read_text()) == snapshot(failed=True)


def test_initial_publish_has_conditional_create_and_no_raw_detail():
    s3 = S3()
    document = snapshot()
    assert ops.publish_snapshot(s3, BUCKET, document, NOW + timedelta(seconds=2)) == "published"
    assert s3.puts[0]["IfNoneMatch"] == "*"
    assert b"SECRET-RAW-BODY" not in s3.body
    assert json.loads(s3.body) == document


def test_replay_and_older_success_cannot_replace_newer_failure():
    newer = snapshot(NOW + timedelta(minutes=1), failed=True)
    s3 = S3(newer)
    for old in (snapshot(), newer):
        assert ops.publish_snapshot(s3, BUCKET, old, NOW + timedelta(minutes=2)) == "superseded"
    assert not s3.puts and json.loads(s3.body) == newer


def test_update_uses_exact_etag():
    s3 = S3(snapshot())
    new = snapshot(NOW + timedelta(seconds=5), failed=True)
    assert ops.publish_snapshot(s3, BUCKET, new, NOW + timedelta(seconds=10)) == "published"
    assert s3.puts[0]["IfMatch"] == '"v1"' and "IfNoneMatch" not in s3.puts[0]
    assert json.loads(s3.body) == new


def test_create_race_rereads_and_preserves_newer_failure():
    s3 = S3()
    s3.race = snapshot(NOW + timedelta(seconds=5), failed=True)
    assert ops.publish_snapshot(s3, BUCKET, snapshot(), NOW + timedelta(seconds=10)) == "superseded"
    assert len(s3.puts) == 1 and s3.gets == 2
    assert json.loads(s3.body)["checks"][0]["status"] == "failed"


def test_conflicts_have_bounded_attempts():
    s3 = S3()
    s3.conflict = True
    with pytest.raises(ops.SnapshotError, match="cas_exhausted"):
        ops.publish_snapshot(s3, BUCKET, snapshot(), NOW + timedelta(seconds=2))
    assert len(s3.puts) == s3.gets == 3


@pytest.mark.parametrize("broken", [b"not json", b"{}", b"x" * (ops.MAX_BYTES + 1)])
def test_corrupt_existing_snapshot_is_never_overwritten(broken):
    s3 = S3()
    s3.body = broken
    with pytest.raises(ops.SnapshotError):
        ops.publish_snapshot(s3, BUCKET, snapshot(), NOW + timedelta(seconds=2))
    assert not s3.puts


@pytest.mark.parametrize("change", [
    lambda d: d.update(schemaVersion=True),
    lambda d: d.update(observedAt=ops.timestamp(NOW + timedelta(minutes=3))),
    lambda d: d.update(completedAt=ops.timestamp(NOW - timedelta(seconds=1))),
    lambda d: d.update(expiresAt=ops.timestamp(NOW + timedelta(days=5))),
    lambda d: d.update(runId="\nsecret"),
    lambda d: d["checks"].append(d["checks"][0]),
    lambda d: d["checks"][0].update(detail="secret"),
    lambda d: d["checks"][0].update(code="https://secret"),
    lambda d: d["checks"][0].update(latencyMs=-1),
    lambda d: d["checks"][0].update(advisory=True),
])
def test_invalid_incoming_snapshot_never_touches_s3(change):
    s3 = S3()
    d = snapshot()
    change(d)
    with pytest.raises(ops.SnapshotError):
        ops.publish_snapshot(s3, BUCKET, d, NOW + timedelta(seconds=2))
    assert s3.gets == 0 and not s3.puts


def test_denied_read_is_not_treated_as_new_object():
    s3 = S3()
    s3.get_object = lambda **kw: (_ for _ in ()).throw(AwsError("AccessDenied"))
    with pytest.raises(AwsError):
        ops.publish_snapshot(s3, BUCKET, snapshot(), NOW + timedelta(seconds=2))
    assert not s3.puts


def test_deadline_stops_before_provider_io():
    class Context:
        def get_remaining_time_in_millis(self):
            return 1500
    s3 = S3()
    with pytest.raises(ops.SnapshotError, match="deadline"):
        ops.publish_snapshot(s3, BUCKET, snapshot(), NOW + timedelta(seconds=2), Context())
    assert s3.gets == 0 and not s3.puts


def test_alarm_states_remain_raw_and_missing_is_unknown():
    class CloudWatch:
        def describe_alarms(self, **kw):
            assert kw == {"AlarmNames": ["insufficient", "okay", "missing"], "AlarmTypes": ["MetricAlarm"]}
            return {"MetricAlarms": [{"AlarmName": "insufficient", "StateValue": "INSUFFICIENT_DATA"},
                                     {"AlarmName": "okay", "StateValue": "OK"},
                                     {"AlarmName": "not-requested", "StateValue": "ALARM"}]}
    result = ops.collect_alarms(CloudWatch(), ["insufficient", "okay", "missing"], NOW)
    assert [r["state"] for r in result["items"]] == ["INSUFFICIENT_DATA", "OK", "UNKNOWN"]
    assert "not-requested" not in json.dumps(result)
    assert ops.collect_alarms(None, [], NOW)["reason"] == "not_configured"
    assert ops.collect_alarms(None, ["down"], NOW)["reason"] == "source_unavailable"


@pytest.mark.parametrize("raw", ["{}", "null", '["same","same"]', '["bad\\nname"]', json.dumps([str(i) for i in range(21)])])
def test_alarm_configuration_is_bounded(raw):
    with pytest.raises(ops.SnapshotError, match="invalid_alarm_config"):
        ops.alarm_names(raw)


def test_missing_config_does_not_load_sdk_or_emit_extra_logs(monkeypatch, capsys):
    monkeypatch.delenv("OPS_SNAPSHOT_BUCKET", raising=False)
    ops.publish_observation([], NOW)
    assert capsys.readouterr().out == ""


def test_publisher_failure_is_safe_and_keeps_existing_probe_verdict(monkeypatch, capsys):
    monkeypatch.setattr(handler, "run_checks", lambda _: [CheckResult(n, True, 200, 1, None) for n in CHECK_NAMES])
    monkeypatch.setenv("OPS_SNAPSHOT_BUCKET", BUCKET)
    monkeypatch.setenv("OPS_SNAPSHOT_KEY", "private/SECRET")
    result = handler.lambda_handler({"job": "synthetic-check"}, None)
    assert result == {"ok": True, "failed": [], "advisoryFailed": []}
    output = capsys.readouterr().out
    assert "invalid_config" in output and "SECRET" not in output


def test_provider_exception_never_discloses_original_message(monkeypatch, capsys):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW + timedelta(seconds=2)
    def fail(*args, **kwargs):
        raise RuntimeError("token=SECRET-PROVIDER-MESSAGE")
    monkeypatch.setenv("OPS_SNAPSHOT_BUCKET", BUCKET)
    monkeypatch.setenv("OPS_SNAPSHOT_KEY", ops.KEY)
    monkeypatch.delenv("OPS_ALARM_NAMES", raising=False)
    monkeypatch.setattr(ops, "datetime", Clock)
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=fail))
    ops.publish_observation([CheckResult(n, True, 200, 1, None) for n in CHECK_NAMES], NOW)
    output = capsys.readouterr().out
    assert '"reason":"source_unavailable"' in output
    assert "SECRET" not in output and "token=" not in output
