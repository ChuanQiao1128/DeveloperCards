import copy
import json
import tempfile
import unittest
from pathlib import Path

import domain_index as d


def fixture():
    questions = [{'qid': q, 'questionRef': f'source:{q}', 'options': [{'ordinal': 1}]} for q in [1, 2, 31]]
    needs = [{'qid': q, 'conditions': [{'id': 'c1'}], 'mustJudge': [{'id': 'j1', 'kind': 'explicit', 'conditionIds': ['c1']}], 'toVerify': [], 'anomalies': []} for q in [1, 2, 31]]
    goals = []
    for oid, qids in [('g1', [1, 2]), ('g2', [31])]:
        goals.append({'objectiveId': oid, 'qids': qids, 'needRefs': [f'Q{q}:j1' for q in qids], 'conditions': [{'qid': q, 'conditionRefs': [f'Q{q}:c1'], 'role': 'original_case'} for q in qids], 'variants': [{'label': 'original scope'}], 'compositionRefs': ['g1'] if oid == 'g2' else [], 'verificationTopicIds': []})
    classification = [{'题号': str(q), '归类状态': '暂归／待核实' if q == 31 else '已逐题归类', '主领域': domain, '主任务': task, '跨领域任务': cross, 'hasReviewNotes': q == 31} for q, domain, task, cross in [(1, '1', '1.1', ''), (2, '2', '2.2', '4.2'), (31, '1', '1.3', '')]]
    return {'questions': questions, 'needs': needs, 'blueprint': {'allSourceQids': [1, 2, 31], 'objectives': goals, 'sourceCasesByQid': {str(q): {'needsReviewStatus': 'PASS_REQUIREMENTS_ONLY'} for q in [1, 2, 31]}}, 'classification': classification, 'acceptedUids': ['new-card-1']}


class DomainIndexTests(unittest.TestCase):
    def setUp(self):
        self.sources = fixture()
        self.model = d.assemble(self.sources)

    def test_shared_goal_retains_other_domains_without_assigning_home(self):
        d.validate(self.model, self.sources)
        goal = self.model['bidirectional-index.json']['objectives']['g1']
        self.assertEqual(goal['qids'], [1, 2])
        self.assertEqual(goal['navigationDomains'], ['1', '2', '4'])
        self.assertIsNone(goal['primaryDomain'])
        self.assertEqual(self.model['domain-views.json']['domains']['4']['inclusiveQuestionIds'], [2])

    def test_provisional_classification_is_visible(self):
        self.assertEqual(self.model['domain-views.json']['domains']['1']['classificationReviewQuestionIds'], [31])

    def test_critical_corruptions_are_rejected(self):
        mutations = [
            lambda m: m['bidirectional-index.json']['questions']['1']['objectiveIds'].clear(),
            lambda m: m['bidirectional-index.json']['objectives']['g1']['qids'].pop(),
            lambda m: m['bidirectional-index.json']['objectives']['g1'].update(primaryDomain='4'),
            lambda m: m['bidirectional-index.json']['questions']['1'].update(cardSupportStatus='fully_supported'),
            lambda m: m['bidirectional-index.json']['judgments']['Q1:j1']['conditionRefs'].clear(),
            lambda m: m['bidirectional-index.json']['objectives']['g1']['variantPointers'].clear(),
            lambda m: m['bidirectional-index.json']['questions']['31']['classification'].update(sourceStatus='已逐题归类'),
            lambda m: m['bidirectional-index.json']['questions']['1']['classification'].update({'建议答案': 'A'}),
            lambda m: m['domain-views.json']['domains'].pop('4'),
            lambda m: m['bidirectional-index.json']['questions'].update({'868': copy.deepcopy(m['bidirectional-index.json']['questions']['1'])}),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(corruption=i):
                bad = copy.deepcopy(self.model)
                mutate(bad)
                with self.assertRaises((AssertionError, KeyError)):
                    d.validate(bad, self.sources)

    def test_reference_metadata_does_not_alias_source(self):
        self.model['bidirectional-index.json']['objectives']['g1']['conditions'][0]['conditionRefs'].clear()
        self.assertEqual(self.sources['blueprint']['objectives'][0]['conditions'][0]['conditionRefs'], ['Q1:c1'])

    def test_empty_binding_is_not_no_existing_cards(self):
        inventory = self.model['card-inventory.json']
        self.assertEqual(inventory['acceptedCount'], 1)
        self.assertEqual(inventory['objectiveBindings'], {})
        self.assertTrue(inventory['bindingStatus'].startswith('not_established'))

    def test_changed_source_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'source.json'
            p.write_text('{}')
            manifest = {'sources': {'example': {'path': str(p), 'sha256': d.sha(p)}}}
            d.verify_sources(manifest)
            p.write_text(json.dumps({'changed': True}))
            with self.assertRaises(AssertionError):
                d.verify_sources(manifest)


if __name__ == '__main__':
    unittest.main()
