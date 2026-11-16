#!/usr/bin/env python3
"""S2 root preflight and explicit incomplete-stage boundary. Never reads credentials locally.

Real cloud/browser execution requires the reviewed root driver; these commands do
not manufacture PASS from a checklist, copied logs, a fake JWT or a local receipt.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import socket

from guards import Blocked, validate_manifest, digest, require
from observations import incident_requirements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "auth", "drills", "cleanup", "plan-check"))
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--read-only", action="store_true")
    parser.add_argument("--phase", choices=("foundation","runtime"), default="runtime")
    parser.add_argument("--deadline-seconds", type=int, default=2700)
    args = parser.parse_args()
    try:
        require(args.manifest.is_absolute() and args.manifest.stat().st_size <= 65536, "INVALID_MANIFEST_FILE")
        manifest = json.loads(args.manifest.read_text())
        validate_manifest(manifest,phase=args.phase)
        require(args.deadline_seconds == 2700, "ACTIVE_WINDOW_MUST_BE_2700_SECONDS")
        if args.command == "plan-check":
            plan = Path(manifest.get("savedPlanPath", ""))
            require(plan.is_absolute() and digest(plan) == manifest["savedPlanSha256"], "SAVED_PLAN_HASH_MISMATCH")
            print(json.dumps({"status": "PASS", "scope": "saved bytes only; exact plan/resource/security review still required"}))
            return 0
        if args.command == "preflight":
            require(args.read_only, "PREFLIGHT_REQUIRES_READ_ONLY")
            with socket.socket() as probe:
                try:
                    probe.bind(("127.0.0.1", 5188))
                except OSError:
                    raise Blocked("LOOPBACK_5188_ALREADY_IN_USE") from None
            print(json.dumps({"status": "UNKNOWN", "localManifest": "PASS", "port5188Free": True,
                              "liveAccountOwnershipAndAcl": "NOT_OBSERVED", "cloudCalls": 0,
                              "reason": "ROOT_LIVE_PREFLIGHT_REQUIRED"}))
            return 2
        print(json.dumps({"status": "UNKNOWN", "command": args.command, "cloudCalls": 0,
                          "reason": "REVIEWED_ROOT_DRIVER_NOT_BOUND",
                          "requirements": incident_requirements() if args.command == "drills" else None}))
        return 2
    except Blocked as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error), "cloudCalls": 0}))
        return 2
    except Exception:
        # Provider errors, malformed JSON and filenames can contain secrets. Code only.
        print(json.dumps({"status": "BLOCKED", "reason": "INVALID_OR_UNAVAILABLE_INPUT", "cloudCalls": 0}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
