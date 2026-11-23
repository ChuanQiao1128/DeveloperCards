import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import exam_deck as flow


RULE = {'key': 'shared-disk', 'goal': 'Choose a persistent disk', 'query': 'persistent disk keeps file',
        'urls': []}
DOC = {'source': 'disk', 'title': 'Disk service', 'url': 'https://docs.aws.amazon.com/example',
       'text': 'The persistent disk keeps written files when the virtual machine stops.'}
QUOTE = 'The persistent disk keeps written files'


def question(number):
    return {'id': f'Q{number}', 'text': f'After stop and start, deployment {number} needs its files.',
            'choices': {'A': 'Persistent disk', 'B': 'Discard the files'}, 'answer': ['A']}


def card(*, revised=False):
    answer = QUOTE + (' after a stop.' if revised else '.')
    return {'key': RULE['key'], 'status': 'draft', 'frontEn': 'A machine will stop and start.\n\nWhere should files go?',
            'answerEn': answer, 'reasonEn': DOC['text'], 'checkEn': answer,
            'frontZh': '一台机器会停机再启动。\n\n文件应该存在哪里？',
            'answerZh': '把文件写到持久磁盘。', 'reasonZh': '关机时，持久磁盘仍保留已写入的文件。',
            'evidence': [{'field': field, 'source': 'disk', 'quote': DOC['text']} for field in ('answer', 'reason')],
            'note': 'One decision.'}


def supported(qid):
    return {'id': qid, 'verdict': 'supported', 'selected': ['A'],
            'uses': [{'need': 1, 'key': RULE['key'], 'quote': QUOTE}],
            'options': [{'choiceId': label, 'verdict': verdict, 'cardKey': RULE['key'], 'quote': QUOTE,
                         'reason': 'The scenario requires retaining the written files.'}
                        for label, verdict in [('A', 'select'), ('B', 'reject')]],
            'repairKeys': [], 'note': 'The card explains persistence when the machine stops.'}


class FrozenSources:
    hosts = {'docs.aws.amazon.com'}

    def packet(self, urls, search, limit):
        return [DOC]


class Model:
    def __init__(self, *, repair=False, wrong_key=False):
        self.repair = repair
        self.wrong_key = wrong_key
        self.requests = []

    def __call__(self, stage, instructions, data, schema):
        self.requests.append((stage, copy.deepcopy(data)))
        if stage == 'plan':
            return {'rules': [] if data['nearbyRules'] else [RULE],
                    'questions': [{'id': q['id'], 'needs': [{'need': 'Select storage that keeps files.',
                                                          'key': RULE['key']}]} for q in data['questions']]}
        if stage == 'author':
            result = card(revised=bool(data['previousCards']))
            return {'cards': [result]}
        if stage == 'card-review':
            return {'cards': [{'key': RULE['key'], 'verdict': 'pass', 'note': 'Cited mechanism and bilingual scope match.'}]}
        if stage == 'question-review':
            rows = []
            for packet in data['packets']:
                qid = packet['question']['id']
                row = supported(qid)
                if self.repair and qid == 'Q2' and 'after a stop.' not in packet['cards'][0]['answerEn']:
                    row.update(verdict='gap', repairKeys=[RULE['key']], note='Make stop behavior explicit.')
                rows.append(row)
            return {'questions': rows}
        if stage == 'source-review' and self.wrong_key:
            return {'verdict': 'wrong_key', 'evidence': [{'source': 'disk', 'quote': DOC['text']}],
                    'note': 'The printed key reverses the retention rule.'}
        raise AssertionError(stage)


