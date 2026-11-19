"""Synthetic local fixtures for release binding; no model or publication requests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import shutil
from unittest.mock import patch
from types import SimpleNamespace

import repair_batch as batch
import repair_cards as cards
import repair_release as release


def old_card(uid, order):
    return {'stableUid': uid, 'orderInDeck': order, 'revision': 2, 'difficulty': 2, 'topic': 'topic',
            'question': 'old question', 'explanation': 'old explanation', 'source': {'url': 'https://docs.aws.amazon.com/test'},
            'translations': {'zh-CN': {'v': 1, 'question': '旧问题', 'explanation': '旧答案'}},
            'teaching': {'answer': 'old answer', 'keyPoint': 'old reason', 'goal': 'old goal', 'mustAnswer': ['old'],
                         'zh-CN': {'answer': '旧答案', 'keyPoint': '旧原因', 'goal': '旧目标'}}, 'tags': {'domain': '1'}}


def record(folder, packet, output, role):
    folder.mkdir(exist_ok=True, parents=True)
    schema = batch.AUTHOR_SCHEMA if role == 'author' else batch.REVIEW_SCHEMA
    for name, value in [('input.json', packet), ('output.json', output), ('schema.json', schema),
                        ('request.json', {'input': [{'role': 'system', 'content': 'SYNTHETIC TEST'},
                           {'role': 'user', 'content': json.dumps(packet)}], 'text': {'format': {'schema': schema}}}),
                        ('response.json', {'status': 'completed', 'usage': {'input_tokens': 1}, 'output': [
                            {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(output)}]}]})]:
        batch.write(folder / name, value)
    batch.write(folder / 'result.json', {'exitCode': 0, 'completedTurns': 1, 'toolCalls': 0,
        'transport': 'existing-local-responses-provider', **{field: cards.sha(folder / name) for name, field in [
            ('input.json', 'inputSha256'), ('output.json', 'outputSha256'), ('request.json', 'requestSha256'), ('schema.json', 'schemaSha256')]}})


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.state_path = Path(temporary.name) / 'session-state.json'
        batch.write(self.state_path, {'publication': 'PUBLISHED_AND_VERIFIED', 'buildId': 'original-live',
            'lastPublication': {'status': 'PUBLISHED_AND_VERIFIED', 'buildId': 'original-live'},
            'dailyRepairWorkflow': {'latestContentBuild': 'original-live', 'nextBatchSelection': 'await_user'},
            'cardPublicationWorkflow': {'publicationStatusUI': {'status': 'DELIVERED_AND_VERIFIED'}},
            'unrelated': {'preserve': True}})
        patcher = patch.object(release, 'SESSION_STATE_PATH', self.state_path)
        patcher.start(); self.addCleanup(patcher.stop)

    def completed_fixture(self, root):
        program = '''
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=ROOT;
const {build}=createRequire(root+'/frontend/package.json')('esbuild');
const compiled=await build({stdin:{contents:'export {releaseFixture} from '+JSON.stringify(root+'/frontend/tests/support/contentReleaseFixtures.ts')+'; export {prepareReleaseAction} from '+JSON.stringify(root+'/frontend/src/lib/contentRelease.ts')+';',resolveDir:root+'/frontend',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {releaseFixture,prepareReleaseAction}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const {bundle,session,snapshot}=releaseFixture(2); const ok=data=>({success:true,data,error:null});
for(const kind of ['import','review','publish']) {
 if(kind==='review')session.verifiedSnapshot=snapshot;
 const data=kind==='import'?{editingSnapshot:snapshot.editingSnapshot}:kind==='review'?{receiptId:'synthetic-receipt',editingSnapshot:snapshot.editingSnapshot,publishSnapshot:snapshot.publishSnapshot}:{jobId:'synthetic-job',buildId:'synthetic-build',outcome:'queued',manifestVerified:false,snapshotSha256:snapshot.publishSnapshot};
 session.actions[kind]={...prepareReleaseAction(session,kind,kind),outcome:'confirmed',reconciled:true,result:ok(data)};
}
const deckRaw=JSON.stringify({slug:bundle.deckSlug,version:'synthetic-build',cards:bundle.cards.map(c=>({...c,revision:2}))});
const sha=createHash('sha256').update(deckRaw).digest('hex');
session.delivery={jobId:'synthetic-job',buildId:'synthetic-build',sha256:sha,cards:2,verifiedAt:new Date().toISOString()};
session.actions.publish.query={action:{},receipts:[],jobs:[{job_id:'synthetic-job',build_id:'synthetic-build',status:'SUCCESS',manifestState:'delivered',content_sha256:sha,error_message:null}],liveBuildId:'synthetic-build',manifestVerified:false};
console.log(JSON.stringify({bundle,session,deckRaw}));
'''.replace('ROOT', json.dumps(str(batch.PROJECT)))
        raw = release.subprocess.run(['node', '--input-type=module', '-e', program], capture_output=True, text=True, check=True, timeout=40)
        fixture = json.loads(raw.stdout); prepared = root / 'prepared'; artifacts = root / 'artifacts'
        prepared.mkdir(); artifacts.mkdir()
        for folder in [prepared, artifacts]: batch.write(folder / 'release-bundle.json', fixture['bundle'])
        batch.write(prepared / 'preflight.json', {'status': 'EXACT_BINDINGS_VERIFIED', 'bundleSha256': cards.sha(prepared / 'release-bundle.json')})
        batch.write(artifacts / 'console-journal.json', fixture['session'])
        (artifacts / 'after-deck.json').write_text(fixture['deckRaw'])
        batch.write(artifacts / 'publication-verification.json', {**fixture['session']['delivery'],
            'status': 'PUBLISHED_AND_VERIFIED', 'releaseId': fixture['bundle']['releaseId'],
            'bundleSha256': cards.sha(artifacts / 'release-bundle.json')})
        return prepared, artifacts

    def test_actual_console_parser_closeout_is_idempotent_and_rejects_changed_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            result = release.finalize(prepared, artifacts)
            self.assertEqual(result['newNetworkRequests'], 0)
            self.assertEqual(result['handoff']['status'], 'REGISTERED')
            state = cards.read(self.state_path); original = self.state_path.read_bytes()
            self.assertEqual(state['lastPublication']['releaseId'], result['releaseId'])
            self.assertEqual(state['buildId'], result['buildId'])
            self.assertEqual(state['dailyRepairWorkflow']['latestPublicationDirectory'], str(prepared.resolve()))
            self.assertEqual(state['cardPublicationWorkflow']['lastFinalizedPublication']['receiptPath'], str(prepared.resolve() / 'publication-verification.json'))
            self.assertTrue(state['unrelated']['preserve'])
            self.assertEqual(state['dailyRepairWorkflow']['nextBatchSelection'], 'await_user')
            self.assertEqual(state['cardPublicationWorkflow']['publicationStatusUI']['status'], 'DELIVERED_AND_VERIFIED')
            self.assertEqual(release.finalize(prepared, artifacts), result)
            self.assertEqual(self.state_path.read_bytes(), original)
            self.assertEqual((prepared / 'after-deck.json').read_bytes(), (artifacts / 'after-deck.json').read_bytes())
            (artifacts / 'after-deck.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'CDN bytes changed'): release.finalize(prepared, artifacts)
            self.assertEqual(self.state_path.read_bytes(), original)

    def test_registration_failure_preserves_verified_release_and_retry_only_registers(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp)); original = self.state_path.read_bytes()
            with patch.object(release.os, 'replace', side_effect=OSError('synthetic disk failure')):
                result = release.finalize(prepared, artifacts)
            self.assertEqual(result['status'], 'PUBLISHED_AND_VERIFIED')
            self.assertEqual(result['handoff']['status'], 'PENDING')
            self.assertIn('接续记录待完成', result['handoff']['message'])
            self.assertEqual(self.state_path.read_bytes(), original)
            saved = {p.name: p.read_bytes() for p in prepared.iterdir() if p.is_file()}
            with patch.object(batch, 'urlopen', side_effect=AssertionError('no network')):
                result = release.finalize(prepared, artifacts)
            self.assertEqual(result['handoff']['status'], 'REGISTERED')
            self.assertEqual(saved, {p.name: p.read_bytes() for p in prepared.iterdir() if p.is_file()})

    def test_registration_rejects_later_or_conflicting_baselines_and_busy_lock(self):
        receipt = {'status': 'PUBLISHED_AND_VERIFIED', 'releaseId': 'release', 'buildId': 'new-build',
                   'jobId': 'job', 'sha256': 'a'*64, 'bundleSha256': 'b'*64, 'verifiedAt': '2099-01-01T00:00:00Z', 'cards': 2}
        folder = self.state_path.parent / 'prepared'
        for current_build in ['newer-build', 'sibling-build']:
            state = cards.read(self.state_path)
            state['lastPublication']['buildId'] = state['buildId'] = state['dailyRepairWorkflow']['latestContentBuild'] = current_build
            batch.write(self.state_path, state); original = self.state_path.read_bytes()
            with self.assertRaisesRegex(ValueError, 'predecessor'):
                release.register_publication(folder, receipt, 'original-live')
            self.assertEqual(self.state_path.read_bytes(), original)
        state['lastPublication'] = receipt.copy()
        state['buildId'] = state['dailyRepairWorkflow']['latestContentBuild'] = receipt['buildId']
        state['lastPublication']['sha256'] = 'c'*64
        batch.write(self.state_path, state); original = self.state_path.read_bytes()
        with self.assertRaisesRegex(ValueError, 'conflicting bindings'):
            release.register_publication(folder, receipt, 'original-live')
        self.assertEqual(self.state_path.read_bytes(), original)
        with self.state_path.with_suffix('.publication.lock').open('a') as lock:
            release.fcntl.flock(lock, release.fcntl.LOCK_EX | release.fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): release.register_publication(folder, receipt, 'original-live')

    def test_registration_pending_does_not_clobber_missing_malformed_or_inconsistent_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            valid = self.state_path.read_bytes()
            for raw in [None, b'{', b'[]', b'{"lastPublication":{}}', valid.replace(b'"latestContentBuild": "original-live"', b'"latestContentBuild": "newer-build"')]:
                if raw is None: self.state_path.unlink()
                else: self.state_path.write_bytes(raw)
                result = release.finalize(prepared, artifacts)
                self.assertEqual(result['status'], 'PUBLISHED_AND_VERIFIED')
                self.assertEqual(result['handoff']['status'], 'PENDING')
                self.assertEqual(self.state_path.read_bytes() if self.state_path.exists() else None, raw)
            self.state_path.write_bytes(valid)
            self.assertEqual(release.finalize(prepared, artifacts)['handoff']['status'], 'REGISTERED')

    def test_conflicting_finalized_identity_stays_pending_without_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            release.finalize(prepared, artifacts); valid = cards.read(self.state_path)
            for key in ['releaseId', 'jobId', 'sha256', 'bundleSha256']:
                state = copy.deepcopy(valid)
                state['cardPublicationWorkflow']['lastFinalizedPublication'][key] = 'conflicting'
                batch.write(self.state_path, state); original = self.state_path.read_bytes()
                result = release.finalize(prepared, artifacts)
                self.assertEqual(result['handoff']['status'], 'PENDING')
                self.assertIn('conflicting bindings', result['handoff']['error'])
                self.assertEqual(self.state_path.read_bytes(), original)

    def test_workflow_maintenance_uses_the_same_lock_and_preserves_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp)); replace = release.os.replace
            def maintenance(state): state['authorization'] = {'automaticPublication': False, 'note': 'new maintenance value'}
            blocked = []
            def replacing(*args):
                try: release.update_session_state(maintenance)
                except BlockingIOError: blocked.append(True)
                return replace(*args)
            with patch.object(release.os, 'replace', side_effect=replacing):
                self.assertEqual(release.finalize(prepared, artifacts)['handoff']['status'], 'REGISTERED')
            self.assertEqual(blocked, [True])
            release.update_session_state(maintenance)
            release.finalize(prepared, artifacts)
            state = cards.read(self.state_path)
            self.assertEqual(state['authorization']['note'], 'new maintenance value')
            self.assertFalse(state['authorization']['automaticPublication'])
            self.assertEqual(state['lastPublication']['buildId'], 'synthetic-build')

    def test_external_edit_detected_before_replace_is_preserved_for_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            original = self.state_path.read_bytes()
            release.finalize(prepared, artifacts)
            self.state_path.write_bytes(original)
            def edit_before_compare(*args):
                state = cards.read(self.state_path); state['externalNote'] = 'retain this edit'
                batch.write(self.state_path, state)
            with patch.object(release.os, 'fsync', side_effect=edit_before_compare):
                result = release.finalize(prepared, artifacts)
            self.assertEqual(result['handoff']['status'], 'PENDING')
            self.assertEqual(cards.read(self.state_path)['externalNote'], 'retain this edit')
            self.assertEqual(release.finalize(prepared, artifacts)['handoff']['status'], 'REGISTERED')
            self.assertEqual(cards.read(self.state_path)['externalNote'], 'retain this edit')

    def test_cli_pending_returns_verified_json_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            program = ('import runpy, sys; '
                       'import repair_batch; from pathlib import Path; '
                       'sys.argv = sys.argv[1:]; '
                       'repair_batch.PROJECT = Path(sys.argv.pop(1)); '
                       'runpy.run_path(sys.argv[0], run_name="__main__")')
            # The isolated project has no session-state, while its parser uses the actual source tree.
            isolated = Path(tmp) / 'project'; (isolated / 'tools').mkdir(parents=True)
            (isolated / 'tools/aws_cards').symlink_to(batch.PROJECT / 'tools/aws_cards', target_is_directory=True)
            (isolated / 'frontend').symlink_to(batch.PROJECT / 'frontend', target_is_directory=True)
            raw = release.subprocess.run([release.sys.executable, '-c', program, str(batch.PROJECT / 'tools/aws_cards/repair_release.py'),
                str(isolated), 'finalize', str(prepared), str(artifacts)], cwd=batch.PROJECT / 'tools/aws_cards',
                capture_output=True, text=True, timeout=40)
            self.assertEqual(raw.returncode, 1, raw.stderr)
            self.assertTrue(raw.stdout, raw.stderr)
            result = json.loads(raw.stdout)
            self.assertEqual(result['status'], 'PUBLISHED_AND_VERIFIED')
            self.assertEqual(result['handoff']['status'], 'PENDING')

    def test_closeout_validates_and_copies_the_same_frozen_journal_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared, artifacts = self.completed_fixture(Path(tmp))
            expected = (artifacts / 'console-journal.json').read_bytes(); real_run = release.subprocess.run
            def concurrent_change(*args, **kwargs):
                (artifacts / 'console-journal.json').write_text('{}')
                return real_run(*args, **kwargs)
            with patch.object(release.subprocess, 'run', side_effect=concurrent_change):
                release.finalize(prepared, artifacts)
            self.assertEqual((prepared / 'console-journal-final.json').read_bytes(), expected)

    def code_proof(self, root, main_sha='a'*40):
        path = root / 'publisher-code.json'
        batch.write(path, {'schema': 'verified-publisher-code-v1', 'repository': 'ChuanQiao1128/DeveloperCards',
            'mainSHA': main_sha, 'files': {name: {'sha256': cards.sha(batch.PROJECT / name), 'sourceExact': True}
                for name in release.PUBLISHER_CODE_FILES},
            'checks': [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in release.REQUIRED_CODE_CHECKS],
            'source': 'SYNTHETIC local test fixture, not GitHub verification'})
        return path

    def test_code_cache_rejects_stale_source_wrong_main_or_incomplete_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = self.code_proof(root)
            self.assertEqual(set(release.verified_publisher_code(path, 'a'*40)), set(release.PUBLISHER_CODE_FILES))
            for mutation in ['sha', 'checks', 'file']:
                path = self.code_proof(root); record = cards.read(path)
                if mutation == 'sha': record['mainSHA'] = 'b'*40
                if mutation == 'checks': record['checks'][0]['status'] = 'in_progress'
                if mutation == 'file': record['files'][release.PUBLISHER_CODE_FILES[0]]['sha256'] = '0'*64
                batch.write(path, record)
                with self.assertRaises(ValueError): release.verified_publisher_code(path, 'a'*40)
    def test_release_archive_copies_exact_proof_bytes_and_rejects_changed_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); proof = root / 'response.json'; batch.write(proof, {'synthetic': 'actual fixture bytes'})
            out = root / 'out'; out.mkdir()
            expected = cards.sha(proof)
            release.freeze_proofs(out, {str(proof): expected})
            manifest = cards.read(out / 'proof-archive.json')
            archived = out / manifest['files'][0]['archivePath']
            self.assertEqual(archived.read_bytes(), proof.read_bytes())
            proof.write_text('{}')
            self.assertEqual(cards.sha(archived), expected)
            other = root / 'other'; other.mkdir()
            with self.assertRaisesRegex(ValueError, 'Proof changed before archive'):
                release.freeze_proofs(other, {str(proof): expected})

    def test_prepare_rejects_a_source_changed_after_review_validation_during_hash_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); packet, trial, reviewed = self.manual_fixture(root)
            prior = root / 'prior'; prior.mkdir()
            baseline = cards.read(trial / 'baseline.snapshot.json'); baseline['version'] = 'old-build'
            batch.write(prior / 'after-deck.json', baseline)
            (trial / 'baseline.snapshot.json').write_bytes((prior / 'after-deck.json').read_bytes())
            binding = cards.read(root / 'source-bindings.json')
            binding['baselineSha256'] = cards.sha(trial / 'baseline.snapshot.json')
            batch.write(root / 'source-bindings.json', binding)
            meta = [{'stableUid': c['stableUid'], 'revision': c['revision'], 'verdict': 'PASS',
                'cardContentHash': 'a' * 64, 'schema': 'legacy-v1', 'orderInDeck': c['orderInDeck']} for c in baseline['cards']]
            batch.write(prior / 'release-bundle.json', {'releaseId': 'old', 'deckId': 15,
                'deckSlug': 'aws-saa-fundamentals', 'cards': [release.canonical(c) for c in baseline['cards']],
                'review': {'cards': meta, 'corpusHash': 'a'*64, 'promptHash': 'a'*64, 'evidenceHash': 'a'*64}})
            batch.write(prior / 'publication-verification.json', {'status': 'PUBLISHED_AND_VERIFIED', 'releaseId': 'old',
                'buildId': 'old-build', 'sha256': cards.sha(prior / 'after-deck.json'),
                'bundleSha256': cards.sha(prior / 'release-bundle.json')})
            batch.write(root / 'authorization.json', {'userRequest': 'SYNTHETIC fixture only', 'humanPerCardReview': False})
            batch.write(root / 'request.json', {'priorRelease': str(prior), 'packet': str(packet), 'trial': str(trial),
                'reviewed': str(reviewed), 'repair': None, 'mainSHA': 'a'*40, 'releaseId': 'synthetic',
                'authorization': str(root / 'authorization.json'), 'publisherCodeVerification': str(self.code_proof(root))})
            def changed_during_build(projected, output):
                source = root / 'official.json'; source.write_text(source.read_text() + ' ')
                return [{k: row[k] for k in ['stableUid', 'cardContentHash', 'schema', 'orderInDeck']} for row in meta]
            with patch.object(release, 'backend_hashes', side_effect=changed_during_build):
                with self.assertRaisesRegex(ValueError, 'Proof changed before archive'):
                    release.prepare(root / 'request.json', root / 'out', manual=True)
            self.assertEqual(cards.read(root / 'out/task-clock.json')['status'], 'FAILED')
            self.assertFalse((root / 'out/preflight.json').exists())

    def fixture(self, root):
        trial = root / 'trial'; trial.mkdir()
        base = [old_card('a', 1), old_card('b', 2)]
        batch.write(trial / 'baseline.snapshot.json', {'cards': base})
        source = root / 'official.json'
        batch.write(source, {'url': 'https://docs.aws.amazon.com/test', 'text': 'complete official test quote'})
        packet = {'cards': [{**cards.view(c), 'evidenceIds': ['e1'], 'scopeChange': ''} for c in base],
                  'evidence': [{'id': 'e1', 'url': 'https://docs.aws.amazon.com/test', 'text': 'official test quote'}]}
        batch.write(root / 'input.json', packet)
        batch.write(root / 'source-bindings.json', {'packetSha256': cards.sha(root / 'input.json'),
            'baselineSha256': cards.sha(trial / 'baseline.snapshot.json'), 'files': [{'path': str(source), 'sha256': cards.sha(source)}]})
        candidate = copy.deepcopy(packet['cards'])
        for c in candidate:
            c.update(frontEn='New question', frontZh='新问题', answerEn='New answer', answerZh='新答案')
        patch = {'cards': candidate}; record(trial / 'author', packet, patch, 'author')
        review_input = batch.review_input(packet, patch)
        review = {'cards': [{'uid': c['uid'], 'pass': True, 'checkedRules': batch.REVIEW_RULES, 'reason': 'SYNTHETIC fixture'} for c in candidate],
                  'transfers': [{'uid': c['uid'], 'changedCondition': 'test change', 'expectedChoiceAndReason': 'test reason', 'supportedByCard': True} for c in candidate]}
        record(trial / 'review', review_input, review, 'review')
        batch.write(root / 'patch.json', patch)
        cards.render(trial / 'baseline.snapshot.json', root / 'patch.json', trial / 'draft')
        batch.write(trial / 'draft/cards.import.json', cards.read(trial / 'draft/candidate.cards.json'))
        batch.write(trial / 'mechanical-checks.json', [{'exitCode': 0}, {'exitCode': 0}])
        batch.write(trial / 'result.json', {'status': 'REVIEWED_DRAFT', 'candidateSha256': cards.sha(trial / 'draft/candidate.cards.json'),
            'reviewInputSha256': cards.sha(trial / 'review/input.json'), 'reviewOutputSha256': cards.sha(trial / 'review/output.json')})
        return root / 'input.json', trial, trial / 'draft'

    def manual_fixture(self, root):
        args = self.fixture(root)
        trial = args[1]
        patch = trial / 'author/output.json'
        (root / 'manual.json').write_bytes(patch.read_bytes())
        (trial / 'manual-patch.json').write_bytes(patch.read_bytes())
        batch.write(trial / 'manual-source.json', {'kind': 'manual-chat', 'automaticAuthorCalls': 0,
            'sourcePath': str(root / 'manual.json'), 'sourceSha256': cards.sha(root / 'manual.json')})
        request = cards.read(trial / 'review/request.json')
        request['input'][0]['content'] = '\n'.join(batch.teaching_rules().values())
        batch.write(trial / 'review/request.json', request)
        result = cards.read(trial / 'review/result.json')
        result['requestSha256'] = cards.sha(trial / 'review/request.json')
        batch.write(trial / 'review/result.json', result)
        shutil.rmtree(trial / 'author')
        return args

    def test_manual_source_uses_actual_review_without_an_author_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.manual_fixture(Path(tmp))
            rendered, review, _, proofs = release.verified_patch(*args, manual=True)
            self.assertEqual(len(rendered), 2)
            self.assertTrue(batch.review_ok(review, ['a', 'b']))
            self.assertTrue(any(name.endswith('manual-patch.json') for name in proofs))
            self.assertFalse((args[1] / 'author').exists())

    def test_manual_source_cannot_reuse_review_after_source_rules_or_scope_changes(self):
        for change in ['source', 'rules', 'scope']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); args = self.manual_fixture(root); trial = args[1]
                if change == 'source':
                    (root / 'manual.json').write_text('{}')
                else:
                    packet = cards.read(trial / 'review/input.json')
                    if change == 'scope':
                        packet['previousScope'][0]['frontEn'] = 'different original task'
                    review = cards.read(trial / 'review/output.json')
                    record(trial / 'review', packet, review, 'review')
                    if change == 'scope':
                        request = cards.read(trial / 'review/request.json')
                        request['input'][0]['content'] = '\n'.join(batch.teaching_rules().values())
                        batch.write(trial / 'review/request.json', request)
                        result = cards.read(trial / 'review/result.json')
                        result['requestSha256'] = cards.sha(trial / 'review/request.json')
                        batch.write(trial / 'review/result.json', result)
                with self.assertRaisesRegex(ValueError, {'source': 'Manual source changed',
                        'rules': 'current complete teaching', 'scope': 'scope or evidence'}[change]):
                    release.verified_patch(*args, manual=True)

    def test_single_manual_repair_uses_bound_passing_context_and_rejects_scope_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); packet, trial, _ = self.manual_fixture(root)
            original = cards.read(trial / 'review/input.json')
            old = cards.read(trial / 'review/output.json'); old['cards'][0]['pass'] = False
            def current_record(folder, actual, output):
                record(folder, actual, output, 'review')
                request = cards.read(folder / 'request.json')
                request['input'][0]['content'] = '\n'.join(batch.teaching_rules().values())
                batch.write(folder / 'request.json', request)
                result = cards.read(folder / 'result.json'); result['requestSha256'] = cards.sha(folder / 'request.json')
                batch.write(folder / 'result.json', result)
            current_record(trial / 'review', original, old)
            initial = cards.read(trial / 'result.json'); initial.update(status='NEEDS_REPAIR',
                reviewOutputSha256=cards.sha(trial / 'review/output.json'))
            batch.write(trial / 'result.json', initial)
            current = copy.deepcopy(original)
            current['cards'] = current['cards'][:1]
            current['cards'][0].update(answerEn='Repaired answer', scopeChange='Specific scope correction')
            current['previousScope'] = current['previousScope'][:1]
            current['contextCards'] = [original['cards'][1]]
            second = copy.deepcopy(old); second['cards'] = second['cards'][:1]; second['cards'][0]['pass'] = True
            repair = root / 'repair'; current_record(repair / 'review', current, second)
            with patch.object(batch.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='', stderr='')):
                batch.finish_repair(packet, trial, repair, root / 'fixed')
            rendered, _, _, _ = release.verified_patch(packet, trial, root / 'fixed', repair, manual=True)
            self.assertEqual(rendered[0]['teaching']['answer'], 'Repaired answer')
            for field in ['previousScope', 'scope', 'contextCards']:
                altered = copy.deepcopy(current); altered[field] = [] if field != 'scope' else 'Ignore original scope'
                current_record(repair / 'review', altered, second)
                final = cards.read(root / 'fixed/result.json')
                final['targetedReviewSha256'] = cards.sha(repair / 'review/output.json')
                batch.write(root / 'fixed/result.json', final)
                with self.assertRaisesRegex(ValueError, 'Targeted manual|Repair does not close'):
                    release.verified_patch(packet, trial, root / 'fixed', repair, manual=True)

    def test_real_render_is_bound_to_the_actual_model_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.fixture(Path(tmp))
            rendered, review, _, _ = release.verified_patch(*args)
            self.assertEqual(len(rendered), 2)
            self.assertTrue(batch.review_ok(review, ['a', 'b']))
            batch.write(args[1] / 'review/response.json', {'status': 'completed', 'usage': {'input_tokens': 1},
                'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '{"cards":[],"transfers":[]}'}]}]})
            with self.assertRaisesRegex(ValueError, 'recorded model response'):
                release.verified_patch(*args)

    def test_tampered_import_cannot_reuse_the_semantic_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = self.fixture(Path(tmp)); trial, draft = args[1:]
            candidate = cards.read(draft / 'candidate.cards.json'); candidate[0]['explanation'] = 'unreviewed change'
            for name in ['candidate.cards.json', 'cards.import.json']:
                batch.write(draft / name, candidate)
            result = cards.read(trial / 'result.json'); result['candidateSha256'] = cards.sha(draft / 'candidate.cards.json'); batch.write(trial / 'result.json', result)
            with self.assertRaisesRegex(ValueError, 'reviewed semantics'):
                release.verified_patch(*args)

    def test_changed_source_or_failing_review_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); args = self.fixture(root)
            (root / 'official.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'source changed'):
                release.verified_patch(*args)
        with tempfile.TemporaryDirectory() as tmp:
            args = self.fixture(Path(tmp)); trial = args[1]
            review = cards.read(trial / 'review/output.json'); review['cards'][0]['pass'] = False
            record(trial / 'review', cards.read(trial / 'review/input.json'), review, 'review')
            result = cards.read(trial / 'result.json'); result['reviewOutputSha256'] = cards.sha(trial / 'review/output.json'); batch.write(trial / 'result.json', result)
            with self.assertRaisesRegex(ValueError, 'Not every'):
                release.verified_patch(*args)

    def test_project_keeps_unselected_content_and_rejects_unknown_uids_order_and_stale_revision(self):
        base = [old_card('a', 1), old_card('b', 2)]
        prior = {'cards': [release.canonical(c) for c in base], 'review': {'cards': [
            {'stableUid': c['stableUid'], 'revision': 2, 'verdict': 'PASS'} for c in base]}}
        changed = copy.deepcopy(base[0]); changed['question'] = 'new'
        projected = release.project(prior, {'cards': base}, [changed])
        self.assertEqual(projected[1], prior['cards'][1])
        for mutation in [{'stableUid': 'unknown'}, {'orderInDeck': 99}]:
            with self.assertRaises(ValueError): release.project(prior, {'cards': base}, [{**changed, **mutation}])
        stale = copy.deepcopy(base); stale[0]['revision'] = 3
        with self.assertRaises(ValueError): release.project(prior, {'cards': stale}, [changed])
        with self.assertRaises(ValueError): release.project(prior, {'cards': [base[0], base[0]]}, [changed])

    def test_baseline_verification_rejects_changed_and_repeating_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            meta = [{'stableUid': u, 'revision': 2, 'schema': 'legacy-v1', 'cardContentHash': u*64, 'orderInDeck': n} for n, u in enumerate(['a', 'b'])]
            batch.write(root / 'expected-baseline.json', {'liveBuild': 'v1', 'metadata': meta})
            batch.write(root / 'before-deck.json', {'cards': []})
            batch.write(root / 'release-bundle.json', {'releaseId': 'r1', 'deckId': 15, 'deckSlug': 'aws-saa-fundamentals'})
            batch.write(root / 'preflight.json', {'status': 'EXACT_BINDINGS_VERIFIED', 'releaseId': 'r1',
                'bundleSha256': cards.sha(root / 'release-bundle.json'), 'expectedBaselineSha256': cards.sha(root / 'expected-baseline.json'),
                'beforeDeckSha256': cards.sha(root / 'before-deck.json')})
            backup = {'deckId': 15, 'deck': {'id': 15, 'slug': 'aws-saa-fundamentals', 'live_build_id': 'v1'},
                      'cards': meta, 'backup': [{}, {}], 'editingSnapshot': 'snapshot'}
            batch.write(root / 'backup.json', backup)
            self.assertEqual(release.verify_baseline(root, root / 'backup.json')['cards'], 2)
            backup['cards'] = [meta[0], meta[0]]; batch.write(root / 'backup.json', backup)
            with self.assertRaises(ValueError): release.verify_baseline(root, root / 'backup.json')
            backup['cards'] = meta; backup['deck']['live_build_id'] = 'v2'; batch.write(root / 'backup.json', backup)
            with self.assertRaises(ValueError): release.verify_baseline(root, root / 'backup.json')
            backup['deck']['live_build_id'] = 'v1'; backup['deck']['id'] = 99; batch.write(root / 'backup.json', backup)
            with self.assertRaisesRegex(ValueError, 'Wrong backup deck'): release.verify_baseline(root, root / 'backup.json')
            backup['deck']['id'] = 15; batch.write(root / 'backup.json', backup)
            batch.write(root / 'release-bundle.json', {'releaseId': 'different', 'deckId': 15, 'deckSlug': 'aws-saa-fundamentals'})
            with self.assertRaisesRegex(ValueError, 'Prepared release binding'): release.verify_baseline(root, root / 'backup.json')

    def test_prior_review_metadata_and_release_id_cannot_outlive_the_published_bundle_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); prior = root / 'prior'; prior.mkdir()
            original = {'releaseId': 'prior-release', 'review': {'promptHash': 'a'*64}}
            batch.write(prior / 'release-bundle.json', original); batch.write(prior / 'after-deck.json', {'cards': []})
            receipt = {'status': 'PUBLISHED_AND_VERIFIED', 'sha256': cards.sha(prior / 'after-deck.json'),
                       'bundleSha256': cards.sha(prior / 'release-bundle.json'), 'releaseId': 'prior-release'}
            batch.write(prior / 'publication-verification.json', receipt)
            request = {key: str(root / key) for key in ['packet', 'trial', 'reviewed', 'authorization']}
            request.update(priorRelease=str(prior), repair=None, mainSHA='a'*40, releaseId='new-release')
            batch.write(root / 'request.json', request)
            altered = copy.deepcopy(original); altered['review']['promptHash'] = '0'*64
            batch.write(prior / 'release-bundle.json', altered)
            with self.assertRaisesRegex(ValueError, 'Prior published bundle'): release.prepare(root / 'request.json', root / 'out')
            batch.write(prior / 'release-bundle.json', original)
            receipt['releaseId'] = 'another-release'; batch.write(prior / 'publication-verification.json', receipt)
            with self.assertRaisesRegex(ValueError, 'Prior published bundle'): release.prepare(root / 'request.json', root / 'out')


if __name__ == '__main__':
    unittest.main()
