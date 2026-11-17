import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('repair_cards', Path(__file__).with_name('repair_cards.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RepairDraftTests(unittest.TestCase):
    def test_projection_preserves_identity_metadata_and_input_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            c = {'stableUid': 'u', 'orderInDeck': 70, 'revision': 2, 'difficulty': 2, 'topic': 'topic',
                 'question': 'old', 'explanation': 'old', 'source': {'url': 'https://docs.aws.amazon.com/'},
                 'translations': {'zh-CN': {'v': 1, 'question': '旧', 'explanation': '旧'}},
                 'teaching': {'prerequisites': ['prior']}, 'tags': {'domain': '1'}}
            p = {'uid': 'u', 'frontEn': 'Q', 'frontZh': '问', 'answerEn': 'A', 'answerZh': '答',
                 'keyPointEn': 'Because', 'keyPointZh': '原因', 'goalEn': 'Goal', 'goalZh': '目标',
                 'mustAnswer': ['A'], 'evidenceIds': ['e1'], 'scopeChange': ''}
            base, patch = root / 'base.json', root / 'patch.json'
            base.write_text(json.dumps({'cards': [c]})); patch.write_text(json.dumps({'cards': [p]}))
            original = base.read_bytes()
            result = m.render(base, patch, root / 'out')[0]
            self.assertEqual(base.read_bytes(), original)
            for key in ['stableUid', 'orderInDeck', 'tags', 'source']:
                self.assertEqual(result[key], c[key])
            self.assertEqual(result['teaching']['prerequisites'], ['prior'])
            self.assertEqual(result['translations']['zh-CN']['explanation'], '答：答\n考点：原因')
            self.assertEqual(result['teaching']['answer'], 'A')
            for change in [{'uid': 'unknown'}, {'revision': 900}, {'watchOutZh': 'only Chinese'}]:
                bad = copy.deepcopy(p); bad.update(change); patch.write_text(json.dumps({'cards': [bad]}))
                with self.assertRaises(ValueError):
                    m.render(base, patch, root / 'rejected')
                self.assertFalse((root / 'rejected').exists())
            patch.write_text(json.dumps({'cards': [p, p]}))
            with self.assertRaises(ValueError):
                m.render(base, patch, root / 'duplicate')


if __name__ == '__main__':
    unittest.main()