class ExamDeckWorkflowTests(unittest.TestCase):
    def workflow(self, directory, bank, model, exporter=None):
        root = Path(directory)
        exporters = {'exporter': exporter} if exporter else {}
        result = flow.execute(root, {'deckSlug': 'exam-test'}, bank, 'Frozen mobile rules', model, FrozenSources(),
                              **exporters)
        return result, flow.load(root / f'round-{result["rounds"]}.json')

    def test_shared_rule_and_failed_question_trigger_targeted_repair(self):
        model = Model(repair=True)
        with tempfile.TemporaryDirectory() as directory:
            result, last = self.workflow(directory, [question(1), question(2)], model,
                                         exporter=lambda *args: ['isolated-bundle'])
            first = flow.load(Path(directory) / 'round-1.json')
        self.assertEqual(first['counts'], {'supported': 1, 'gap': 1})
        self.assertEqual(result['counts'], {'supported': 2})
        self.assertEqual(result['rounds'], 2)
        self.assertEqual(result['deliveredCards'], 1)
        self.assertEqual(len(last['cards']), 1)
        self.assertNotEqual(first['cardReviews'][RULE['key']]['cardSha256'],
                            last['cardReviews'][RULE['key']]['cardSha256'])
        plans = [data for stage, data in model.requests if stage == 'plan']
        self.assertEqual([q['id'] for q in plans[1]['questions']], ['Q2'])
        self.assertEqual(len([stage for stage, _ in model.requests if stage == 'card-review']), 2)
        proofs = [data for stage, data in model.requests if stage == 'question-review']
        self.assertTrue(all('answer' not in item['question'] for proof in proofs for item in proof['packets']))
        self.assertEqual(len(proofs[1]['packets']), 2, 'both questions use the modified card')
        self.assertEqual(proofs[1]['packets'][0]['judgments'][0]['key'], RULE['key'])

    def test_thousand_question_dry_run_batches_reviews_and_preserves_denominator(self):
        model = Model()
        bank = [question(i) for i in range(1, 1025)]
        with tempfile.TemporaryDirectory() as directory:
            result, last = self.workflow(directory, bank, model, exporter=lambda *args: ['isolated-bundle'])
        self.assertEqual(result['counts'], {'supported': 1024})
        self.assertEqual(len(last['rules']), 1)
        self.assertEqual(sum(stage == 'question-review' for stage, _ in model.requests), 128)

    def test_bad_proofs_cannot_pass(self):
        q = question(1)
        content = {RULE['key']: card(), 'other': card()}
        needs = [{'key': RULE['key'], 'need': 'Choose durable storage.'}]
        mutations = [
            lambda p: p['uses'][0].update(key='other'),
            lambda p: p['uses'][0].update(quote='This phrase does not appear in the card.'),
            lambda p: p['options'][1].update(verdict='select'),
            lambda p: p['options'].pop(),
            lambda p: p['options'][0].update(cardKey='', quote=q['text']),
        ]
        for mutate in mutations:
            proof = supported('Q1')
            mutate(proof)
            with self.assertRaises(ValueError):
                flow.check_question(q, proof, needs, content)
        proof = supported('Q1')
        proof['options'][1].update(cardKey='', quote='After stop and start')
        self.assertEqual(flow.check_question(q, proof, needs, content), 'supported')

    def test_impossible_or_missing_evidence_cannot_finish(self):
        def model(stage, instructions, data, schema):
            if stage == 'author':
                draft = card()
                draft['evidence'][0]['quote'] = 'Claim without any matching evidence.'
                return {'cards': [draft]}
            return Model()(stage, instructions, data, schema)

        with tempfile.TemporaryDirectory() as directory:
            result, last = self.workflow(directory, [question(1)], model, exporter=lambda *args: self.fail('export'))
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['unresolved'], ['Q1'])
        self.assertFalse(last['cards'])

    def test_key_disagreement_keeps_verified_card_and_original_input(self):
        q = question(1)
        q['answer'] = ['B']
        with tempfile.TemporaryDirectory() as directory:
            sources = FrozenSources()
            with patch.object(sources, 'packet', wraps=sources.packet) as retrieval:
                result = flow.execute(Path(directory), {'deckSlug': 'exam-test'}, [q], 'Frozen rules',
                                      Model(wrong_key=True), sources, exporter=lambda *args: ['isolated-bundle'])
            self.assertEqual(retrieval.call_args_list[-1].args[0], [DOC['url']])
            last = flow.load(Path(directory) / 'round-1.json')
        self.assertEqual(result['status'], 'verified_with_source_issues')
        self.assertEqual(result['counts'], {'supported_with_corrected_key': 1})
        self.assertEqual(last['questions']['Q1']['proof']['selected'], ['A'])
        self.assertEqual(q['answer'], ['B'])

    def test_model_identity_repair_uses_a_distinct_packet(self):
        outputs = iter([{'rows': []}, {'rows': [{'id': 'Q1'}]}])
        requests = []
        def model(stage, instructions, data, schema):
            requests.append(data)
            return next(outputs)
        _, rows = flow.result_rows(model, 'review', 'Review', {}, {}, 'rows', 'id', ['Q1'])
        self.assertEqual(set(rows), {'Q1'})
        self.assertIn('identityRepair', requests[1])

    def test_cross_batch_merge_only_when_reviewer_confirms(self):
        new = dict(RULE, key='shared-disk-two')
        rules = {r['key']: dict(r) for r in [RULE, new]}
        allocation = {'Q1': [{'need': 'retain files', 'key': RULE['key']}],
                      'Q2': [{'need': 'open files', 'key': new['key']}]}
        def reviewer(stage, instructions, data, schema):
            self.assertEqual(stage, 'merge-review')
            return {'pairs': [{'id': pair['id'], 'verdict': 'equivalent', 'note': 'Identical rule.'}
                              for pair in data['pairs']]}
        flow.merge_shared_rules(reviewer, rules, allocation)
        self.assertEqual(set(rules), {RULE['key']})
        self.assertEqual(allocation['Q1'][0]['key'], allocation['Q2'][0]['key'])

    def test_merge_chain_does_not_collapse_explicit_distinction(self):
        rules = {key: dict(RULE, key=key) for key in ['a', 'b', 'c']}
        allocation = {key: [{'key': key}] for key in rules}

        def reviewer(stage, instructions, data, schema):
            return {'pairs': [{'id': pair['id'], 'verdict': ('distinct' if {
                pair['left']['key'], pair['right']['key']} == {'a', 'c'} else 'equivalent'), 'note': 'Reviewed.'}
                for pair in data['pairs']]}

        flow.merge_shared_rules(reviewer, rules, allocation)
        self.assertNotEqual(allocation['a'][0]['key'], allocation['c'][0]['key'])
        self.assertEqual(len(rules), 2)

    def test_private_source_replay_retains_missing_fetch_and_checks_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            urls = ['https://docs.aws.amazon.com/example']
            with patch.object(flow, 'ingest', side_effect=flow.IngestError('planned transient test')):
                self.assertEqual(flow.Sources(root, FrozenSources.hosts).packet(urls, 'disk', 3), [])
            with patch.object(flow, 'ingest', side_effect=AssertionError('must use frozen result')):
                self.assertEqual(flow.Sources(root, FrozenSources.hosts).packet(urls, 'disk', 3), [])
                with self.assertRaises(ValueError):
                    flow.Sources(root, FrozenSources.hosts).packet(['https://other.example/a'], 'disk', 3)

    def test_mechanical_option_repair_does_not_regenerate_cards_or_other_proofs(self):
        model = Model()
        def malformed_model(stage, instructions, data, schema):
            result = model(stage, instructions, data, schema)
            if stage == 'question-review':
                for row in result['questions']:
                    row['note'] = ''
                if not data['mechanicalRepair']:
                    result['questions'][0]['options'][0]['choiceId'] = 'Persistent disk'
            return result
        with tempfile.TemporaryDirectory() as directory:
            result, _ = self.workflow(directory, [question(1), question(2)], malformed_model,
                                      exporter=lambda *args: ['isolated-bundle'])
        self.assertEqual(result['rounds'], 1)
        self.assertEqual(result['counts'], {'supported': 2})
        self.assertEqual(sum(stage == 'author' for stage, _ in model.requests), 1)
        proof_calls = [data for stage, data in model.requests if stage == 'question-review']
        self.assertEqual([row['question']['id'] for row in proof_calls[1]['packets']], ['Q1'])

    def test_archive_duplicate_original_labels_keep_both_options(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'archive.json'
            flow.save(path, {'125': {'qid':125, 'stem':'Original question?',
                                     'options':[{'originalLabel':'D', 'ordinal': 4, 'text':'Fourth.'},
                                                {'originalLabel':'D', 'ordinal': 5, 'text':'Fifth.'}]}})
            result = flow.normalize_questions(path, 1)
        self.assertEqual(result, [{'id':'Q125', 'text':'Original question?',
                                   'choices':{'D@4':'Fourth.', 'D@5':'Fifth.'}, 'answer':[]}])

    def test_complete_question_at_intake_limit_reaches_planner(self):
        original = {'id':'Q1', 'text':'x' * 10000,
                    'choices':{str(i):'y' * 2999 for i in range(10)}}
        excess = len(flow.canonical(original)) - 40000
        original['choices']['0'] = original['choices']['0'][:-excess]
        self.assertEqual(len(flow.canonical(original)), 40000)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'long.json'
            flow.save(path, [original])
            bank = flow.normalize_questions(path, 1)
        rules = {}
        result = flow.plan(Model(), bank, rules, {'hosts':set(), 'questions':{}})
        self.assertIn('Q1', result)

    def test_pdf_ingest_preserves_question_ids_and_rejects_missing_rows(self):
        raw = b"Question 1. What preserves the files?\nA. Disk\nB. Memory\nAnswer: A\n"
        with patch.object(flow.subprocess, 'run', return_value=flow.subprocess.CompletedProcess([], 0, raw)):
            self.assertEqual(flow.normalize_questions(Path('exam.pdf'), 1)[0],
                             {'id':'Q1', 'text':'What preserves the files?',
                              'choices':{'A':'Disk', 'B':'Memory'}, 'answer':['A']})
            with self.assertRaisesRegex(ValueError, 'questionCount'):
                flow.normalize_questions(Path('exam.pdf'), 2)

    def test_workbench_resume_reuses_original_receipt_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            model = flow.Workbench(Path(directory), 'dotnet')

            def dispatch(command, **_):
                folder = Path(command[command.index('--output') + 1])
                folder.mkdir()
                files = {'result.json': '{"rows":[]}', 'events.jsonl': '{}', 'stderr.log': ''}
                for name, content in files.items():
                    (folder / name).write_text(content)
                prompt = Path(command[command.index('--prompt') + 1]).read_text()
                schema = Path(command[command.index('--schema') + 1]).read_text()
                flow.save(folder / 'execution.json',
                          {'inputHash': flow.digest(prompt), 'schemaHash': flow.digest(schema),
                           'outputHash': flow.digest(files['result.json']), 'eventsHash': flow.digest(files['events.jsonl']),
                           'stderrHash': flow.digest(files['stderr.log']), 'success': True, 'exitCode': 0})
                return flow.subprocess.CompletedProcess(command, 0, '', '')

            args = ('review', 'Verify', {'id':'Q1'}, {})
            with patch.object(flow.subprocess, 'run', side_effect=dispatch) as run:
                self.assertEqual(model(*args), {'rows':[]})
                self.assertEqual(model(*args), {'rows':[]})
                self.assertEqual(run.call_count, 1)
                result = next(Path(directory).glob('requests/*/execution/result.json'))
                result.write_text('{"rows":[1]}')
                with self.assertRaisesRegex(ValueError, 'Unverified Workbench execution'):
                    model(*args)
                result.unlink()
                with self.assertRaisesRegex(RuntimeError, 'Uncertain Workbench request'):
                    model(*args)
                self.assertEqual(run.call_count, 1)

    def test_url_citation_resolves_only_against_its_actual_excerpt(self):
        ref = {'source': DOC['url'], 'quote': QUOTE}
        self.assertEqual(flow.verify_quotes([ref], [DOC]), [{'source':'disk', 'quote':QUOTE}])
        with self.assertRaisesRegex(ValueError, 'absent from the named'):
            flow.verify_quotes([dict(ref, source='https://docs.aws.amazon.com/another')], [DOC])

    @unittest.skipUnless((flow.REPO / 'frontend/node_modules/esbuild').exists(), 'install frontend dependencies')
    def test_console_preview_and_tampered_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            result, _ = self.workflow(directory, [question(1)], Model())
            bundle = Path(result['bundles'][0])
            artifact = json.loads(bundle.read_text())
            self.assertTrue((Path(directory) / 'cards.md').is_file())
            artifact['schema'] = 'invalid-schema'
            bundle.write_text(json.dumps(artifact))
            with self.assertRaisesRegex(ValueError, 'different content'):
                self.workflow(directory, [question(1)], Model())


if __name__ == '__main__':
    unittest.main()
