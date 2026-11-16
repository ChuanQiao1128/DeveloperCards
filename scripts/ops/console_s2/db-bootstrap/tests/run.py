#!/usr/bin/env python3
"""Run fixed-helper checks in one owned loopback-only PostgreSQL17 container."""
import argparse
import json
import os
from pathlib import Path
import shutil
import select
import socket
import socketserver
import tempfile
import threading
import subprocess
import sys
import time
import uuid


class GrantProxy(socketserver.ThreadingTCPServer):
    """Local fixture only: count fixed owner grants or lose their committed server response."""
    daemon_threads = True
    def __init__(self, target_port, counter, lose_response=False):
        self.target_port = target_port
        self.counter = counter
        self.lose_response = lose_response
        self.grants = 0
        self.committed = 0
        self.confirmed = Path(str(counter) + '.committed'); self.confirmed.write_text('0')
        self.lock = threading.Lock()
        super().__init__(('127.0.0.1', 0), GrantRelay)
    def observed_grant(self):
        with self.lock:
            self.grants += 1
            self.counter.write_text(str(self.grants))


class GrantRelay(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with socket.create_connection(('127.0.0.1', self.server.target_port), timeout=5) as upstream:
                downstream = self.request
                pending = b''
                response = b''
                grant = False
                committed_command = False
                while True:
                    ready, _, _ = select.select([downstream, upstream], [], [], 15)
                    if not ready:
                        return
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        if source is downstream:
                            if not grant:
                                pending = (pending + data)[-65536:]
                                if b'grant "dc_console_s2_' in pending and b'to postgres with admin false, inherit false, set true' in pending:
                                    grant = True
                                    self.server.observed_grant()
                            upstream.sendall(data)
                        elif grant and self.server.lose_response:
                            response += data
                            while len(response) >= 5:
                                size = int.from_bytes(response[1:5], 'big') + 1
                                if size < 5 or size > 1048576:
                                    return
                                if len(response) < size:
                                    break
                                kind, payload = response[:1], response[5:size]
                                response = response[size:]
                                committed_command |= kind == b'C' and payload in (b'GRANT\0', b'GRANT ROLE\0')
                                # ReadyForQuery follows commit; close without delivering the GRANT result.
                                if kind == b'Z' and committed_command:
                                    with self.server.lock:
                                        self.server.committed += 1
                                        self.server.confirmed.write_text(str(self.server.committed))
                                    return
                        else:
                            downstream.sendall(data)
        except (OSError, TimeoutError):
            return


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
            '--label', 'console-s2-owned-local=true', '-e', 'POSTGRES_USER=fixture_bootstrap', '-e', 'POSTGRES_DB=postgres', '-e', 'POSTGRES_PASSWORD=s2-local-fixture',
            '-p', '127.0.0.1::5432', 'postgres:17-alpine'], capture_output=True, text=True, check=True, timeout=60)
        container = created.stdout.strip()
        for _ in range(50):
            if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'fixture_bootstrap'], capture_output=True, timeout=3).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise RuntimeError('LOCAL_PG_START_DEADLINE')
        metadata = json.loads(subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, check=True, timeout=10).stdout)[0]
        port = metadata['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
        subprocess.run(['docker', 'exec', container, 'psql', '-U', 'fixture_bootstrap', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD 's2-local-fixture'; ALTER DATABASE postgres OWNER TO postgres;"], capture_output=True, text=True, check=True, timeout=10)
        env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'TMPDIR')}
        env.update(S2_TEST_CONNECTION='Host=127.0.0.1;Port=' + port + ';Database=postgres;Username=postgres;Password=s2-local-fixture;SSL Mode=Disable')
        project = Path(__file__).with_name('DbBootstrapChecks.csproj')
        with tempfile.TemporaryDirectory(prefix='s2-local-faults-') as temporary:
            counter = Path(temporary) / 'grants.txt'; counter.write_text('0')
            loss_counter = Path(temporary) / 'lost-grants.txt'; loss_counter.write_text('0')
            with GrantProxy(int(port), counter) as observed, GrantProxy(int(port), loss_counter, True) as lossy:
                for proxy in (observed, lossy):
                    threading.Thread(target=proxy.serve_forever, daemon=True).start()
                env.update(S2_TEST_GRANT_OBSERVER_PORT=str(observed.server_address[1]), S2_TEST_GRANT_LOSS_PORT=str(lossy.server_address[1]), S2_TEST_GRANT_COUNT_PATH=str(counter), S2_TEST_GRANT_LOSS_COUNT_PATH=str(loss_counter))
                try:
                    return subprocess.run([args.dotnet, 'run', '--project', str(project)], env=env, timeout=150).returncode
                finally:
                    observed.shutdown(); lossy.shutdown()
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
