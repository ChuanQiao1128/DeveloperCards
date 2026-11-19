#!/usr/bin/env python3
"""Prepare a Console release from frozen card reviews; never publish or run a model."""
import argparse
import copy
import fcntl
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import os
import base64
from urllib.parse import urlparse

import repair_batch as batch
import repair_cards as cards

SESSION_STATE_PATH = batch.PROJECT / 'docs/delivery/session-state.json'

PUBLISHER_CODE_FILES = (
    'tools/aws_cards/repair_batch.py', 'tools/aws_cards/repair_release.py', 'tools/aws_cards/repair_cards.py',
    'tools/aws_cards/validate_release_json.mjs', 'frontend/src/lib/contentRelease.ts',
    'frontend/src/lib/contentReleaseDelivery.ts', 'frontend/src/lib/contentReleaseStatus.ts', 'frontend/src/lib/releaseArtifacts.ts',
    'frontend/src/lib/releaseJournalStore.ts', 'frontend/src/pages/ContentReleasePage.tsx',
    'frontend/src/types/contentRelease.ts', 'frontend/package-lock.json', '.github/workflows/ci.yml')
REQUIRED_CODE_CHECKS = {'CodeQL', 'frontend (vitest + build)', 'frontend (playwright smoke)',
    'backend (dotnet test)', 'python (uv lock + pytest)', 'mobile (typecheck + vitest + expo export)',
    'tools/mcp-server (build + vitest)', 'tools/author-runner (build + vitest)',
    'infra (terraform fmt/validate + agent routes + deploy scripts)', 'integrations/n8n (signature verifier + recipe logic)'}


def verified_publisher_code(proof_path, main_sha):
    proof = cards.read(proof_path)
    require(proof.get('schema') == 'verified-publisher-code-v1' and
            proof.get('repository') == 'ChuanQiao1128/DeveloperCards' and proof.get('mainSHA') == main_sha,
            'Publisher-code verification does not bind this main SHA')
    checks = proof.get('checks', [])
    require(REQUIRED_CODE_CHECKS <= {c['name'] for c in checks} and
            all(c['status'] == 'completed' and c['conclusion'] == 'success' for c in checks if c['name'] in REQUIRED_CODE_CHECKS),
            'Publisher-code required checks are incomplete or failed')
    files = proof.get('files', {})
    require(all(name in files and files[name].get('sourceExact') is True and
                files[name].get('sha256') == cards.sha(batch.PROJECT / name) for name in PUBLISHER_CODE_FILES),
            'Publisher code changed since its verified main version; merge and refresh the verification record')
    return {name: files[name]['sha256'] for name in PUBLISHER_CODE_FILES}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(card):
    result = copy.deepcopy(card)
    result.pop('revision', None)
    result.setdefault('mcq', None)
    result.setdefault('frontHelp', None)
    return result


def bind_proof(files, path, expected=None):
    name = str(path)
    expected = files.get(name, expected) if expected is None else expected
    actual = cards.sha(path)
    require(expected is None or actual == expected, 'Validated proof changed: ' + name)
    require(name not in files or files[name] == actual, 'Conflicting proof binding: ' + name)
    files[name] = actual


def inference(folder, role, proofs=None):
    before = {str(folder / name): cards.sha(folder / name) for name in
              ['request.json', 'response.json', 'result.json', 'input.json', 'output.json', 'schema.json']}
    result = cards.read(folder / 'result.json')
    require(result['exitCode'] == 0 and result['completedTurns'] == 1 and not result['toolCalls'], 'Incomplete model execution')
    require(result.get('transport') == 'existing-local-responses-provider', 'Unrecognized model execution')
    for filename, field in [('input.json', 'inputSha256'), ('output.json', 'outputSha256'),
                            ('request.json', 'requestSha256'), ('schema.json', 'schemaSha256')]:
        require(cards.sha(folder / filename) == result[field], 'Model binding changed: ' + filename)
    output = cards.read(folder / 'output.json')
    batch.validate_schema(output, batch.AUTHOR_SCHEMA if role == 'author' else batch.REVIEW_SCHEMA)
    request = cards.read(folder / 'request.json')
    require(json.loads(request['input'][1]['content']) == cards.read(folder / 'input.json'), 'Request input differs from reviewed packet')
    require(request['text']['format']['schema'] == cards.read(folder / 'schema.json'), 'Request schema changed')
    response = cards.read(folder / 'response.json')
    require(response.get('status') == 'completed' and bool(response.get('usage')) and
            all(item.get('type') in {'message', 'reasoning'} for item in response.get('output', [])), 'Incomplete recorded response')
    raw = ''.join(part['text'] for item in response['output'] if item['type'] == 'message'
                  for part in item.get('content', []) if part.get('type') == 'output_text')
    recorded = json.loads(raw)
    if role == 'review':
        recorded = batch.normalize_review_labels(recorded)
    require(recorded == output, 'Output differs from recorded model response')
    packet = cards.read(folder / 'input.json')
    for name, expected in before.items():
        bind_proof(proofs if proofs is not None else {}, Path(name), expected)
    return packet, output


