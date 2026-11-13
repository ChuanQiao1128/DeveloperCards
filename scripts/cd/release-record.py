#!/usr/bin/env python3
"""Create a local release record from CD's SHA256SUMS. No service calls or deployment."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess


def make_record(repo, manifest, expected_hash, commit, content_build, ota_runtime):
    repo, manifest = pathlib.Path(repo).resolve(), pathlib.Path(manifest).resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('commit must be a full Git SHA')
    subprocess.run(['git', 'cat-file', '-e', commit + '^{commit}'], cwd=repo, check=True, capture_output=True)
    if not re.fullmatch(r'[0-9a-f]{64}', expected_hash):
        raise ValueError('manifest hash must be SHA-256')
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != expected_hash:
        raise ValueError('CD manifest hash mismatch')
    for value in [content_build, ota_runtime]:
        if not value or len(value) > 128 or not re.fullmatch(r'[A-Za-z0-9._-]+', value):
            raise ValueError('invalid build/runtime identifier')
    artifacts = []
    for line in manifest.read_text().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            raise ValueError('invalid SHA256SUMS line')
        digest, name = match.groups()
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or not path.parts:
            raise ValueError('invalid artifact path')
        actual = (manifest.parent / name).resolve()
        actual.relative_to(manifest.parent)
        if (manifest.parent / name).is_symlink() or not actual.is_file() or hashlib.sha256(actual.read_bytes()).hexdigest() != digest:
            raise ValueError('artifact hash mismatch')
        artifacts.append({'path': name, 'sha256': digest})
    if not artifacts or len({a['path'] for a in artifacts}) != len(artifacts):
        raise ValueError('empty or duplicate manifest')
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo))
    return {'format': 'local-release-record-v1', 'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sourceCommit': commit, 'binding': 'LOCAL_ATTESTATION_UNDEPLOYED', 'workingTreeDirty': dirty, 'artifactManifestSha256': expected_hash,
            'artifacts': artifacts, 'supportedDatabaseSchema': {'minimum': 55},
            'intendedContentBuild': content_build, 'intendedOtaRuntime': ota_runtime,
            'live': {key: 'UNKNOWN' for key in ['lambdaAlias', 'sourceCommit', 'artifactSha256', 'databaseSchema', 'contentBuild', 'otaRuntime', 'billing']}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', default='.')
    p.add_argument('--manifest', required=True)
    p.add_argument('--manifest-sha256', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--content-build', required=True)
    p.add_argument('--ota-runtime', required=True)
    p.add_argument('--out', required=True)
    a = p.parse_args()
    try:
        result = make_record(a.repo, a.manifest, a.manifest_sha256, a.commit, a.content_build, a.ota_runtime)
        with open(a.out, 'x') as out:
            json.dump(result, out, indent=2)
            out.write('\n')
    except (ValueError, OSError, subprocess.CalledProcessError) as ex:
        p.exit(1, 'release record rejected: ' + str(ex) + '\n')


if __name__ == '__main__':
    main()
