import unittest
from unittest.mock import Mock

from claim_evidence import check_claim, checked_review, ordered_snapshot_rows, pack

CLAIM = 'AWS managed keys rotate annually and their use can be audited.'
QUERY = 'Which rotation and audit options are available for AWS managed keys?'
MISSING = 'Can AWS managed key usage be audited with CloudTrail?'
ROTATION = {'evidenceId': 'rotation', 'text': 'AWS managed keys are automatically rotated every year.',
            'url': 'https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html'}
AUDIT = {'evidenceId': 'audit', 'text': 'You can audit their use in AWS CloudTrail logs.',
         'url': 'https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html'}


class ClaimEvidenceTests(unittest.TestCase):
    def test_followup_keeps_the_first_citation_and_adds_missing_evidence(self):
        search = Mock(side_effect=[[ROTATION], [AUDIT]])
        review = Mock(side_effect=[
            {'status': 'insufficient', 'citations': ['rotation'], 'missing': [MISSING]},
            {'status': 'supported', 'citations': ['rotation', 'audit'], 'missing': []},
        ])
        result = check_claim(CLAIM, QUERY, search, review)
        self.assertEqual([call.args[0] for call in search.call_args_list], [QUERY, MISSING])
        self.assertEqual(review.call_args.args, (CLAIM, [ROTATION, AUDIT], 2))
        self.assertEqual((result['initialStatus'], result['status'], result['reviewAttempts']),
                         ('insufficient', 'supported', 2))
        self.assertEqual(result['citations'], [ROTATION, AUDIT])

    def test_insufficient_after_followup_stays_insufficient(self):
        search = Mock(side_effect=[[ROTATION], [AUDIT]])
        review = Mock(return_value={'status': 'insufficient', 'citations': ['rotation'], 'missing': [MISSING]})
        result = check_claim(CLAIM, QUERY, search, review)
        self.assertEqual(result['status'], 'insufficient')
        self.assertEqual(result['missing'], [MISSING])
        self.assertEqual(review.call_count, 2)

    def test_followup_can_find_new_evidence_behind_existing_hits(self):
        original = [ROTATION, *({'evidenceId': str(i), 'text': 'Unrelated AWS excerpt'} for i in range(4))]
        search = Mock(side_effect=[original, [*original, AUDIT]])
        review = Mock(side_effect=[
            {'status': 'insufficient', 'citations': ['rotation'], 'missing': [MISSING]},
            {'status': 'supported', 'citations': ['rotation', 'audit'], 'missing': []},
        ])
        result = check_claim(CLAIM, QUERY, search, review)
        self.assertEqual(result['citations'], [ROTATION, AUDIT])
        self.assertIn(AUDIT, review.call_args.args[1])

    def test_identical_evidence_does_not_trigger_another_model_call(self):
        search = Mock(return_value=[ROTATION])
        review = Mock(return_value={'status': 'insufficient', 'citations': ['rotation'], 'missing': [MISSING]})
        result = check_claim(CLAIM, QUERY, search, review)
        self.assertEqual(result['status'], 'insufficient')
        self.assertEqual(result['reviewAttempts'], 1)
        self.assertEqual(search.call_count, 2)
        review.assert_called_once()

    def test_contradiction_does_not_trigger_a_followup(self):
        search = Mock(return_value=[ROTATION])
        review = Mock(return_value={'status': 'contradicted', 'citations': ['rotation'], 'missing': []})
        result = check_claim('AWS managed keys rotate every month.', QUERY, search, review)
        self.assertEqual(result['status'], 'contradicted')
        search.assert_called_once_with(QUERY)
        review.assert_called_once()

    def test_unbound_or_missing_conclusion_citations_are_rejected(self):
        for citations in ([], ['fabricated'], ['rotation', 'rotation']):
            with self.subTest(citations=citations), self.assertRaises(ValueError):
                checked_review({'status': 'supported', 'citations': citations, 'missing': []}, pack([ROTATION]))

    def test_invalid_followup_query_is_rejected_before_retrieval(self):
        search = Mock(return_value=[ROTATION])
        review = Mock(return_value={'status': 'insufficient', 'citations': [], 'missing': ['See https://example.com']})
        with self.assertRaises(ValueError):
            check_claim(CLAIM, QUERY, search, review)
        search.assert_called_once_with(QUERY)

    def test_pack_deduplicates_and_limits_count_and_text(self):
        small = [{'evidenceId': str(i), 'text': 'AWS'} for i in range(12)]
        self.assertEqual(list(pack([ROTATION, ROTATION, *small])), ['rotation', *map(str, range(7))])
        large = [{'evidenceId': str(i), 'text': 'X' * 7000} for i in range(2)]
        self.assertEqual(list(pack([*large, AUDIT])), ['0', 'audit'])

    def test_reordered_or_duplicate_chunk_offsets_are_rejected(self):
        first = {'sourceId': 'source-a', 'charStart': 0}
        second = {'sourceId': 'source-a', 'charStart': 20}
        self.assertEqual(ordered_snapshot_rows([first, second]), [first, second])
        for rows in ([second, first], [first, first]):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, 'Chunk order'):
                ordered_snapshot_rows(rows)


if __name__ == '__main__':
    unittest.main()