def validate_evidence(original, current, sources):
    batch.validate_evidence_reuse(original, current)
    ids = {e['id'] for e in current['evidence']}
    require(bool(ids) and len(ids) == len(current['evidence']), 'Duplicate or absent evidence')
    for card in current['cards']:
        require(bool(card['evidenceIds']) and set(card['evidenceIds']) <= ids, 'Unknown candidate citation')
    for evidence in current['evidence']:
        require(urlparse(evidence['url']).hostname in {'docs.aws.amazon.com', 'aws.amazon.com'}, 'Nonofficial evidence')
        require(bool(evidence['text'].strip()) and any(
            s.get('url') == evidence['url'] and evidence['text'] in s.get('text', '') for s in sources
        ), 'Unbound official quote')


def verified_patch(packet_path, trial, reviewed, repair=None, manual=False):
    proofs = {}
    for p in [packet_path, packet_path.with_name('source-bindings.json'), trial / 'baseline.snapshot.json',
              trial / 'result.json', reviewed / 'candidate.cards.json', reviewed / 'cards.import.json',
              reviewed / 'draft-manifest.json']:
        bind_proof(proofs, p)
    packet = cards.read(packet_path)
    bindings = cards.read(packet_path.with_name('source-bindings.json'))
    require(cards.sha(packet_path) == bindings['packetSha256'] and
            cards.sha(trial / 'baseline.snapshot.json') == bindings['baselineSha256'], 'Frozen input changed')
    sources = []
    for source in bindings['files']:
        raw = subprocess.run([sys.executable, '-c',
            'from pathlib import Path; import sys; sys.stdout.buffer.write(Path(sys.argv[1]).read_bytes())',
            source['path']], check=True, capture_output=True, timeout=15).stdout
        require(hashlib.sha256(raw).hexdigest() == source['sha256'], 'Official source changed')
        bind_proof(proofs, Path(source['path']), source['sha256'])
        sources.append(json.loads(raw))
    if manual:
        baseline = cards.read(trial / 'baseline.snapshot.json')
        original_cards = baseline['cards'] if isinstance(baseline, dict) else baseline
        originals = {c['stableUid']: c for c in original_cards}
        require(all(c['uid'] in originals and all(c[k] == v for k, v in cards.view(originals[c['uid']]).items())
                    for c in packet['cards']), 'Manual packet original scope differs from the published baseline')
        source = cards.read(trial / 'manual-source.json')
        bind_proof(proofs, trial / 'manual-source.json')
        require(source['kind'] == 'manual-chat' and source['automaticAuthorCalls'] == 0
                and cards.sha(source['sourcePath']) == source['sourceSha256']
                and cards.sha(trial / 'manual-patch.json') == source['sourceSha256'], 'Manual source changed')
        bind_proof(proofs, Path(source['sourcePath']), source['sourceSha256'])
        bind_proof(proofs, trial / 'manual-patch.json', source['sourceSha256'])
        candidate = cards.read(trial / 'manual-patch.json')
        batch.validate_schema(candidate, batch.AUTHOR_SCHEMA)
    else:
        author_input, candidate = inference(trial / 'author', 'author', proofs)
        require(author_input == packet, 'Author packet changed')
    original_input, original_review = inference(trial / 'review', 'review', proofs)
    require(original_input['cards'] == candidate['cards'], 'Initial review did not see the candidate')
    if manual:
        require(original_input == batch.review_input(packet, candidate), 'Manual review scope or evidence changed')
        require_current_rules(trial / 'review')
    validate_evidence(packet, original_input, sources)
    initial = cards.read(trial / 'result.json')
    require(cards.sha(trial / 'draft/candidate.cards.json') == initial['candidateSha256'] and
            cards.sha(trial / 'review/input.json') == initial['reviewInputSha256'] and
            cards.sha(trial / 'review/output.json') == initial['reviewOutputSha256'], 'Initial closeout changed')
    final_result_path = reviewed / 'result.json' if (reviewed / 'result.json').exists() else trial / 'result.json'
    final = cards.read(final_result_path)
    bind_proof(proofs, final_result_path)
    require(final['status'] == 'REVIEWED_DRAFT' and cards.sha(reviewed / 'candidate.cards.json') == final['candidateSha256'], 'Draft is not bound and approved')
    rows = candidate['cards']
    uid_list = [c['uid'] for c in rows]
    require(1 <= len(uid_list) <= 10 and len(set(uid_list)) == len(uid_list), 'Expected 1-10 unique reviewed cards')
    require(uid_list == [c['uid'] for c in packet['cards']], 'Card identity/order changed')
    review = original_review
    if repair:
        require(initial['status'] == 'NEEDS_REPAIR' and final.get('targetedRepairRounds') == 1, 'Unexpected repair round')
        current, second = inference(repair / 'review', 'review', proofs)
        allowed_transfers = None
        if manual:
            require_current_rules(repair / 'review')
            allowed_transfers = batch.manual_target_context(original_input, current, original_review)
        failing = {r['uid'] for r in original_review['cards'] if r['pass'] is not True}
        require(len(current['cards']) == len(failing) and {c['uid'] for c in current['cards']} == failing and
                batch.review_ok(second, failing, allowed_transfers), 'Repair does not close exactly the failed cards')
        require(cards.sha(trial / 'review/output.json') == final['originalReviewSha256'] and
                cards.sha(repair / 'review/output.json') == final['targetedReviewSha256'], 'Targeted review binding changed')
        extra = [e for e in current['evidence'] if e['id'] not in {x['id'] for x in packet['evidence']}]
        if extra:
            supplement = cards.read(repair / 'supplement-binding.json')
            require(cards.sha(supplement['path']) == supplement['sha256'] and len(extra) == 1, 'Supplement changed')
            bind_proof(proofs, repair / 'supplement-binding.json')
            bind_proof(proofs, Path(supplement['path']), supplement['sha256'])
            sources.append(cards.read(supplement['path']))
        validate_evidence(packet, current, sources)
        replacements = {c['uid']: c for c in current['cards']}
        require(manual or all(t['uid'] not in replacements or replacements[t['uid']] == next(
            c for c in rows if c['uid'] == t['uid']) for t in original_review['transfers']), 'Changed transfer cannot be reused')
        rows = [replacements.get(c['uid'], c) for c in rows]
        review = {'cards': [next(r for r in (second if uid in failing else original_review)['cards'] if r['uid'] == uid)
                            for uid in uid_list], 'transfers': second['transfers'] if manual else original_review['transfers']}
    else:
        require(initial['status'] == 'REVIEWED_DRAFT', 'Failed review requires its exact targeted repair')
    require(batch.review_ok(review, uid_list), 'Not every content rule and transfer passed')
    overrides = cards.read(reviewed / 'draft-manifest.json').get('sourceOverrides', {})
    evidence = {e['id']: e for e in original_input['evidence']}
    if repair:
        evidence.update({e['id']: e for e in current['evidence']})
    for uid, url in overrides.items():
        row = next(c for c in rows if c['uid'] == uid)
        require(url in {evidence[e]['url'] for e in row['evidenceIds']}, 'Display source was not reviewed')
    with tempfile.TemporaryDirectory(prefix='repair-render-') as tmp:
        patch = Path(tmp) / 'patch.json'
        batch.write(patch, {'cards': rows})
        rendered = cards.render(trial / 'baseline.snapshot.json', patch, Path(tmp) / 'draft', overrides)
    require(rendered == cards.read(reviewed / 'candidate.cards.json') == cards.read(reviewed / 'cards.import.json'),
            'Import does not exactly render the reviewed semantics and frozen metadata')
    checks_path = reviewed / 'mechanical-checks.json' if (reviewed / 'mechanical-checks.json').exists() else trial / 'mechanical-checks.json'
    checks = cards.read(checks_path)
    bind_proof(proofs, checks_path)
    require(len(checks) == 2 and all(c['exitCode'] == 0 for c in checks), 'Linter/real parser checks did not pass')
    for name, expected in list(proofs.items()):
        bind_proof(proofs, Path(name), expected)
    return rendered, review, bindings, proofs


