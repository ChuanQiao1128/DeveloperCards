#!/usr/bin/env python3
"""Prepare a Console release from frozen card reviews; never publish or run a model."""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

import repair_batch as batch
import repair_cards as cards


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(card):
    result = copy.deepcopy(card)
    result.pop('revision', None)
    result.setdefault('mcq', None)
    result.setdefault('frontHelp', None)
    return result


def inference(folder, role):
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
    return cards.read(folder / 'input.json'), output


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


def verified_patch(packet_path, trial, reviewed, repair=None):
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
        sources.append(json.loads(raw))
    author_input, candidate = inference(trial / 'author', 'author')
    require(author_input == packet, 'Author packet changed')
    original_input, original_review = inference(trial / 'review', 'review')
    require(original_input['cards'] == candidate['cards'], 'Initial review did not see the candidate')
    validate_evidence(packet, original_input, sources)
    initial = cards.read(trial / 'result.json')
    require(cards.sha(trial / 'draft/candidate.cards.json') == initial['candidateSha256'] and
            cards.sha(trial / 'review/input.json') == initial['reviewInputSha256'] and
            cards.sha(trial / 'review/output.json') == initial['reviewOutputSha256'], 'Initial closeout changed')
    final_result_path = reviewed / 'result.json' if (reviewed / 'result.json').exists() else trial / 'result.json'
    final = cards.read(final_result_path)
    require(final['status'] == 'REVIEWED_DRAFT' and cards.sha(reviewed / 'candidate.cards.json') == final['candidateSha256'], 'Draft is not bound and approved')
    rows = candidate['cards']
    uid_list = [c['uid'] for c in rows]
    require(1 <= len(uid_list) <= 10 and len(set(uid_list)) == len(uid_list), 'Expected 1-10 unique reviewed cards')
    require(uid_list == [c['uid'] for c in packet['cards']], 'Card identity/order changed')
    review = original_review
    proof_files = [trial / 'author/request.json', trial / 'review/request.json']
    if repair:
        require(initial['status'] == 'NEEDS_REPAIR' and final.get('targetedRepairRounds') == 1, 'Unexpected repair round')
        current, second = inference(repair / 'review', 'review')
        failing = {r['uid'] for r in original_review['cards'] if r['pass'] is not True}
        require(len(current['cards']) == len(failing) and {c['uid'] for c in current['cards']} == failing and
                batch.review_ok(second, failing), 'Repair does not close exactly the failed cards')
        require(cards.sha(trial / 'review/output.json') == final['originalReviewSha256'] and
                cards.sha(repair / 'review/output.json') == final['targetedReviewSha256'], 'Targeted review binding changed')
        extra = [e for e in current['evidence'] if e['id'] not in {x['id'] for x in packet['evidence']}]
        if extra:
            supplement = cards.read(repair / 'supplement-binding.json')
            require(cards.sha(supplement['path']) == supplement['sha256'] and len(extra) == 1, 'Supplement changed')
            sources.append(cards.read(supplement['path']))
        validate_evidence(packet, current, sources)
        replacements = {c['uid']: c for c in current['cards']}
        require(all(t['uid'] not in replacements or replacements[t['uid']] == next(
            c for c in rows if c['uid'] == t['uid']) for t in original_review['transfers']), 'Changed transfer cannot be reused')
        rows = [replacements.get(c['uid'], c) for c in rows]
        review = {'cards': [next(r for r in (second if uid in failing else original_review)['cards'] if r['uid'] == uid)
                            for uid in uid_list], 'transfers': original_review['transfers']}
        proof_files.append(repair / 'review/request.json')
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
    checks = cards.read(reviewed / 'mechanical-checks.json' if (reviewed / 'mechanical-checks.json').exists()
                        else trial / 'mechanical-checks.json')
    require(len(checks) == 2 and all(c['exitCode'] == 0 for c in checks), 'Linter/real parser checks did not pass')
    return rendered, review, bindings, {str(p): cards.sha(p) for p in proof_files}


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


