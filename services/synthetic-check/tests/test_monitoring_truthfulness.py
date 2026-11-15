"""Source contracts for truthful, bounded monitoring; no CloudWatch deployment."""
import json
import re
from pathlib import Path

from synthetic_check import emf, tracectx

ROOT = Path(__file__).resolve().parents[3]
OBS = ROOT / 'infra/modules/observability'


def test_dashboard_low_sample_is_unknown_not_healthy():
    source = (OBS / 'dashboard.tf').read_text()
    budgets = re.findall(r'expression = "(IF\([^"\n]+)"[^\n]+id = "budget"', source)
    assert len(budgets) == 3
    for expression in budgets:
        # IF without false value drops the datum, rather than manufacturing 100%.
        assert not re.search(r',\s*100\)$', expression), expression
        assert len(expression.split(',')) == 2, expression
    assert 'Unknown' in source
    assert 'historical' in source


def test_missing_heartbeat_still_alarms():
    source = (OBS / 'alarms_r18h.tf').read_text()
    assert 'treat_missing_data  = "breaching"' in source
    assert 'period              = 900' in source
    assert 'evaluation_periods  = 2' in source
    schedule = (ROOT / 'infra/modules/worker/synthetic.tf').read_text()
    assert 'rate(15 minutes)' in schedule


def test_synthetic_dimensions_remain_bounded_even_with_trace_context(capsys, monkeypatch):
    trace = "1-5759e988-bd862e3fe1be46a994272793"
    monkeypatch.setenv(tracectx.ENV_VAR, trace)
    emf.run_line('local-test', [], 0, timestamp_ms=1)
    record = json.loads(capsys.readouterr().out)
    assert record[emf.SUCCESS] == 0
    for metric in record['_aws']['CloudWatchMetrics']:
        assert metric['Dimensions'] == [['Service']]
    assert record['Service'] == 'synthetic-check'
    assert record['xrayTraceId'] == trace
    # The route emitter has an allow-listed template surface, never request identifiers.
    source = (ROOT / 'src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs').read_text()
    assert 'new[] { ServiceDimension, RouteDimension, MethodDimension }' in source
    assert 'new[] { ServiceDimension }' in source
    for dimensions in re.findall(r'Dimensions\s*=\s*([^\n]+)', source):
        assert not re.search(r'User|RequestId|JobId|ReleaseId', dimensions)


def test_drill_runner_refuses_remote_docker_before_invoking_dotnet(tmp_path):
    import os
    import subprocess
    import sys
    result = subprocess.run(
        [sys.executable, str(ROOT / 'scripts/ops/operational_recovery_drills.py'),
         '--evidence-dir', str(tmp_path), '--attempt', '1', '--dotnet', '/must-not-run'],
        env={**os.environ, 'DOCKER_HOST': 'tcp://production.invalid:2376'},
        capture_output=True, text=True, timeout=5)
    assert result.returncode == 2
    assert 'local Docker Unix socket' in result.stderr
    assert not list(tmp_path.iterdir())


def test_drill_runner_preserves_prior_attempt_log(tmp_path):
    import os
    import subprocess
    import sys
    log = tmp_path / 'P5-drills-attempt1.log'
    log.write_text('original failure\n')
    result = subprocess.run(
        [sys.executable, str(ROOT / 'scripts/ops/operational_recovery_drills.py'),
         '--evidence-dir', str(tmp_path), '--attempt', '1', '--dotnet', '/must-not-run'],
        env={**os.environ, 'DOCKER_HOST': 'unix:///var/run/docker.sock'},
        capture_output=True, text=True, timeout=5)
    assert result.returncode != 0
    assert 'FileExistsError' in result.stderr
    assert log.read_text() == 'original failure\n'
