"""S2 root-only execution guards. No credentials or AWS calls at import time.

A driver must route *every* HTTP/browser/SDK attempt through these counters. This
module does not turn a Terraform apply into an accounted SDK lifecycle.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time

ACCOUNT = "622994489535"
REGION = "ap-southeast-2"
LIMITS = {"businessHTTP": 100, "browserHTTP": 500, "handlerInvocations": 150,
          "sdkControl": 400, "collectorScheduled": 8, "collectorProbes": 4,
          "observerInvocations": 12, "cleanupSDK": 250}
RUN_ID = re.compile(r"\d{8}t\d{6}z-[a-f0-9]{8}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
FOUNDATION_PREREQUISITES = ("independentReview", "ownerChannel", "network", "artifactBinding", "cleanupDriver")
PREREQUISITES = ("independentReview", "ownerChannel", "productionAcl", "isolatedAcl",
                 "schema61", "explain", "network", "artifactBinding", "cleanupDriver")
RESOURCE_KINDS = {"bucket", "queue", "function", "alias", "role", "policy", "logGroup",
                  "pool", "poolDomain", "poolClient", "poolGroup", "user", "api", "route", "authorizer",
                  "integration", "stage", "mapping", "schedule", "alarm", "securityGroup",
                  "ingressRule", "egressRule", "database", "databaseRole"}


class Blocked(RuntimeError):
    """Safe code-only failure; never include provider response or secret values."""


def utc():
    return datetime.now(timezone.utc)


def stamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise Blocked("INVALID_UTC_TIMESTAMP")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise Blocked("INVALID_UTC_TIMESTAMP") from None


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, code):
    if not condition:
        raise Blocked(code)


def reject_secrets(value):
    if isinstance(value, dict):
        forbidden = {"password", "pgpassword", "accesstoken", "idtoken", "refreshtoken", "bearer", "authorization", "secret", "secretstring", "token"}
        for key, item in value.items():
            require(str(key).lower().replace("_", "") not in forbidden, "SECRET_FIELD_FORBIDDEN")
            reject_secrets(item)
    elif isinstance(value, list):
        for item in value:
            reject_secrets(item)


def validate_manifest(m, *, require_ready=True, phase="runtime"):
    require(phase in ("foundation", "runtime"), "INVALID_EXECUTION_PHASE")
    reject_secrets(m)
    require(m.get("schemaVersion") == 1, "INVALID_MANIFEST_SCHEMA")
    require(m.get("account") == ACCOUNT and m.get("region") == REGION, "WRONG_ACCOUNT_REGION")
    require(isinstance(m.get("runId"), str) and RUN_ID.fullmatch(m["runId"]), "INVALID_RUN_ID")
    require(SHA.fullmatch(m.get("savedPlanSha256", "")), "PLAN_HASH_MISSING")
    require(SHA.fullmatch(m.get("sourceSha256", "")), "SOURCE_HASH_MISSING")
    require(stamp(m["expiresAt"]) > stamp(m["createdAt"]), "INVALID_RESOURCE_TTL")
    require(stamp(m["expiresAt"]) <= stamp(m["createdAt"]) + timedelta(minutes=120), "TTL_TOO_LONG")
    require(m.get("corsOrigin") == "http://localhost:5188", "INVALID_CORS")
    require(m.get("callback") == "http://localhost:5188/auth/callback", "INVALID_CALLBACK")
    require(m.get("logout") == "http://localhost:5188/login", "INVALID_LOGOUT")
    require(m.get("tokenTtlMinutes") == 5, "INVALID_TOKEN_TTL")
    require(m.get("metricNamespace") == "DeveloperCardsConsoleS2_" + m["runId"], "INVALID_NAMESPACE")
    require(m.get("cleanup", {}).get("reserveSDKCalls") == LIMITS["cleanupSDK"], "CLEANUP_RESERVE_MISSING")
    require(m.get("cleanup", {}).get("registeredBeforeCreate") is True, "CLEANUP_NOT_REGISTERED")
    deny = m.get("productionDenyArns", [])
    require(len(deny) >= 4 and all(isinstance(x, str) and x.startswith("arn:aws:") and not x.endswith(":*") for x in deny), "PROD_DENYLIST_MISSING")
    targets = m.get("syntheticTargets", {})
    require(set(targets) == {"API_BASE", "CDN_BASE", "CONSOLE_BASE", "REMOTE_CONFIG_URL", "COGNITO_CONSOLE_ISSUER", "COGNITO_MOBILE_ISSUER"}, "EXPLICIT_PROBES_REQUIRED")
    require(all(isinstance(x, str) and x.startswith("https://") and "developercards.app" not in x and "recallsmith-mobile-config" not in x for x in targets.values()), "PRODUCTION_PROBE_FORBIDDEN")
    resources = m.get("resources", [])
    require(isinstance(resources, list) and len(resources) <= 100, "RESOURCE_REGISTRY_INVALID")
    caps = {"bucket": 1, "queue": 2, "function": 4, "pool": 1, "api": 1,
            "schedule": 1, "alarm": 8, "user": 4, "database": 1, "databaseRole": 3}
    for kind, cap in caps.items():
        require(sum(x.get("kind") == kind for x in resources) <= cap, "RESOURCE_CAP_" + kind.upper())
    keys, identities = set(), set()
    for resource in resources:
        key = resource.get("key")
        require(isinstance(key, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", key) and key not in keys, "RESOURCE_KEY_INVALID")
        keys.add(key)
        require(resource.get("kind") in RESOURCE_KINDS, "UNKNOWN_RESOURCE_KIND")
        identity = resource.get("id")
        require(isinstance(identity, str) and identity and "*" not in identity and "?" not in identity and identity not in identities, "RESOURCE_ID_INVALID")
        identities.add(identity)
        require(resource.get("arn") not in deny, "PRODUCTION_RESOURCE_COLLISION")
        tags = resource.get("ownershipTags", {})
        require(tags == {"ManagedBy": "console-acceptance-s2", "RunId": m["runId"], "ExpiresAt": m["expiresAt"]}, "OWNERSHIP_MISMATCH")
        require(stamp(resource["createdAt"]) >= stamp(m["createdAt"]), "RESOURCE_PREDATES_RUN")
        if resource.get("arn"):
            arn = resource["arn"]
            require(isinstance(arn, str) and arn.startswith("arn:aws:") and "*" not in arn and "?" not in arn, "RESOURCE_ARN_INVALID")
            parts = arn.split(":", 5)
            require(len(parts) == 6 and (parts[3] in (REGION, "")) and (parts[4] in (ACCOUNT, "")), "FOREIGN_RESOURCE")
    if require_ready:
        for key in (FOUNDATION_PREREQUISITES if phase == "foundation" else PREREQUISITES):
            proof = m.get("prerequisites", {}).get(key, {})
            require(proof.get("status") == "PASS" and SHA.fullmatch(proof.get("sha256", "")), "PREREQUISITE_" + key.upper())
    return m


class Ledger:
    """Atomic, locked, non-resettable counters and write-ahead creation journal."""
    def __init__(self, path, manifest, now=utc, *, phase="runtime", cleanup_only=False):
        self.phase = phase
        self.cleanup_only = cleanup_only
        self.path = Path(path)
        self.manifest = validate_manifest(manifest, phase=phase)
        self.now = now
        self.manifest_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @contextmanager
    def state(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_suffix(self.path.suffix + ".lock")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if self.path.exists():
                require(not self.path.is_symlink(), "LEDGER_SYMLINK")
                data = json.loads(self.path.read_text())
                require(data["manifestSha256"] == self.manifest_hash or (self.cleanup_only and self.manifest_hash in data.get("manifestHistory", [])), "LEDGER_MANIFEST_CHANGED")
            else:
                data = {"schemaVersion": 1, "manifestSha256": self.manifest_hash,
                        "firstCreateAt": None, "activeStartAt": None, "counts": {}, "intents": {},
                        "cleanupRegistered": False, "cleanupComplete": False, "manifestHistory": []}
            yield data
            tmp_fd, tmp_path = tempfile.mkstemp(dir=self.path.parent, prefix=".s2-ledger-")
            try:
                with os.fdopen(tmp_fd, "w") as out:
                    json.dump(data, out, sort_keys=True)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(tmp_path, self.path)
                directory_fd = os.open(self.path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

    def deadline(self, data):
        candidates = [stamp(self.manifest["expiresAt"])]
        if data["firstCreateAt"]:
            candidates.append(stamp(data["firstCreateAt"]) + timedelta(minutes=120))
        if data["activeStartAt"]:
            candidates.append(stamp(data["activeStartAt"]) + timedelta(minutes=45))
        return min(candidates)

    def consume(self, category, *, inject=False, cleanup=False):
        require(category in LIMITS, "UNKNOWN_COUNTER")
        with self.state() as data:
            cleanup = cleanup or category == "cleanupSDK"
            require(not self.cleanup_only or cleanup, "CLEANUP_ONLY_LEDGER")
            if not cleanup:
                require(not data.get("cleanupStartedAt"), "CLEANUP_ALREADY_STARTED")
                # The final 5 minutes are reserved for recovery/export/teardown.
                require(self.now() < self.deadline(data) - timedelta(minutes=5), "WORK_DEADLINE")
            if inject:
                self.require_runtime()
                require(data["activeStartAt"] is not None, "ACTIVE_WINDOW_NOT_STARTED")
                require(self.now() < min(self.deadline(data) - timedelta(minutes=5), stamp(data["activeStartAt"]) + timedelta(minutes=30)), "INJECTION_DEADLINE")
            count = data["counts"].get(category, 0)
            require(count < LIMITS[category], "BUDGET_" + category.upper())
            data["counts"][category] = count + 1

    def _advance(self, manifest, phase):
        require(not self.cleanup_only,"CLEANUP_ONLY_LEDGER")
        validate_manifest(manifest, phase=phase)
        old, new = json.loads(json.dumps(self.manifest)), json.loads(json.dumps(manifest))
        for item in (old, new):
            item.pop("prerequisites", None)
            cloud = item.get("cloud", {})
            cloud.pop("artifacts", None)
            cloud.pop("publicJwks", None)
        require(old == new, "PHASE_PROMOTION_CHANGED_FROZEN_INPUT")
        for key, proof in self.manifest.get("prerequisites", {}).items():
            if proof.get("status") == "PASS":
                require(manifest["prerequisites"][key].get("status") == "PASS", "PREREQUISITE_DOWNGRADE")
        new_hash = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.state() as data:
            data.setdefault("manifestHistory", []).append(self.manifest_hash)
            data["manifestSha256"] = new_hash
        self.manifest, self.manifest_hash, self.phase = manifest, new_hash, phase

    def attest_foundation(self, manifest):
        require(self.phase == "foundation", "FOUNDATION_PHASE_REQUIRED")
        self._advance(manifest, "foundation")

    def promote_runtime(self, manifest):
        """Root freezes measured proofs/JWKS packages; counters/clocks are retained."""
        self._advance(manifest, "runtime")

    def returned(self, key, identity):
        """Persist exact create result before tags/readbacks or any other API."""
        require(isinstance(identity, str) and identity and "*" not in identity, "INVALID_RETURNED_ID")
        with self.state() as data:
            require(key in data["intents"], "CREATE_INTENT_MISSING")
            data["intents"][key].update(id=identity, status="returned")

    def register_cleanup(self):
        require(not self.cleanup_only,"CLEANUP_ONLY_LEDGER")
        with self.state() as data:
            require(not data["firstCreateAt"], "CLEANUP_REGISTERED_LATE")
            data["cleanupRegistered"] = True

    def require_runtime(self):
        require(not self.cleanup_only,"CLEANUP_ONLY_LEDGER")
        require(self.phase == "runtime", "RUNTIME_PHASE_REQUIRED")
        validate_manifest(self.manifest, phase="runtime")

    def start_active(self):
        self.require_runtime()
        with self.state() as data:
            require(data["firstCreateAt"] is not None, "NO_RESOURCES_CREATED")
            require(data["activeStartAt"] is None, "ACTIVE_CLOCK_ALREADY_STARTED")
            require(self.now() < stamp(data["firstCreateAt"]) + timedelta(minutes=90), "SETUP_TOO_LONG")
            data["activeStartAt"] = self.now().isoformat().replace("+00:00", "Z")

    def creation_intent(self, key, expected_identity):
        require(not self.cleanup_only,"CLEANUP_ONLY_LEDGER")
        require(re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", key), "INVALID_INTENT_KEY")
        require(isinstance(expected_identity, str) and expected_identity and "*" not in expected_identity and "?" not in expected_identity, "INVALID_EXPECTED_ID")
        with self.state() as data:
            require(data["cleanupRegistered"], "CLEANUP_NOT_INSTALLED")
            require(not data.get("cleanupStartedAt"),"CLEANUP_ALREADY_STARTED")
            require(self.now() < self.deadline(data) - timedelta(minutes=5), "CREATE_DEADLINE")
            require(key not in data["intents"], "RECONCILE_UNCERTAIN_CREATE_FIRST")
            when = self.now().isoformat().replace("+00:00", "Z")
            data["firstCreateAt"] = data["firstCreateAt"] or when
            data["intents"][key] = {"expectedIdentity": expected_identity, "status": "pending", "at": when}
        # Durable commit above completes before the caller may issue its create API.

    def reconcile(self, key, actual_identity, actual_tags, *, actual_name=None):
        with self.state() as data:
            require(key in data["intents"], "CREATE_INTENT_MISSING")
            intent = data["intents"][key]
            require((actual_name or actual_identity) == intent["expectedIdentity"], "CREATE_IDENTITY_MISMATCH")
            require(isinstance(actual_identity, str) and actual_identity and "*" not in actual_identity and "?" not in actual_identity, "INVALID_RETURNED_ID")
            expected_tags = {"ManagedBy": "console-acceptance-s2", "RunId": self.manifest["runId"], "ExpiresAt": self.manifest["expiresAt"]}
            require(actual_tags == expected_tags, "RECONCILE_OWNERSHIP_MISMATCH")
            intent.update(status="owned", id=actual_identity)

    def cleanup_target(self, key, live_identity, live_tags):
        # Never infer ownership merely from a prefix. Verify registry and live ownership.
        resource = next((x for x in self.manifest["resources"] if x["key"] == key), None)
        if resource is not None:
            require(resource["id"] == live_identity and resource["ownershipTags"] == live_tags, "CLEANUP_OWNERSHIP_MISMATCH")
            return resource
        with self.state() as data:
            intent = data["intents"].get(key, {})
            require(intent.get("status") == "owned" and intent.get("id") == live_identity, "UNKNOWN_CLEANUP_TARGET")
            expected_tags = {"ManagedBy": "console-acceptance-s2", "RunId": self.manifest["runId"], "ExpiresAt": self.manifest["expiresAt"]}
            require(live_tags == expected_tags, "CLEANUP_OWNERSHIP_MISMATCH")
            return dict(intent)


def sdk_client(session, service, ledger, *, cleanup=False, deadline_monotonic=None):
    """Counts each actual wire attempt, including each pagination/poll request.

    Callers count business/observer/collector invokes separately. SDK retries are
    disabled using total_max_attempts (max_attempts=1 would permit a retry).
    """
    require(ledger.manifest.get("executionBudgetVersion") == "s2-execution-budget-v3", "AMENDED_EXECUTION_BUDGET_REVIEW_REQUIRED")
    from botocore.config import Config
    client = session.client(service, region_name=REGION, config=Config(
        connect_timeout=1, read_timeout=9, retries={"total_max_attempts": 1, "mode": "standard"}))
    def before_send(**_):
        require(deadline_monotonic is None or time.monotonic()<deadline_monotonic,"CLEANUP_TIME_LIMIT")
        ledger.consume("cleanupSDK" if cleanup else "sdkControl")
    client.meta.events.register("before-send.*.*", before_send)
    client.meta.events.register("before-send.lambda.Invoke", lambda **_: ledger.consume("handlerInvocations", cleanup=cleanup))
    return client
