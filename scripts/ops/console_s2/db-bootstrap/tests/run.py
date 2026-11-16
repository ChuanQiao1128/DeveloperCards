#!/usr/bin/env python3
"""Run fixed-helper checks in one owned loopback-only PostgreSQL17 container."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dotnet', default=os.environ.get('DOTNET') or shutil.which('dotnet'))
    args = parser.parse_args()
    if not args.dotnet:
        raise RuntimeError('DOTNET10_REQUIRED')
    name = 'console-s2-db-test-' + uuid.uuid4().hex[:12]
    container = None
    try:
        created = subprocess.run(['docker', 'run', '--rm', '-d', '--name', name,
            '--label', 'console-s2-owned-local=true', '-e', 'POSTGRES_PASSWORD=s2-local-fixture',
            '-p', '127.0.0.1::5432', 'postgres:17-alpine'], capture_output=True, text=True, check=True, timeout=60)
        container = created.stdout.strip()
        for _ in range(50):
            if subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'], capture_output=True, timeout=3).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('LOCAL_PG_START_DEADLINE')
        metadata = json.loads(subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, check=True, timeout=10).stdout)[0]
        port = metadata['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
        env = dict(os.environ, S2_TEST_CONNECTION='Host=127.0.0.1;Port=' + port + ';Database=postgres;Username=postgres;Password=s2-local-fixture;SSL Mode=Disable')
        project = Path(__file__).with_name('DbBootstrapChecks.csproj')
        return subprocess.run([args.dotnet, 'run', '--project', str(project)], env=env, timeout=150).returncode
    finally:
        if container:
            checked = subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, timeout=10)
            if checked.returncode == 0:
                live = json.loads(checked.stdout)[0]
                if live['Name'] != '/' + name or live['Config']['Labels'].get('console-s2-owned-local') != 'true':
                    raise RuntimeError('LOCAL_CLEANUP_OWNERSHIP_MISMATCH')
                subprocess.run(['docker', 'rm', '-f', container], capture_output=True, check=True, timeout=30)


if __name__ == '__main__':
    sys.exit(main())