def require_current_rules(folder):
    rules = batch.teaching_rules()
    request = cards.read(folder / 'request.json')
    system = request['input'][0]
    require(system['role'] == 'system' and all(value in system['content'] for value in rules.values()),
            'Actual review request does not contain current complete teaching rules/version/hash')


def freeze_proofs(output, files):
    """Keep the actual reviewed inputs/responses/sources with the release, not only external paths."""
    archive = output / 'proofs'; archive.mkdir()
    entries = []
    for i, (name, expected) in enumerate(sorted(files.items())):
        source = Path(name)
        raw = subprocess.run([sys.executable, '-c',
            'from pathlib import Path; import sys; sys.stdout.buffer.write(Path(sys.argv[1]).read_bytes())',
            str(source)], check=True, capture_output=True, timeout=15).stdout
        require(hashlib.sha256(raw).hexdigest() == expected, 'Proof changed before archive: ' + name)
        target = archive / (str(i).zfill(3) + '-' + source.name)
        target.write_bytes(raw)
        entries.append({'originalPath': name, 'sha256': expected, 'archivePath': str(target.relative_to(output))})
    batch.write(output / 'proof-archive.json', {'files': entries, 'noModelCalls': True})


def project(prior, baseline, changed):
    previous = {c['stableUid']: c for c in prior['cards']}
    reviews = {c['stableUid']: c for c in prior['review']['cards']}
    by_uid = {c['stableUid']: c for c in changed}
    require(len(by_uid) == len(changed) and set(by_uid) <= set(previous), 'Unknown or repeated repair identity')
    require(1 <= len(previous) <= 500 and len(previous) == len(reviews) == len(baseline['cards'])
            and {c['stableUid'] for c in baseline['cards']} == set(previous), 'Incomplete prior review or baseline')
    result = []
    for old in baseline['cards']:
        uid = old['stableUid']
        require(canonical(old) == previous[uid] and old['revision'] == reviews[uid]['revision'] and
                reviews[uid]['verdict'] == 'PASS', 'Prior published body/revision is not identical')
        new = canonical(by_uid.get(uid, old))
        require(new['orderInDeck'] == old['orderInDeck'], 'Repair changed card order')
        result.append(new)
    return result