def prepare(request_path, output):
    request = cards.read(request_path)
    require(set(request) == {'priorRelease', 'packet', 'trial', 'reviewed', 'repair', 'mainSHA', 'releaseId', 'authorization'}, 'Unexpected release request fields')
    require(bool(re.fullmatch('[0-9a-f]{40}', request['mainSHA'])) and 0 < len(request['releaseId']) <= 160, 'Invalid main/release identity')
    path = lambda key: Path(request[key]).resolve()
    prior_dir = path('priorRelease'); trial = path('trial'); reviewed = path('reviewed')
    prior = cards.read(prior_dir / 'release-bundle.json'); baseline = cards.read(prior_dir / 'after-deck.json')
    receipt = cards.read(prior_dir / 'publication-verification.json')
    require(receipt['status'] == 'PUBLISHED_AND_VERIFIED' and cards.sha(prior_dir / 'after-deck.json') == receipt['sha256'], 'Prior publication is not verified')
    require(cards.sha(prior_dir / 'release-bundle.json') == receipt.get('bundleSha256') and
            bool(prior.get('releaseId')) and prior['releaseId'] == receipt.get('releaseId'), 'Prior published bundle or release identity changed')
    require(prior['deckId'] == 15 and prior['deckSlug'] == 'aws-saa-fundamentals' and
            baseline['version'] == receipt['buildId'], 'Wrong deck or prior live build')
    require(cards.sha(trial / 'baseline.snapshot.json') == receipt['sha256'], 'Draft is based on another live version')
    authorization = cards.read(path('authorization'))
    require(bool(authorization.get('userRequest', '').strip()) and authorization.get('humanPerCardReview') is False, 'Actual batch authorization reference required')
    changed, review, bindings, prompts = verified_patch(path('packet'), trial, reviewed,
                                                       path('repair') if request['repair'] else None)
    projected = project(prior, baseline, changed)
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
        batch.write(output / 'corpus-bindings.json', {'priorCorpusHash': prior['review']['corpusHash'], 'currentSourceBindings': bindings})
        batch.write(output / 'prompt-bindings.json', {'priorPromptHash': prior['review']['promptHash'], 'currentRequests': prompts})
        batch.write(output / 'release-evidence.json', {'changedUids': sorted(changed_uids), 'candidateSha256': cards.sha(reviewed / 'candidate.cards.json'),
            'priorBundleSha256': cards.sha(prior_dir / 'release-bundle.json'), 'priorEvidenceHash': prior['review']['evidenceHash'],
            'sourceBindings': bindings, 'originalQuestionSupport': 'needs_recheck', 'learnerEffect': 'not_measured'})
        bundle = {'schema': 'aws-basics-release-bundle-v1', 'deckId': prior['deckId'], 'deckSlug': prior['deckSlug'],
            'releaseId': request['releaseId'], 'cards': projected, 'review': {
                'runId': request['releaseId'], 'batchAuthorizationRef': str(path('authorization')),
                'authorizationScope': prior['review']['authorizationScope'], 'model': 'Bound current and prior independent reviews',
                'mainSHA': request['mainSHA'], 'evidenceRef': str(output / 'release-evidence.json'),
                'evidenceHash': cards.sha(output / 'release-evidence.json'), 'evidenceVersion': 'repair-release-v1',
                'reportRef': str(output / 'review.bindings.json'), 'reportHash': cards.sha(output / 'review.bindings.json'),
                'reportVersion': 'bound-content-review-v1', 'promptHash': cards.sha(output / 'prompt-bindings.json'),
                'promptVersion': 'bound-prior-current-v1', 'corpusHash': cards.sha(output / 'corpus-bindings.json'),
                'corpusVersion': 'bound-prior-current-v1', 'expiresAt': (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(), 'cards': rows}}
        batch.write(output / 'release-bundle.json', bundle)
        batch.write(output / 'projected-cards.json', projected)
        batch.write(output / 'predicted-server-hashes.json', hashes)
        (output / 'before-deck.json').write_bytes((prior_dir / 'after-deck.json').read_bytes())
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare'); prep.add_argument('request', type=Path); prep.add_argument('output', type=Path)
    verify = commands.add_parser('verify-baseline'); verify.add_argument('folder', type=Path); verify.add_argument('backup', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.request, args.output) if args.command == 'prepare'
                     else verify_baseline(args.folder, args.backup), ensure_ascii=False))
