from __future__ import annotations

import io
import json
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from synthetic_check import handler, operations_observer as observer
from synthetic_check.checks import CHECK_NAMES, CheckResult

ARN = "arn:aws:lambda:ap-southeast-2:622994489535:function:console-s2-observer:live"
NOW = datetime.now(timezone.utc)


def body(**values):
    return {"schemaVersion": 1, "observedAt": NOW.isoformat(), "status": "known", "stalled": False,
            "truncated": False, "items": [], "reason": None, **values}


class Client:
    def __init__(self, payload=None, **response):
        self.calls = []
        self.stream = io.BytesIO(json.dumps(body() if payload is None else payload).encode())
        self.response = {"StatusCode": 200, "Payload": self.stream, **response}

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def metric_rows(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if "_aws" in line]


def test_exact_single_invocation_and_stream_closed():
    client = Client()
    assert observer.invoke_once(client, ARN, NOW)
    assert client.calls == [{"FunctionName": ARN, "InvocationType": "RequestResponse", "Payload": observer.EVENT}]
    assert client.stream.closed


@pytest.mark.parametrize("values", [
    {"schemaVersion": True}, {"schemaVersion": 2}, {"extra": "secret"},
    {"observedAt": (NOW - timedelta(minutes=5)).isoformat()},
    {"observedAt": (NOW + timedelta(minutes=5)).isoformat()},
    {"stalled": True}, {"truncated": True}, {"reason": "secret"},
    {"status": "unknown", "stalled": None, "reason": "DB_UNAVAILABLE"},
    {"status": "unknown", "stalled": False, "reason": "DB_UNAVAILABLE"},
    {"items": [{}] * 21},
    {"stalled": True, "items": [{"phase": "dispatch", "jobId": "secret@example.com", "deckSlug": "deck", "buildId": "b", "sinceAt": NOW.isoformat()}]},
])
def test_malformed_or_unknown_sample_never_success(values):
    client = Client(body(**values))
    assert not observer.invoke_once(client, ARN, NOW)
    assert len(client.calls) == 1
    assert client.stream.closed


def test_valid_stalled_and_all_phases_are_accepted():
    items = [{"phase": phase, "jobId": phase, "deckSlug": "deck", "buildId": "b", "sinceAt": NOW.isoformat()}
             for phase in ("dispatch", "processing", "manifest")]
    assert observer.invoke_once(Client(body(stalled=True, items=items)), ARN, NOW)
    assert not observer.invoke_once(Client(body(stalled=True, items=items + [items[0]])), ARN, NOW)


@pytest.mark.parametrize("raw", [b"x" * 16385, b"{", b'\xff',
    b'{"schemaVersion":1,"schemaVersion":1,"observedAt":"x"}'])
def test_body_bound_and_invalid_json(raw):
    client = Client()
    client.stream = io.BytesIO(raw)
    client.response["Payload"] = client.stream
    assert not observer.invoke_once(client, ARN, NOW)
    assert client.stream.closed


@pytest.mark.parametrize("response", [{"FunctionError": "Unhandled"}, {"StatusCode": 403}, {"Payload": None}])
def test_transport_error(response):
    assert not observer.invoke_once(Client(**response), ARN, NOW)


def test_denied_and_timeout_do_not_retry_or_log_provider_text(capsys):
    class Denied:
        calls = 0
        def invoke(self, **kwargs):
            self.calls += 1
            raise RuntimeError("SECRET credential detail")
    client = Denied()
    assert not observer.invoke_once(client, ARN, NOW)
    assert client.calls == 1
    assert "SECRET" not in capsys.readouterr().out


def test_slow_stream_has_wall_deadline_and_late_result_discarded():
    release = threading.Event()
    closed = threading.Event()
    class Slow:
        def read(self, amount):
            assert amount == observer.MAX_BYTES + 1
            release.wait(2)
            return json.dumps(body()).encode()
        def close(self):
            closed.set()
    client = Client(Payload=Slow())
    start = time.monotonic()
    try:
        assert not observer.invoke_once(client, ARN, NOW, timeout_s=0.02)
        assert time.monotonic() - start < 0.5
    finally:
        release.set()
    assert closed.wait(1)
    assert len(client.calls) == 1


