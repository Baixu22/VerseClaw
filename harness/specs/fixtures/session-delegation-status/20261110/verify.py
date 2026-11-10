"""Verify the retained U4 evidence without replaying a product action."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
report = json.loads((root / 'report.json').read_text(encoding='utf-8'))
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert report['status'] == 'passed' and report['acceptedNode'] == 'TF-0660'
assert len(report['acceptance']) == 9
assert all(row['result'] == 'passed' for row in report['acceptance'])
listed = set()
for row in manifest['files']:
    path = root / row['path']
    assert path.resolve().is_relative_to(root), row['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256'], row['path']
    listed.add(row['path'])
actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path != root / 'manifest.json'}
assert actual == listed, {'missing': sorted(actual - listed), 'unexpected': sorted(listed - actual)}
unit_ids = set()
electron_ids = set()
for run in report['commands']:
    raw = json.loads((root / run['result']).read_text(encoding='utf-8'))
    assert raw['exitCode'] == 0 and raw['sourceUnchanged']
    assert raw['before']['dirty'] == raw['after']['dirty'] == ''
    assert raw['before']['commit'] == run['candidate']
    if not run.get('tests'):
        continue
    tests = json.loads((root / run['tests']).read_text(encoding='utf-8'))
    if run['kind'] == 'unit':
        assert tests['success'] and tests['numFailedTests'] == 0 and tests['numPendingTests'] == 0
        for suite in tests['testResults']:
            assert suite['status'] == 'passed'
            for item in suite['assertionResults']:
                assert item['status'] == 'passed'
                unit_ids.add(Path(suite['name']).name + '::' + item['fullName'])
    elif run['kind'] == 'electron':
        assert tests['stats']['unexpected'] == tests['stats']['skipped'] == tests['stats']['flaky'] == 0
        assert tests.get('errors', []) == []
        def visit(suites):
            for suite in suites:
                for spec in suite.get('specs', []):
                    for test in spec['tests']:
                        assert test['status'] == 'expected'
                        assert test['results'][-1]['status'] == 'passed'
                    electron_ids.add(spec['file'] + '::' + spec['title'])
                visit(suite.get('suites', []))
        visit(tests['suites'])
        cleanup = json.loads((root / run['cleanup']).read_text(encoding='utf-8'))
        assert cleanup['status'] == 'passed' and not cleanup['survivors']
        source_guard = json.loads((root / run['sourceGuard']).read_text(encoding='utf-8'))
        assert source_guard['ok'] and not source_guard['sourceChanged']
assert len(unit_ids) == report['uniqueUnitPassed']
assert len(electron_ids) == report['uniqueElectronPassed']
visual = json.loads((root / 'visual-readback.json').read_text(encoding='utf-8'))
assert {row['language'] for row in visual['inspected']} == {'en', 'zh', 'ja', 'ru'}
for row in visual['inspected']:
    assert hashlib.sha256((root / row['path']).read_bytes()).hexdigest() == row['sha256']
assert report['credentialScan']['hits'] == []
replay = json.loads((root / report['ownerReplay']['source']).read_text(encoding='utf-8'))
assert replay['terminalBatch']['outcome'] == report['ownerReplay']['terminalOutcome']
assert replay['terminalBatch']['delivery']['state'] == report['ownerReplay']['deliveryState']
assert replay['terminalBatch']['consolidatedReceiptId'] == replay['restartReplay']['consolidatedReceiptId']
assert replay['resetFence']['generationState'] == report['ownerReplay']['resetGenerationState'] == 'mismatch'
assert report['artifacts'], 'Retain the actual worker output files'
for artifact in report['artifacts']:
    assert hashlib.sha256((root / artifact['path']).read_bytes()).hexdigest() == artifact['sha256']
repo = next(parent for parent in root.parents if (parent / '.git').exists())
for row in report['sources']:
    content = subprocess.check_output(['git', 'show', report['candidate'] + ':' + row['path']], cwd=repo)
    assert hashlib.sha256(content).hexdigest() == row['sha256'], row['path']
print(json.dumps({'status': 'passed', 'node': report['acceptedNode'], 'files': len(listed),
                  'unit': len(unit_ids), 'electron': len(electron_ids)}))