def backend_hashes(projected, output):
    pg = Path('/opt/homebrew/opt/postgresql@16/bin')
    def run(args, **kwargs):
        return subprocess.run([str(x) for x in args], capture_output=True, check=True, text=True, timeout=120, **kwargs)
    with tempfile.TemporaryDirectory(prefix='repair-hash-') as tmp:
        root = Path(tmp); socket = root / 'socket'; socket.mkdir(); data = root / 'data'
        run([pg / 'initdb', '-D', data, '--no-locale', '--encoding=UTF8', '--auth=trust'])
        run([pg / 'pg_ctl', '-D', data, '-l', root / 'pg.log', '-o', f"-k {socket} -h ''", '-w', 'start'])
        try:
            raw = json.dumps(projected, ensure_ascii=False); delimiter = '$repaircards$'
            require(delimiter not in raw, 'SQL literal delimiter appears in card text')
            normalized = run([pg / 'psql', '-h', socket, '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
                input='select value::jsonb from jsonb_array_elements(' + delimiter + raw + delimiter + '::jsonb);').stdout
            require([json.loads(s) for s in normalized.splitlines()] == projected, 'PostgreSQL normalization changed data')
            (output / 'postgres-normalized.jsonl').write_text(normalized)
        finally:
            run([pg / 'pg_ctl', '-D', data, '-w', 'stop'])
    preferred = Path.home() / '.dotnet/dotnet'
    dotnet = str(preferred) if preferred.is_file() else shutil.which('dotnet')
    require(bool(dotnet), 'The backend hash adapter requires dotnet')
    config = output / 'NuGet.Config'; config.write_text('<configuration><packageSources><clear /></packageSources></configuration>\n')
    build = subprocess.run([dotnet, 'build', str(batch.PROJECT / 'tools/content-pipeline/HashCards/HashCards.csproj'),
                            '--configfile', str(config), '--verbosity', 'minimal'],
                           capture_output=True, text=True, timeout=120)
    (output / 'hash-build.log').write_text(build.stdout + build.stderr)
    require(build.returncode == 0, 'Backend hash adapter build failed; see hash-build.log')
    return json.loads(run([dotnet, batch.PROJECT / 'tools/content-pipeline/HashCards/bin/Debug/net10.0/HashCards.dll',
                           output / 'postgres-normalized.jsonl']).stdout)


def prepare(request_path, output, manual=False):
    input_proofs = {}
    bind_proof(input_proofs, request_path)
    request = cards.read(request_path)
    required = {'priorRelease', 'packet', 'trial', 'reviewed', 'repair', 'mainSHA', 'releaseId', 'authorization'}
    require(required <= set(request) <= required | {'publisherCodeVerification'}, 'Unexpected release request fields')
    require(bool(re.fullmatch('[0-9a-f]{40}', request['mainSHA'])) and 0 < len(request['releaseId']) <= 160, 'Invalid main/release identity')
    path = lambda key: Path(request[key]).resolve()
    prior_dir = path('priorRelease'); trial = path('trial'); reviewed = path('reviewed')
    for p in [prior_dir / 'release-bundle.json', prior_dir / 'after-deck.json', prior_dir / 'publication-verification.json']:
        bind_proof(input_proofs, p)
    prior = cards.read(prior_dir / 'release-bundle.json')
    baseline_bytes = (prior_dir / 'after-deck.json').read_bytes()
    baseline = json.loads(baseline_bytes)
    receipt = cards.read(prior_dir / 'publication-verification.json')
    require(receipt['status'] == 'PUBLISHED_AND_VERIFIED' and cards.sha(prior_dir / 'after-deck.json') == receipt['sha256'], 'Prior publication is not verified')
    require(cards.sha(prior_dir / 'release-bundle.json') == receipt.get('bundleSha256') and
            bool(prior.get('releaseId')) and prior['releaseId'] == receipt.get('releaseId'), 'Prior published bundle or release identity changed')
    require(prior['deckId'] == 15 and prior['deckSlug'] == 'aws-saa-fundamentals' and
            baseline['version'] == receipt['buildId'], 'Wrong deck or prior live build')
    require(cards.sha(trial / 'baseline.snapshot.json') == receipt['sha256'], 'Draft is based on another live version')
    bind_proof(input_proofs, path('authorization'))
    authorization = cards.read(path('authorization'))
    require(bool(authorization.get('userRequest', '').strip()) and authorization.get('humanPerCardReview') is False, 'Actual batch authorization reference required')
    require(bool(request.get('publisherCodeVerification')), 'A cached publisher-code verification record is required')
    bind_proof(input_proofs, path('publisherCodeVerification'))
    publisher_code = verified_publisher_code(path('publisherCodeVerification'), request['mainSHA'])
    changed, review, bindings, prompts = verified_patch(path('packet'), trial, reviewed,
                                                       path('repair') if request['repair'] else None, manual)
    projected = project(prior, baseline, changed)
    proofs = dict(prompts)
    proof_paths = [path('authorization'), path('packet'), path('packet').with_name('source-bindings.json'),
                   prior_dir / 'release-bundle.json', prior_dir / 'publication-verification.json',
                   trial / 'result.json', reviewed / 'draft-manifest.json', reviewed / 'candidate.cards.json',
                   reviewed / 'cards.import.json']
    if manual:
        proof_paths.append(Path(cards.read(trial / 'manual-source.json')['sourcePath']))
    for folder in [trial / 'review', *([trial / 'author'] if not manual else []),
                   *([path('repair') / 'review'] if request['repair'] else [])]:
        proof_paths.extend(folder / name for name in ['request.json', 'response.json', 'result.json',
                                                      'input.json', 'output.json', 'schema.json'])
    proof_paths.extend(Path(s['path']) for s in bindings['files'])
    proof_paths.extend(batch.PROJECT / name for name in publisher_code)
    if request['repair']:
        proof_paths.append(reviewed / 'result.json')
        supplement = path('repair') / 'supplement-binding.json'
        if supplement.exists():
            proof_paths += [supplement, Path(cards.read(supplement)['path'])]
    for p in proof_paths:
        bind_proof(proofs, p)
    for name, expected in input_proofs.items():
        bind_proof(proofs, Path(name), expected)
    output = Path(output).resolve(); output.mkdir()
    clock = {'started': batch.now(), 'status': 'PREPARING', 'published': False}; batch.write(output / 'task-clock.json', clock)
    try:
        hashes = backend_hashes(projected, output)
        require(len(hashes) == len(projected) and {c['stableUid'] for c in hashes} == {c['stableUid'] for c in projected}, 'Incomplete backend hashes')
        old_meta = {c['stableUid']: c for c in prior['review']['cards']}; old_cards = {c['stableUid']: c for c in baseline['cards']}
        changed_uids = {c['stableUid'] for c in changed}; rows = []
        for row in hashes:
            uid = row['stableUid']; previous = old_meta[uid]
            if uid not in changed_uids:
                require(all(row[k] == previous[k] for k in ['cardContentHash', 'schema', 'orderInDeck']), 'Unchanged server hash differs')
            rows.append({**row, 'verdict': 'PASS', 'revision': old_cards[uid]['revision'] + int(row['cardContentHash'] != previous['cardContentHash']),
                         'blockers': [], 'unknowns': []})
        batch.write(output / 'review.bindings.json', review)
        batch.write(output / 'projected-cards.json', projected)
        batch.write(output / 'corpus-bindings.json', {'priorCorpusHash': prior['review']['corpusHash'], 'currentSourceBindings': bindings})
        batch.write(output / 'prompt-bindings.json', {'priorPromptHash': prior['review']['promptHash'], 'currentProofFiles': prompts})
        freeze_proofs(output, proofs)
        batch.write(output / 'release-evidence.json', {'changedUids': sorted(changed_uids), 'candidateSha256': proofs[str(reviewed / 'candidate.cards.json')],
            'priorBundleSha256': proofs[str(prior_dir / 'release-bundle.json')], 'priorEvidenceHash': prior['review']['evidenceHash'],
            'sourceBindings': bindings, 'authoringKind': 'manual-chat' if manual else 'model-author',
            'publisherCodeMainSHA': request['mainSHA'],
            'publisherCodeFiles': publisher_code,
            'publisherCodeVerificationSha256': proofs[str(path('publisherCodeVerification'))],
            'contentArtifactSha256': cards.sha(output / 'projected-cards.json'),
            'proofArchiveSha256': cards.sha(output / 'proof-archive.json'),
            'gitArchiveStatus': 'pending-independent-archive',
            'originalQuestionSupport': 'needs_recheck', 'learnerEffect': 'not_measured'})
        bundle = {'schema': 'aws-basics-release-bundle-v2', 'deckId': prior['deckId'], 'deckSlug': prior['deckSlug'],
            'releaseId': request['releaseId'], 'cards': projected,
            'expectedBaseline': {'liveBuildId': receipt['buildId'], 'cards': [
                {k: row[k] for k in ['stableUid', 'cardContentHash', 'schema', 'revision', 'orderInDeck']}
                for row in prior['review']['cards']]}, 'review': {
                'runId': request['releaseId'], 'batchAuthorizationRef': str(path('authorization')),
                'authorizationScope': prior['review']['authorizationScope'], 'model': 'Bound current and prior independent reviews',
                'mainSHA': request['mainSHA'], 'evidenceRef': str(output / 'release-evidence.json'),
                'evidenceHash': cards.sha(output / 'release-evidence.json'), 'evidenceVersion': 'repair-release-v2-code-content-separated',
                'reportRef': str(output / 'review.bindings.json'), 'reportHash': cards.sha(output / 'review.bindings.json'),
                'reportVersion': 'bound-content-review-v1', 'promptHash': cards.sha(output / 'prompt-bindings.json'),
                'promptVersion': 'bound-prior-current-v1', 'corpusHash': cards.sha(output / 'corpus-bindings.json'),
                'corpusVersion': 'bound-prior-current-v1', 'expiresAt': (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(), 'cards': rows}}
        batch.write(output / 'release-bundle.json', bundle)
        check = subprocess.run([shutil.which('node'), str(batch.PROJECT / 'tools/aws_cards/validate_release_json.mjs'),
                                str(output / 'release-bundle.json')], cwd=batch.PROJECT,
                               capture_output=True, text=True, timeout=40)
        batch.write(output / 'console-json-check.json', {'exitCode': check.returncode,
                    'stdout': check.stdout, 'stderr': check.stderr})
        require(check.returncode == 0, 'Real Console JSON parser rejected the release; see console-json-check.json')
        batch.write(output / 'predicted-server-hashes.json', hashes)
        (output / 'before-deck.json').write_bytes(baseline_bytes)
        batch.write(output / 'expected-baseline.json', {'cards': prior['cards'], 'metadata': prior['review']['cards'], 'liveBuild': receipt['buildId']})
        result = {'status': 'EXACT_BINDINGS_VERIFIED', 'releaseId': bundle['releaseId'],
                  'changed': len(changed_uids), 'unchanged': len(projected)-len(changed_uids),
                  'total': len(projected), 'bundleSha256': cards.sha(output / 'release-bundle.json'),
                  'expectedBaselineSha256': cards.sha(output / 'expected-baseline.json'),
                  'beforeDeckSha256': cards.sha(output / 'before-deck.json'), 'noProductionWrite': True}
        batch.write(output / 'preflight.json', result); clock['status'] = result['status']
        return result
    except Exception as error:
        clock.update(status='FAILED', error=str(error)); raise
    finally:
        clock['finished'] = batch.now(); batch.write(output / 'task-clock.json', clock)


def verify_baseline(folder, backup_path):
    expected = cards.read(folder / 'expected-baseline.json'); backup = cards.read(backup_path)
    bundle = cards.read(folder / 'release-bundle.json'); prepared = cards.read(folder / 'preflight.json')
    require(prepared['status'] == 'EXACT_BINDINGS_VERIFIED' and prepared['releaseId'] == bundle['releaseId'] and
            cards.sha(folder / 'release-bundle.json') == prepared['bundleSha256'] and
            cards.sha(folder / 'expected-baseline.json') == prepared['expectedBaselineSha256'] and
            cards.sha(folder / 'before-deck.json') == prepared['beforeDeckSha256'], 'Prepared release binding changed')
    require(backup['deckId'] == bundle['deckId'] == backup['deck']['id'] and
            backup['deck']['slug'] == bundle['deckSlug'], 'Wrong backup deck')
    require(backup['deck']['live_build_id'] == expected['liveBuild'], 'Live build changed; do not rebase this release')
    by_uid = {c['stableUid']: c for c in expected['metadata']}
    require(len(backup['cards']) == len(by_uid) and {c['stableUid'] for c in backup['cards']} == set(by_uid),
            'Editing inventory changed')
    for row in backup['cards']:
        require(row['stableUid'] in by_uid and all(row[k] == by_uid[row['stableUid']][k]
            for k in ['revision', 'schema', 'cardContentHash', 'orderInDeck']), 'Editing body/schema/revision/order changed')
    result = {'status': 'PASS_CURRENT_EDITING_BASELINE', 'cards': len(by_uid), 'backupRows': len(backup['backup']),
              'deckId': bundle['deckId'], 'releaseId': bundle['releaseId'], 'bundleSha256': prepared['bundleSha256'],
              'backupSha256': cards.sha(backup_path), 'editingSnapshot': backup['editingSnapshot'], 'noProductionWrite': True}
    batch.write(folder / 'current-editing-baseline.json', result)
    return result


def finalize(folder, artifact_dir):
    """Bind one actual Console/CDN receipt to the prepared folder; no API or model call."""
    folder, artifact_dir = Path(folder).resolve(), Path(artifact_dir).resolve()
    if artifact_dir.is_file():
        packet = cards.read(artifact_dir)
        require(packet.get('schema') == 'aws-basics-completed-artifacts-v1', 'Unsupported completed-artifact download')
        with tempfile.TemporaryDirectory(prefix='release-closeout-') as temporary:
            extracted = Path(temporary); bundle_raw = json.dumps(packet['session']['bundle']).encode()
            (extracted / 'release-bundle.json').write_bytes(bundle_raw)
            batch.write(extracted / 'console-journal.json', packet['session'])
            (extracted / 'after-deck.json').write_bytes(base64.b64decode(packet['deckBase64'], validate=True))
            batch.write(extracted / 'publication-verification.json', {**packet['proof'], 'status': 'PUBLISHED_AND_VERIFIED',
                'releaseId': packet['session']['bundle']['releaseId'], 'bundleSha256': hashlib.sha256(bundle_raw).hexdigest()})
            return finalize(folder, extracted)
    with tempfile.TemporaryDirectory(prefix='frozen-release-closeout-') as temporary:
        frozen = Path(temporary)
        for name in ['release-bundle.json', 'console-journal.json', 'publication-verification.json', 'after-deck.json']:
            (frozen / name).write_bytes((artifact_dir / name).read_bytes())
        return _finalize_frozen(folder, frozen)


def update_session_state(update):
    """All local session-state writers must use this advisory lock and atomic replace."""
    state_path = SESSION_STATE_PATH
    with state_path.with_suffix('.publication.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = state_path.read_bytes(); state = json.loads(original)
        require(isinstance(state, dict), 'Invalid session state')
        update(state)
        if state == json.loads(original):
            return
        encoded = (json.dumps(state, ensure_ascii=False, indent=2) + '\n').encode()
        with tempfile.NamedTemporaryFile(dir=state_path.parent, delete=False) as temp:
            staged = Path(temp.name)
            try:
                os.fchmod(temp.fileno(), state_path.stat().st_mode & 0o777)
                temp.write(encoded); temp.flush(); os.fsync(temp.fileno())
                require(state_path.read_bytes() == original, 'Session state changed during registration; retry the same finalize')
                os.replace(staged, state_path)
            finally:
                staged.unlink(missing_ok=True)


def register_publication(folder, receipt, previous_build):
    """Advance the local handoff only from this release's predecessor."""
    def update(state):
        require(isinstance(state, dict) and all(isinstance(state.get(k), dict) for k in
                ['lastPublication', 'dailyRepairWorkflow', 'cardPublicationWorkflow']), 'Incomplete session state; retain the existing record')
        current = state['lastPublication']
        require(current['status'] == 'PUBLISHED_AND_VERIFIED', 'Current publication is not verified')
        registered = state['cardPublicationWorkflow'].get('lastFinalizedPublication', {})
        require(isinstance(registered, dict), 'Invalid finalized-publication record')
        require(state.get('buildId', current['buildId']) == current['buildId'] and
                state['dailyRepairWorkflow'].get('latestContentBuild', current['buildId']) == current['buildId'] and
                registered.get('buildId', current['buildId']) == current['buildId'],
                'Session publication pointers disagree; inspect before registering')
        same_build = current['buildId'] == receipt['buildId']
        identity = ['releaseId', 'buildId', 'jobId', 'sha256', 'bundleSha256']
        require(not registered or all(registered.get(k) == current.get(k) for k in identity),
                'Finalized-publication record has conflicting bindings')
        if same_build:
            require(all(current.get(k) == receipt[k] for k in identity), 'Registered publication has conflicting bindings')
        else:
            require(current['buildId'] == previous_build, 'Current baseline is not this release\'s predecessor; do not replace a newer registration')
        publication = {**(current if same_build else {}), **receipt,
                       'totalCards': receipt['cards'], 'publicationDirectory': str(folder)}
        state.update(publication='PUBLISHED_AND_VERIFIED', buildId=receipt['buildId'], lastPublication=publication)
        state['dailyRepairWorkflow'].update(latestContentBuild=receipt['buildId'], latestPublicationDirectory=str(folder))
        state['cardPublicationWorkflow']['lastFinalizedPublication'] = {
            **{k: publication[k] for k in [*identity, 'verifiedAt', 'totalCards', 'publicationDirectory']},
            'receiptPath': str(folder / 'publication-verification.json')}
    update_session_state(update)


def _finalize_frozen(folder, artifact_dir):
    prepared = cards.read(folder / 'preflight.json'); bundle = cards.read(folder / 'release-bundle.json')
    require(prepared['status'] == 'EXACT_BINDINGS_VERIFIED' and
            cards.sha(folder / 'release-bundle.json') == prepared['bundleSha256'], 'Prepared bundle changed')
    require(cards.read(artifact_dir / 'release-bundle.json') == bundle, 'Console saved another release bundle')
    journal = cards.read(artifact_dir / 'console-journal.json'); proof = cards.read(artifact_dir / 'publication-verification.json')
    check = subprocess.run([shutil.which('node'), str(batch.PROJECT / 'tools/aws_cards/validate_release_json.mjs'),
        str(folder / 'release-bundle.json'), str(artifact_dir / 'console-journal.json')],
        cwd=batch.PROJECT, capture_output=True, text=True, timeout=40)
    require(check.returncode == 0, 'Console journal binding failed: ' + check.stderr)
    require(proof['status'] == 'PUBLISHED_AND_VERIFIED' and proof['releaseId'] == bundle['releaseId'] and
            proof['bundleSha256'] == cards.sha(artifact_dir / 'release-bundle.json') and
            all(proof[k] == journal['delivery'][k] for k in ['jobId', 'buildId', 'sha256', 'cards', 'verifiedAt']),
            'Console completion receipt differs from its frozen journal')
    raw = (artifact_dir / 'after-deck.json').read_bytes()
    require(hashlib.sha256(raw).hexdigest() == proof['sha256'], 'Saved CDN bytes changed')
    deck = json.loads(raw); expected = {c['stableUid']: c for c in bundle['cards']}
    revisions = {c['stableUid']: c['revision'] for c in bundle['review']['cards']}
    require(deck['slug'] == bundle['deckSlug'] and deck['version'] == proof['buildId'] and
            len(deck['cards']) == len(expected) and len({c['stableUid'] for c in deck['cards']}) == len(expected) and
            all(c['stableUid'] in expected and canonical(c) == expected[c['stableUid']] and
                c['revision'] == revisions[c['stableUid']] for c in deck['cards']), 'Saved card content differs from the reviewed bundle')
    receipt = {**proof, 'browserBundleSha256': proof['bundleSha256'], 'bundleSha256': prepared['bundleSha256']}
    def save_once(name, content):
        target = folder / name
        if target.exists():
            require(target.read_bytes() == content, 'Existing closeout differs; inspect instead of overwriting ' + name)
            return
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as temp:
            temp.write(content); temp.flush(); os.fsync(temp.fileno()); staged = Path(temp.name)
        try: os.link(staged, target)
        finally: staged.unlink()
    save_once('after-deck.json', raw)
    save_once('console-journal-final.json', (artifact_dir / 'console-journal.json').read_bytes())
    save_once('publication-verification.json', (json.dumps(receipt, ensure_ascii=False, indent=2) + '\n').encode())
    handoff = {'status': 'REGISTERED', 'path': str(SESSION_STATE_PATH)}
    try:
        register_publication(folder, receipt, journal['baseline']['deck']['live_build_id'])
    except (OSError, ValueError, KeyError, TypeError) as error:
        handoff.update(status='PENDING', message='发布已核验，接续记录待完成；排查登记错误后重跑同一 finalize，不重新发布。', error=str(error))
    return {'status': 'PUBLISHED_AND_VERIFIED', 'releaseId': bundle['releaseId'], 'buildId': proof['buildId'],
            'cards': proof['cards'], 'nextBaseline': str(folder), 'newNetworkRequests': 0, 'handoff': handoff}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare'); prep.add_argument('request', type=Path); prep.add_argument('output', type=Path)
    manual_prep = commands.add_parser('prepare-manual'); manual_prep.add_argument('request', type=Path); manual_prep.add_argument('output', type=Path)
    verify = commands.add_parser('verify-baseline'); verify.add_argument('folder', type=Path); verify.add_argument('backup', type=Path)
    finish = commands.add_parser('finalize'); finish.add_argument('folder', type=Path); finish.add_argument('artifacts', type=Path)
    args = parser.parse_args()
    result = (prepare(args.request, args.output, args.command == 'prepare-manual') if args.command in {'prepare', 'prepare-manual'}
              else finalize(args.folder, args.artifacts) if args.command == 'finalize'
              else verify_baseline(args.folder, args.backup))
    print(json.dumps(result, ensure_ascii=False))
    if result.get('handoff', {}).get('status') == 'PENDING':
        sys.exit(1)
