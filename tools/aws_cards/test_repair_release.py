"""Synthetic local fixtures for release binding; no model or publication requests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

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
