import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import repair_batch as m


class RepairBatchTests(unittest.TestCase):
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
               'goalZh': '原目标', 'mustAnswer': ['A', 'B']}
        packet = {'cards': [old], 'evidence': [{'id': 'used', 'text': 'full'}, {'id': 'unused', 'text': 'other'}]}
        review = m.review_input(packet, {'cards': [{'uid': 'u', 'goalEn': 'Narrow', 'evidenceIds': ['used']}]})
        self.assertEqual(review['previousScope'][0]['mustAnswer'], ['A', 'B'])
        self.assertEqual(review['previousScope'][0]['goalEn'], 'Old goal')
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