def test_invoke_creation_config_and_low_cardinality_metric(monkeypatch, capsys):
    client = Client()
    configurations = []
    def create(service, config):
        assert service == "lambda"
        configurations.append(config)
        return client
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=create))
    monkeypatch.setenv("OPS_OBSERVER_FUNCTION_ARN", ARN)
    observer.observe("DeveloperCardsConsoleS2_local", None, time.monotonic())
    config, = configurations
    assert config.connect_timeout == 1 and config.read_timeout == 9
    assert config.retries == {"total_max_attempts": 1}
    line, = metric_rows(capsys)
    assert line["ObserverInvokeSuccess"] == 1
    definition, = line["_aws"]["CloudWatchMetrics"]
    assert definition["Namespace"] == "DeveloperCardsConsoleS2_local"
    assert definition["Dimensions"] == [["Service"]]
    assert "items" not in line and "jobId" not in line


@pytest.mark.parametrize("why", ["budget", "elapsed", "config", "arn"])
def test_skip_emits_zero_without_creating_client(monkeypatch, capsys, why):
    monkeypatch.setenv("OPS_OBSERVER_FUNCTION_ARN", ARN if why != "arn" else ARN.rsplit(":", 1)[0])
    def forbidden(*args, **kwargs):
        pytest.fail("SDK must not be called")
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=forbidden))
    context = SimpleNamespace(get_remaining_time_in_millis=lambda: 11999 if why == "budget" else 60000)
    observer.observe("DeveloperCardsConsoleS2_local", context, time.monotonic() - (49 if why == "elapsed" else 0), config_valid=why != "config")
    line, = metric_rows(capsys)
    assert line["ObserverInvokeSuccess"] == 0


def test_handler_sequence_and_original_observation_watermark(monkeypatch):
    order = []
    monkeypatch.setenv("METRICS_NAMESPACE", "DeveloperCards")
    monkeypatch.setattr(handler, "load_settings", lambda: SimpleNamespace(config_error=None))
    def checks(settings):
        order.append("checks")
        return [CheckResult(name, True, 200, 1, None) for name in CHECK_NAMES]
    monkeypatch.setattr(handler, "run_checks", checks)
    monkeypatch.setattr(handler, "observe", lambda *args, **kwargs: order.append("observer"))
    captured = []
    monkeypatch.setattr(handler, "publish_observation", lambda results, at, context: (order.append("snapshot"), captured.append(at)))
    before = datetime.now(timezone.utc)
    assert handler.lambda_handler({"job": "synthetic-check"}, None) == {"ok": True, "failed": [], "advisoryFailed": []}
    assert order == ["checks", "observer", "snapshot"]
    assert before <= captured[0] <= datetime.now(timezone.utc)


@pytest.mark.parametrize("namespace,load_raises", [("", False), ("bad\nname", True), ("DeveloperCardsConsoleS2_local", True)])
def test_settings_failure_never_falls_into_production_namespace(monkeypatch, capsys, namespace, load_raises):
    monkeypatch.setenv("METRICS_NAMESPACE", namespace)
    monkeypatch.setenv("OPS_OBSERVER_FUNCTION_ARN", ARN)
    def load():
        if load_raises:
            raise RuntimeError("secret")
        return SimpleNamespace(config_error="bad")
    monkeypatch.setattr(handler, "load_settings", load)
    monkeypatch.setattr(handler, "publish_observation", lambda *args: None)
    result = handler.lambda_handler({"job": "synthetic-check"}, None)
    assert not result["ok"]
    metrics = metric_rows(capsys)
    assert all(row["_aws"]["CloudWatchMetrics"][0]["Namespace"] == namespace for row in metrics)
    if not namespace or "\n" in namespace:
        assert metrics == []
    else:
        assert any(row.get("ObserverInvokeSuccess") == 0 for row in metrics)


def test_missing_isolated_target_cannot_probe_production_defaults(monkeypatch, capsys):
    monkeypatch.setenv("METRICS_NAMESPACE", "DeveloperCardsConsoleS2_local")
    monkeypatch.delenv("API_BASE", raising=False)
    monkeypatch.setattr(handler, "run_checks", lambda *args: pytest.fail("must not probe default production URLs"))
    monkeypatch.setattr(handler, "publish_observation", lambda *args: None)
    assert not handler.lambda_handler({"job": "synthetic-check"}, None)["ok"]
