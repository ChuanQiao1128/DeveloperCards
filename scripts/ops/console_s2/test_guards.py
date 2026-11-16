"""Offline adversarial checks; no AWS, DB, browser, credentials or real JWTs."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from guards import Blocked, Ledger, LIMITS, sdk_client, validate_manifest


def manifest():
    run = "20261116t010000z-0123abcd"
    return {"schemaVersion": 1, "account": "622994489535", "region": "ap-southeast-2", "runId": run,
            "savedPlanSha256": "a" * 64, "sourceSha256": "b" * 64,
            "createdAt": "2026-11-16T01:00:00Z", "expiresAt": "2026-11-16T03:00:00Z",
            "corsOrigin": "http://localhost:5188", "callback": "http://localhost:5188/auth/callback",
            "logout": "http://localhost:5188/login", "tokenTtlMinutes": 5,
            "metricNamespace": "DeveloperCardsConsoleS2_" + run,
            "cleanup": {"reserveSDKCalls": 250, "registeredBeforeCreate": True},
            "productionDenyArns": ["arn:aws:s3:::production-bucket", "arn:aws:s3:::production-bucket/*",
                                   "arn:aws:sqs:ap-southeast-2:622994489535:production-queue",
                                   "arn:aws:secretsmanager:ap-southeast-2:622994489535:secret:production-secret"],
            "syntheticTargets": {key: "https://isolated.invalid" for key in ["API_BASE", "CDN_BASE", "CONSOLE_BASE", "REMOTE_CONFIG_URL", "COGNITO_CONSOLE_ISSUER", "COGNITO_MOBILE_ISSUER"]},
            "prerequisites": {key: {"status": "PASS", "sha256": "c" * 64} for key in ["independentReview", "ownerChannel", "productionAcl", "isolatedAcl", "schema61", "explain", "network", "artifactBinding", "cleanupDriver"]},
            "resources": []}


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.m = manifest()
        self.now = datetime(2026, 11, 16, 1, tzinfo=timezone.utc)
        self.path = Path(self.tmp.name) / "ledger.json"
        self.ledger = Ledger(self.path, self.m, now=lambda: self.now)

    def create(self):
        self.ledger.register_cleanup()
        self.ledger.creation_intent("bucket", "test-bucket")

    def test_secret_fields_rejected_without_value_in_error(self):
        self.m["PGPASSWORD"] = "do-not-display-this"
        with self.assertRaisesRegex(Blocked, "^SECRET_FIELD_FORBIDDEN$"):
            validate_manifest(self.m)

    def test_resource_caps(self):
        self.m["resources"] = [{"kind": "bucket"}, {"kind": "bucket"}]
        with self.assertRaisesRegex(Blocked, "RESOURCE_CAP_BUCKET"):
            validate_manifest(self.m)

    def test_foundation_with_unknown_db_proofs(self):
        self.m["prerequisites"]["productionAcl"]["status"] = "UNKNOWN"
        ledger = Ledger(self.path, self.m, now=lambda: self.now, phase="foundation")
        ledger.register_cleanup()
        ledger.creation_intent("core-bootstrap", "exact-core-name")
        with self.assertRaisesRegex(Blocked, "RUNTIME_PHASE_REQUIRED"):
            ledger.start_active()
        with self.assertRaisesRegex(Blocked, "RUNTIME_PHASE_REQUIRED"):
            ledger.consume("businessHTTP", inject=True)
        with self.assertRaises(Blocked):
            Ledger(Path(self.tmp.name)/"runtime.json", self.m, phase="runtime")

    def test_phase_promotion_keeps_clocks_counts_and_history(self):
        self.m["prerequisites"]["productionAcl"]["status"] = "UNKNOWN"
        ledger = Ledger(self.path, self.m, now=lambda: self.now, phase="foundation")
        ledger.register_cleanup()
        ledger.creation_intent("core-bootstrap", "exact-core-name")
        ledger.consume("sdkControl")
        ready = deepcopy(self.m)
        ready["prerequisites"]["productionAcl"] = {"status":"PASS","sha256":"f"*64}
        ledger.promote_runtime(ready)
        ledger.start_active()
        with ledger.state() as data:
            self.assertEqual(data["counts"]["sdkControl"],1)
            self.assertEqual(len(data["manifestHistory"]),1)
            self.assertIsNotNone(data["firstCreateAt"])

    def test_phase_promotion_rejects_changed_resource_scope(self):
        ledger = Ledger(self.path, self.m, now=lambda: self.now, phase="foundation")
        ledger.register_cleanup()
        ready = deepcopy(self.m)
        ready["productionDenyArns"].append("arn:aws:s3:::another-bucket")
        with self.assertRaisesRegex(Blocked,"PHASE_PROMOTION_CHANGED_FROZEN_INPUT"):
            ledger.promote_runtime(ready)

    def test_independent_watchdog_can_cleanup_after_phase_promotion(self):
        initial=deepcopy(self.m)
        ledger=Ledger(self.path,initial,now=lambda:self.now,phase="foundation")
        ledger.register_cleanup()
        ledger.creation_intent("core","owned-core")
        ready=deepcopy(self.m)
        ready["prerequisites"]["productionAcl"]["sha256"]="f"*64
        ledger.promote_runtime(ready)
        watchdog=Ledger(self.path,initial,now=lambda:self.now,phase="foundation",cleanup_only=True)
        watchdog.consume("cleanupSDK")
        with self.assertRaisesRegex(Blocked,"CLEANUP_ONLY_LEDGER"):
            watchdog.consume("sdkControl")
        with self.assertRaisesRegex(Blocked,"CLEANUP_ONLY_LEDGER"):
            watchdog.creation_intent("another","forbidden")

    def test_cleanup_start_stops_concurrent_work(self):
        self.create()
        with self.ledger.state() as state:state["cleanupStartedAt"]="2026-11-16T01:01:00Z"
        with self.assertRaisesRegex(Blocked,"CLEANUP_ALREADY_STARTED"):
            self.ledger.consume("businessHTTP")
        with self.assertRaisesRegex(Blocked,"CLEANUP_ALREADY_STARTED"):
            self.ledger.creation_intent("extra","forbidden")
        self.ledger.consume("cleanupSDK")

    def test_valid_manifest(self):
        validate_manifest(self.m)

    def test_wrong_account_namespace_cors_ttl_and_missing_probes(self):
        for field, value in [("account", "000000000000"), ("region", "us-east-1"),
                             ("metricNamespace", "DeveloperCards"), ("corsOrigin", "*"),
                             ("tokenTtlMinutes", 60), ("syntheticTargets", {})]:
            with self.subTest(field=field):
                m = deepcopy(self.m)
                m[field] = value
                with self.assertRaises(Blocked):
                    validate_manifest(m)

    def test_unknown_prerequisite_fails(self):
        self.m["prerequisites"]["productionAcl"]["status"] = "UNKNOWN"
        with self.assertRaises(Blocked):
            validate_manifest(self.m)

    def test_production_probe_fails(self):
        self.m["syntheticTargets"]["CDN_BASE"] = "https://cdn.developercards.app"
        with self.assertRaises(Blocked):
            validate_manifest(self.m)

    def test_overlong_resource_ttl_fails(self):
        self.m["expiresAt"] = "2026-11-16T03:00:01Z"
        with self.assertRaises(Blocked):
            validate_manifest(self.m)

    def test_no_create_before_cleanup(self):
        with self.assertRaises(Blocked):
            self.ledger.creation_intent("bucket", "test-bucket")

    def test_response_loss_keeps_intent_and_prevents_duplicate_create(self):
        self.create()
        data = json.loads(self.path.read_text())
        self.assertEqual(data["intents"]["bucket"]["status"], "pending")
        with self.assertRaises(Blocked):
            self.ledger.creation_intent("bucket", "test-bucket")
        self.ledger.reconcile("bucket", "test-bucket", self.tags())
        self.assertEqual(json.loads(self.path.read_text())["intents"]["bucket"]["status"], "owned")

    def tags(self):
        return {"ManagedBy": "console-acceptance-s2", "RunId": self.m["runId"], "ExpiresAt": self.m["expiresAt"]}

    def test_random_provider_id_reconciles_by_exact_name_and_tags(self):
        self.ledger.register_cleanup()
        self.ledger.creation_intent("pool", "exact-pool-name")
        self.ledger.reconcile("pool", "ap-southeast-2_ExactId", self.tags(), actual_name="exact-pool-name")
        self.ledger.cleanup_target("pool", "ap-southeast-2_ExactId", self.tags())

    def test_name_prefix_is_not_ownership(self):
        self.create()
        with self.assertRaises(Blocked):
            self.ledger.reconcile("bucket", "test-bucket", {})
        with self.assertRaises(Blocked):
            self.ledger.cleanup_target("bucket", "test-bucket", self.tags())

    def test_exact_cleanup_identity(self):
        self.create()
        self.ledger.reconcile("bucket", "test-bucket", self.tags())
        self.ledger.cleanup_target("bucket", "test-bucket", self.tags())
        with self.assertRaises(Blocked):
            self.ledger.cleanup_target("bucket", "production-bucket", self.tags())

    def test_active_deadline_and_stop_injection(self):
        self.create()
        self.ledger.start_active()
        self.now += timedelta(minutes=30)
        with self.assertRaises(Blocked):
            self.ledger.consume("businessHTTP", inject=True)
        self.ledger.consume("businessHTTP")
        with self.ledger.state() as data:
            self.assertEqual(self.ledger.deadline(data), datetime(2026, 11, 16, 1, 45, tzinfo=timezone.utc))

    def test_resource_deadline_can_shorten_active_window(self):
        self.create()
        self.now += timedelta(minutes=85)
        self.ledger.start_active()
        with self.ledger.state() as data:
            self.assertEqual(self.ledger.deadline(data), datetime(2026, 11, 16, 3, tzinfo=timezone.utc))
        self.now += timedelta(minutes=30)
        with self.assertRaises(Blocked):
            self.ledger.consume("businessHTTP", inject=True)
        self.ledger.consume("cleanupSDK")

    def test_setup_cannot_start_at_90_minutes(self):
        self.create()
        self.now += timedelta(minutes=90)
        with self.assertRaises(Blocked):
            self.ledger.start_active()

    def test_counter_is_durable_and_cleanup_separate(self):
        for _ in range(LIMITS["sdkControl"]):
            self.ledger.consume("sdkControl")
        with self.assertRaises(Blocked):
            Ledger(self.path, self.m, now=lambda: self.now).consume("sdkControl")
        self.ledger.consume("cleanupSDK")
        self.assertEqual(json.loads(self.path.read_text())["counts"]["cleanupSDK"], 1)

    def test_cleanup_is_bounded_even_after_deadline(self):
        self.now += timedelta(hours=3)
        for _ in range(LIMITS["cleanupSDK"]):
            self.ledger.consume("cleanupSDK")
        with self.assertRaises(Blocked):
            self.ledger.consume("cleanupSDK")

    def test_v4_sdk_cap_is_durable_and_v3_stays_400(self):
        self.assertEqual(LIMITS["sdkControl"], 400)
        for version, cap in (("s2-execution-budget-v3", 400), ("s2-execution-budget-v4", 500)):
            m = deepcopy(self.m)
            m["executionBudgetVersion"] = version
            path = self.path.with_name(version + ".json")
            ledger = Ledger(path, m, now=lambda: self.now)
            with ledger.state() as data:
                data["counts"]["sdkControl"] = cap - 1
            ledger.consume("sdkControl")
            with self.assertRaisesRegex(Blocked, "BUDGET_SDKCONTROL"):
                Ledger(path, m, now=lambda: self.now).consume("sdkControl")
            ledger.consume("cleanupSDK")
            state = json.loads(path.read_text())
            self.assertEqual(state["counts"], {"sdkControl": cap, "cleanupSDK": 1})

    def test_actual_sdk_factory_accepts_reviewed_versions_and_counts_hooks(self):
        try:
            import botocore.config
        except ImportError:
            self.skipTest("botocore unavailable")
        class Session:
            def __init__(self):
                self.hooks = {}
                self.calls = 0
            def client(self, service, **kwargs):
                self.calls += 1
                self.config = kwargs["config"]
                return SimpleNamespace(meta=SimpleNamespace(events=SimpleNamespace(register=self.hooks.__setitem__)))
        for version in ("s2-execution-budget-v3", "s2-execution-budget-v4"):
            m = deepcopy(self.m)
            m["executionBudgetVersion"] = version
            ledger = Ledger(self.path.with_name(version + "-sdk.json"), m, now=lambda: self.now)
            session = Session()
            sdk_client(session, "sts", ledger)
            self.assertEqual(session.config.retries["total_max_attempts"], 1)
            session.hooks["before-send.*.*"]()
            sdk_client(session, "lambda", ledger, cleanup=True)
            session.hooks["before-send.*.*"]()
            session.hooks["before-send.lambda.Invoke"]()
            self.assertEqual(json.loads(ledger.path.read_text())["counts"],
                             {"sdkControl": 1, "cleanupSDK": 1, "handlerInvocations": 1})
        m["executionBudgetVersion"] = "s2-execution-budget-v5"
        ledger = Ledger(self.path.with_name("unknown-sdk.json"), m, now=lambda: self.now)
        session = Session()
        for cleanup in (False, True):
            with self.assertRaisesRegex(Blocked, "AMENDED_EXECUTION_BUDGET_REVIEW_REQUIRED"):
                sdk_client(session, "sts", ledger, cleanup=cleanup)
        self.assertEqual(session.calls, 0)

    def test_manifest_change_does_not_reset_clock(self):
        self.create()
        m = deepcopy(self.m)
        m["sourceSha256"] = "d" * 64
        with self.assertRaises(Blocked):
            Ledger(self.path, m, now=lambda: self.now).consume("businessHTTP")

    def test_clock_cannot_restart(self):
        self.create()
        self.ledger.start_active()
        with self.assertRaises(Blocked):
            self.ledger.start_active()


if __name__ == "__main__":
    unittest.main()
