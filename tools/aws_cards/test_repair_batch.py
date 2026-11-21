import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import repair_batch as m


class RepairBatchTests(unittest.TestCase):
    def test_current_complete_rules_are_loaded_and_invalid_blocks_stop(self):
        rules = m.teaching_rules()
        self.assertEqual('mobile-memory-card-v3-20261120', rules['version'])
        self.assertEqual(len(rules['sha256']), 64)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'AGENTS.md').write_text('old summary without current block')
            with patch.object(m, 'PROJECT', root), self.assertRaisesRegex(ValueError, 'exactly one'):
                m.teaching_rules()

    def test_canonical_json_keeps_mobile_paragraphs_and_detects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            candidate = [{'question': 'Scenario\n\nQuestion?', 'translations': {'zh-CN': {'question': '场景\n\n问题？'}}}]
            for name in ['candidate.cards.json', 'cards.json']:
                m.write(root / name, candidate)
            with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='', stderr='')):
                checks = m.mechanical_checks(root)
                self.assertEqual(checks[1]['status'], 'PASS_CANONICAL_JSON_ROUNDTRIP')
                self.assertEqual(m.draft.read(root / 'cards.import.json'), candidate)
                m.write(root / 'cards.json', [{'question': 'collapsed'}])
                with self.assertRaisesRegex(ValueError, 'Canonical candidate'):
                    m.mechanical_checks(root)

    def test_manual_run_calls_only_review_and_freezes_the_original_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = [{'stableUid': uid, 'orderInDeck': i * 10, 'difficulty': 2, 'topic': 'topic',
                'question': 'Old question', 'explanation': 'Old explanation',
                'source': {'url': 'https://docs.aws.amazon.com/example', 'quote': None},
                'translations': {'zh-CN': {'v': 1, 'question': '旧问题', 'explanation': '旧答案'}},
                'teaching': {'answer': 'old answer', 'keyPoint': 'old mechanism', 'goal': 'old goal',
                    'mustAnswer': ['old answer'], 'zh-CN': {'answer': '旧答案', 'keyPoint': '旧机制', 'goal': '旧目标'}}}
                for i, uid in enumerate(['manual-a', 'manual-b'], 1)]
            m.write(root / 'baseline.json', {'cards': base})
            packet = {'cards': [{**m.draft.view(c), 'evidenceIds': ['e1'], 'scopeChange': ''} for c in base],
                'evidence': [{'id': 'e1', 'url': 'https://docs.aws.amazon.com/example', 'text': 'official excerpt'}],
                'contextCards': [], 'scope': 'repair'}
            m.write(root / 'input.json', packet)
            m.write(root / 'source-bindings.json', {'packetSha256': m.draft.sha(root / 'input.json'),
                'baselineSha256': m.draft.sha(root / 'baseline.json'), 'files': []})
            patch_data = {'cards': json.loads(json.dumps(packet['cards']))}
            patch_data['cards'][0]['frontEn'] = 'Scenario\n\nQuestion?'
            m.write(root / 'manual.json', patch_data)
            def review_only(folder, actual, role):
                self.assertEqual(role, 'review')
                self.assertEqual(actual['cards'], patch_data['cards'])
                self.assertEqual(actual['previousScope'][0]['frontEn'], 'Old question')
                folder.mkdir()
                review = {'cards': [{'uid': c['uid'], 'pass': True, 'checkedRules': m.REVIEW_RULES,
                            'reason': 'SYNTHETIC test'} for c in actual['cards']],
                    'transfers': [{'uid': c['uid'], 'changedCondition': 'test change',
                        'expectedChoiceAndReason': 'test mechanism', 'supportedByCard': True} for c in actual['cards']]}
                m.write(folder / 'input.json', actual); m.write(folder / 'output.json', review)
                return review, {'usage': {'input_tokens': 10, 'output_tokens': 5}}
            with patch.object(m, 'inference', side_effect=review_only) as calls, \
                 patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='', stderr='')):
                result = m.run(root / 'input.json', root / 'baseline.json', root / 'out', manual_patch=root / 'manual.json')
            calls.assert_called_once()
            self.assertEqual(result['status'], 'REVIEWED_DRAFT')
            self.assertEqual(result['author']['automaticAuthorCalls'], 0)
            self.assertFalse((root / 'out/author').exists())
            self.assertEqual((root / 'out/manual-patch.json').read_bytes(), (root / 'manual.json').read_bytes())
            self.assertEqual(m.draft.read(root / 'out/draft/cards.import.json')[0]['question'], 'Scenario\n\nQuestion?')

    def _finish_repair(self, mutate=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); trial = root / 'trial'; repair = root / 'repair'
            for folder in [trial / 'review', trial / 'draft', repair / 'review']:
                folder.mkdir(parents=True)
            cards = [{'uid': u, **{k: k for k in m.draft.TEXT},
                      'mustAnswer': ['answer'], 'evidenceIds': ['e1'], 'scopeChange': ''}
                     for u in ['a', 'b', 'c']]
            packet = {'cards': cards, 'evidence': [
                {'id': 'e1', 'url': 'https://docs.aws.amazon.com/example', 'text': 'official quote'}]}
            baseline = [{'stableUid': c['uid'], 'orderInDeck': i, 'difficulty': 2,
                         'topic': 'topic', 'question': 'old', 'explanation': 'old',
                         'source': {'url': packet['evidence'][0]['url']}, 'teaching': {},
                         'translations': {'zh-CN': {'question': '旧', 'explanation': '旧'}}}
                        for i, c in enumerate(cards, 1)]
            m.write(root / 'input.json', packet)
            m.write(trial / 'baseline.snapshot.json', baseline)
            m.write(root / 'source-bindings.json', {
                'packetSha256': m.draft.sha(root / 'input.json'),
                'baselineSha256': m.draft.sha(trial / 'baseline.snapshot.json'), 'files': []})
            old_review = {'cards': [{'uid': c['uid'], 'pass': c['uid'] == 'a',
                'checkedRules': m.REVIEW_RULES, 'reason': 'checked'} for c in cards],
                'transfers': [{'uid': u, 'changedCondition': 'change',
                    'expectedChoiceAndReason': 'because', 'supportedByCard': True} for u in ['a', 'b']]}
            m.write(trial / 'draft/candidate.cards.json', cards)
            m.write(trial / 'review/input.json', packet)
            m.write(trial / 'review/output.json', old_review)
            m.write(trial / 'result.json', {'status': 'NEEDS_REPAIR',
                'candidateSha256': m.draft.sha(trial / 'draft/candidate.cards.json'),
                'reviewInputSha256': m.draft.sha(trial / 'review/input.json'),
                'reviewOutputSha256': m.draft.sha(trial / 'review/output.json')})
            current = json.loads(json.dumps(packet)); current['cards'] = current['cards'][1:]
            if mutate:
                mutate(current, repair)
            m.write(repair / 'review/input.json', current)
            review = json.loads(json.dumps(old_review)); review['cards'] = review['cards'][1:]
            for row in review['cards']:
                row['pass'] = True
            review['transfers'][0]['uid'] = 'c'
            m.write(repair / 'review/output.json', review)
            m.write(repair / 'review/result.json', {
                'inputSha256': m.draft.sha(repair / 'review/input.json'),
                'outputSha256': m.draft.sha(repair / 'review/output.json')})
            with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout='', stderr='')):
                return m.finish_repair(root / 'input.json', trial, repair, root / 'out')

    def test_finish_repair_reuses_exact_candidate_without_supplement(self):
        self.assertEqual(self._finish_repair()['status'], 'REVIEWED_DRAFT')

    def test_finish_repair_rejects_changed_candidate_with_old_transfer(self):
        def change(current, repair):
            current['cards'][0]['keyPointEn'] = 'changed mechanism'
        with self.assertRaisesRegex(ValueError, 'transfer evidence cannot be reused'):
            self._finish_repair(change)

    def test_finish_repair_rejects_missing_evidence_citation(self):
        def change(current, repair):
            current['cards'][1]['evidenceIds'].append('missing')
        with self.assertRaisesRegex(ValueError, 'unknown or ambiguous evidence citations'):
            self._finish_repair(change)

    def test_finish_repair_rejects_duplicate_evidence_and_cards(self):
        for duplicate in ['evidence', 'cards']:
            with self.subTest(duplicate=duplicate):
                def change(current, repair):
                    current[duplicate].append(current[duplicate][0])
                with self.assertRaisesRegex(ValueError, 'ambiguous evidence|exactly the failed cards'):
                    self._finish_repair(change)

    def test_finish_repair_checks_supplement_binding_and_reused_evidence(self):
        for tamper in [None, 'source', 'excerpt', 'reused']:
            with self.subTest(tamper=tamper):
                def change(current, repair):
                    current['evidence'].append({'id': 'e2',
                        'url': 'https://docs.aws.amazon.com/supplement', 'text': 'supplement quote'})
                    current['cards'][1]['evidenceIds'].append('e2')
                    source = repair / 'source.json'
                    m.write(source, {'url': current['evidence'][-1]['url'], 'text': 'supplement quote'})
                    m.write(repair / 'supplement-binding.json', {'path': str(source), 'sha256': m.draft.sha(source)})
                    if tamper == 'source':
                        source.write_text(source.read_text() + ' ')
                    elif tamper == 'excerpt':
                        current['evidence'][-1]['text'] = 'not in source'
                    elif tamper == 'reused':
                        current['evidence'][0]['text'] = 'changed original quote'
                if tamper:
                    with self.assertRaisesRegex(ValueError, {
                            'source': 'Supplemental official source changed',
                            'excerpt': 'Supplemental excerpt not bound',
                            'reused': 'Reused evidence ID changed'}[tamper]):
                        self._finish_repair(change)
                else:
                    self.assertEqual(self._finish_repair(change)['status'], 'REVIEWED_DRAFT')

    def test_rule_label_normalization_does_not_turn_failure_into_pass(self):
        review = {'cards': [{'uid': 'u', 'pass': False, 'checkedRules': ['FACT：通过', 'B1：不通过'], 'reason': 'failed'}], 'transfers': []}
        normalized = m.normalize_review_labels(review)
        self.assertEqual(normalized['cards'][0]['checkedRules'], ['FACT', 'B1：不通过'])
        self.assertIs(normalized['cards'][0]['pass'], False)
        self.assertEqual(review['cards'][0]['checkedRules'][0], 'FACT：通过')
        with self.assertRaises(ValueError):
            m.validate_schema(normalized, m.REVIEW_SCHEMA)

    def test_reused_evidence_identity_cannot_hide_a_changed_quote(self):
        old = {'evidence': [{'id': 'e1', 'url': 'official', 'text': 'exact quote'}]}
        m.validate_evidence_reuse(old, old)
        with self.assertRaises(ValueError):
            m.validate_evidence_reuse(old, {'evidence': [{'id': 'e1', 'url': 'official', 'text': 'changed'}]})

    def test_existing_local_transport_keeps_auth_out_of_artifacts_and_meters_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp); (home / '.codex').mkdir()
            (home / '.codex/config.toml').write_text('''model_provider = "local"
[model_providers.local]
base_url = "http://127.0.0.1:1234/v1"
wire_api = "responses"
[model_providers.local.auth]
command = ["existing-auth-hook"]
''')
            response = {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': '{"cards":[]}'}]}],
                'usage': {'input_tokens': 10, 'output_tokens': 7,
                          'input_tokens_details': {'cached_tokens': 4},
                          'output_tokens_details': {'reasoning_tokens': 3}}}
            with patch.object(m.Path, 'home', return_value=home), \
                 patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout='dummy-secret\n')) as hook, \
                 patch.object(m, 'urlopen') as request:
                request.return_value.__enter__.return_value.read.return_value = json.dumps(response).encode()
                data, result = m.inference(home / 'job', {'cards': []}, 'author')
                hook.assert_called_once()
                request.assert_called_once()
                self.assertEqual(result['usage'], {'input_tokens': 10, 'output_tokens': 7,
                    'cached_input_tokens': 4, 'reasoning_output_tokens': 3})
                self.assertNotIn('dummy-secret', ''.join(p.read_text() for p in (home / 'job').iterdir()))
                self.assertEqual(data, {'cards': []})
                actual = m.draft.read(home / 'job/request.json')['input'][0]['content']
                self.assertTrue(all(value in actual for value in m.teaching_rules().values()))
            config = home / '.codex/config.toml'
            config.write_text(config.read_text().replace('127.0.0.1', 'example.com'))
            with patch.object(m.Path, 'home', return_value=home), patch.object(m.subprocess, 'run') as hook:
                with self.assertRaises(ValueError):
                    m.inference(home / 'rejected', {'cards': []}, 'author')
                hook.assert_not_called()

    def test_review_rejects_missing_rules_failed_cards_and_unsupported_transfer(self):
        review = {'cards': [{'uid': u, 'pass': True, 'checkedRules': m.REVIEW_RULES, 'reason': 'checked'}
                            for u in ['a', 'b']],
                  'transfers': [{'uid': u, 'changedCondition': 'change', 'expectedChoiceAndReason': 'because',
                                 'supportedByCard': True} for u in ['a', 'b']]}
        self.assertTrue(m.review_ok(review, ['a', 'b']))
        review['cards'][0]['pass'] = False
        self.assertFalse(m.review_ok(review, ['a', 'b']))
        review['cards'][0]['pass'] = 'false'
        self.assertFalse(m.review_ok(review, ['a', 'b']))
        with self.assertRaises(ValueError):
            m.validate_schema(review, m.REVIEW_SCHEMA)
        review['cards'][0]['pass'] = True
        review['cards'][0]['checkedRules'] = ['FACT']
        self.assertFalse(m.review_ok(review, ['a', 'b']))
        review['cards'][0]['checkedRules'] = m.REVIEW_RULES
        review['transfers'][0]['supportedByCard'] = False
        self.assertFalse(m.review_ok(review, ['a', 'b']))

    def test_redirects_and_credential_hook_failure_are_contained(self):
        with self.assertRaises(ValueError):
            m.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com/')

    def test_scope_and_baseline_remain_frozen(self):
        old = {'uid': 'u', 'frontEn': 'Old task', 'frontZh': '原问题', 'goalEn': 'Old goal',
               'goalZh': '原目标', 'mustAnswer': ['A', 'B'],
               'answerEn': 'Old answer', 'answerZh': '原答案',
               'keyPointEn': 'Old comparison removed by candidate', 'keyPointZh': '原有比较',
               'watchOutEn': 'Old boundary', 'watchOutZh': '原边界'}
        packet = {'cards': [old], 'evidence': [{'id': 'used', 'text': 'full'}, {'id': 'unused', 'text': 'other'}]}
        review = m.review_input(packet, {'cards': [{'uid': 'u', 'goalEn': 'Narrow', 'evidenceIds': ['used']}]})
        self.assertEqual(review['previousScope'][0]['mustAnswer'], ['A', 'B'])
        self.assertEqual(review['previousScope'][0]['goalEn'], 'Old goal')
        self.assertEqual(review['previousScope'][0]['keyPointZh'], '原有比较')
        self.assertEqual(review['previousScope'][0]['watchOutEn'], 'Old boundary')
        self.assertEqual(review['evidence'], [{'id': 'used', 'text': 'full'}])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); base = root / 'base.json'; base.write_text('{"cards":[]}')
            digest = m.draft.sha(base)
            snapshot = m.frozen_baseline(base, root, digest)
            base.write_text('{"changed":true}')
            self.assertEqual(json.loads(snapshot.read_text()), {'cards': []})
            with self.assertRaises(ValueError):
                m.frozen_baseline(base, root, digest)


if __name__ == '__main__':
    unittest.main()
