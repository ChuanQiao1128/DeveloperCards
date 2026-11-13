import hashlib
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


record = module('record', 'scripts/cd/release-record.py')
cost = module('cost', 'infra/scripts/check-wave-cost.py')


class GovernanceTests(unittest.TestCase):
    def test_record_verifies_existing_cd_manifest_and_keeps_live_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            (folder / 'artifact.zip').write_bytes(b'local test artifact, not a release')
            digest = hashlib.sha256((folder / 'artifact.zip').read_bytes()).hexdigest()
            manifest = folder / 'SHA256SUMS'
            manifest.write_text(digest + '  artifact.zip\n')
            manifest_hash = hashlib.sha256(manifest.read_bytes()).hexdigest()
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
            args = [ROOT, manifest, manifest_hash, commit, 'local-test', '2.1.0']
            result = record.make_record(*args)
            self.assertTrue(all(v == 'UNKNOWN' for v in result['live'].values()))
            self.assertEqual(55, result['supportedDatabaseSchema']['minimum'])
            for index, bad in [(2, '0' * 64), (3, 'bad'), (4, '../unsafe'), (5, '')]:
                invalid = args.copy(); invalid[index] = bad
                with self.assertRaises(ValueError): record.make_record(*invalid)
            (folder / 'artifact.zip').write_bytes(b'changed')
            with self.assertRaises(ValueError): record.make_record(*args)
            manifest.write_text(digest + '  ../escape\n')
            args[2] = hashlib.sha256(manifest.read_bytes()).hexdigest()
            with self.assertRaises(ValueError): record.make_record(*args)

    def test_cost_gate_rejects_any_new_fixed_or_recurring_resource(self):
        def plan(kind, actions):
            return {'format_version': '1.2', 'resource_changes': [{'mode': 'managed', 'type': kind, 'address': kind + '.test', 'change': {'actions': actions}}]}
        for kind in ['aws_lambda_function', 'aws_db_instance', 'aws_scheduler_schedule', 'aws_cloudwatch_event_rule', 'aws_sqs_queue', 'aws_cloudwatch_metric_alarm', 'aws_cloudwatch_log_metric_filter']:
            for actions in [['create'], ['update'], ['delete', 'create']]:
                with self.assertRaises(ValueError): cost.validate(plan(kind, actions))
            self.assertTrue(cost.validate(plan(kind, ['no-op'])))
        self.assertTrue(cost.validate(plan('aws_iam_policy', ['update'])))
        for bad in [{}, [], {'format_version': '1.2', 'resource_changes': None}]:
            with self.assertRaises(ValueError): cost.validate(bad)

    def test_worker_migrations_and_resource_budgets_stay_separate(self):
        worker = (ROOT / 'src_C/Worker/WorkerFunction.cs').read_text()
        self.assertNotIn('BeginOnline', worker)
        self.assertNotIn('BeginOnline', (ROOT / 'src_C/Vpc/Db/Migrate.cs').read_text())
        import re
        expectations = {'infra/modules/api/core_vpc.tf': {'memory_size':512,'reserved_concurrent_executions':40,'timeout':90},
                        'infra/modules/worker/function.tf': {'memory_size':512,'reserved_concurrent_executions':2,'timeout':615,'batch_size':1},
                        'infra/modules/worker/queue.tf': {'visibility_timeout_seconds':3700}}
        for name, values in expectations.items():
            text = (ROOT / name).read_text()
            for key, value in values.items(): self.assertRegex(text, rf'(?m)^\s*{key}\s*=\s*{value}\b')


if __name__ == '__main__': unittest.main()
