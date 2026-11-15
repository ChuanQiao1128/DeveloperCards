#!/usr/bin/env python3
"""Run exactly two local integration drills and bind their evidence to source bytes.

No endpoint arguments, provider credentials, deployment, model API, scheduler or external notification.
Use only with the exclusive .NET test slot; test fixtures create/dispose their own PostgreSQL container.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
TEST = 'src_C/Tests/RecallSmith.Lambda.IntegrationTests/OperationalRecoveryDrillTests.cs'
SOURCES = [TEST, 'src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs',
           'src_C/Vpc/Runtime/ProgressEvents.cs', 'src_C/Vpc/Authoring/Publish.cs',
           'src_C/Shared/RecallSmith.Lambda.Db/PublishDelivery.cs',
           'src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs',
           'src_C/Worker/Services/PublishJobProcessor.cs', 'src_C/Worker/S3/S3DeckUploader.cs',
           'infra/modules/observability/dashboard.tf',
           'scripts/ops/operational_recovery_drills.py']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', required=True, type=Path)
    parser.add_argument('--dotnet', default='/opt/homebrew/opt/dotnet@10/bin/dotnet')
    parser.add_argument('--attempt', required=True, type=int, choices=(1, 2, 3))
    args = parser.parse_args()
    directory = args.evidence_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    # Refuse remote Docker targets rather than running a fixture against somebody else's daemon.
    docker_host = os.environ.get('DOCKER_HOST', '')
    if docker_host and not docker_host.startswith('unix://'):
        parser.error('Drills require the local Docker Unix socket')
    command = [args.dotnet, 'test', 'src_C/Tests/RecallSmith.Lambda.IntegrationTests', '--no-restore',
               '--filter', 'FullyQualifiedName~OperationalRecoveryDrillTests', '--logger', 'console;verbosity=normal']
    snapshot = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in SOURCES}
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    prefix = directory / f'P5-drills-attempt{args.attempt}'
    # No overwriting failed attempts or consuming a stale successful JSON file as new evidence.
    with prefix.with_suffix('.log').open('x') as log:
        for name in ('sync', 'publish'):
            target = directory / f'P5-{name}-drill.json'
            if target.exists():
                target.rename(directory / f'P5-{name}-before-attempt{args.attempt}.json')
        start = time.monotonic()
        process = subprocess.run(command, cwd=ROOT,
                                 env={**os.environ, 'P5_DRILL_EVIDENCE_DIR': str(directory)},
                                 stdout=log, stderr=subprocess.STDOUT, timeout=180)
    manifest = dict(schema=1, sourceCommit=head, sourceSha256=snapshot, command=command,
                    exitCode=process.returncode, elapsedSeconds=round(time.monotonic()-start, 3),
                    scope='local integration only', providerDelivery='UNKNOWN',
                    budget=dict(drills=2, handlerInvocations=30, businessHttpRequests=0,
                                localNotificationReceipts=4, secondsPerDrill=60,
                                totalCommandSeconds=180, eventBytes=65536), receipts=[])
    if process.returncode == 0:
        evidence = [json.loads((directory / f'P5-{name}-drill.json').read_text()) for name in ('sync', 'publish')]
        assert [x['drill'] for x in evidence] == ['sync', 'publish']
        assert sum(x['handlerInvocations'] for x in evidence) <= 30
        assert sum(len(x['notificationReceipts']) for x in evidence) == 4
        assert sum((directory / f'P5-{name}-drill.json').stat().st_size for name in ('sync', 'publish')) <= 65536
        assert all(x['elapsedMs'] < 60000 for x in evidence)
        assert all([r['state'] for r in x['notificationReceipts']] == ['ALARM', 'OK'] for x in evidence)
        assert all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest for path, digest in snapshot.items())
        manifest['receipts'] = [{ 'file': f'P5-{x["drill"]}-drill.json',
            'sha256': hashlib.sha256((directory / f'P5-{x["drill"]}-drill.json').read_bytes()).hexdigest()} for x in evidence]
    prefix.with_suffix('.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))
    raise SystemExit(process.returncode)


if __name__ == '__main__':
    main()
