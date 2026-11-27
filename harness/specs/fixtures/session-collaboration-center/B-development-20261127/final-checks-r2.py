from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import time

root = Path('D:/tmp/session-collaboration-mainline-20261126/A/review-fixes-source')
raw = Path(__file__).parent
out = raw / 'final-checks-r2'
out.mkdir(exist_ok=False)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

assert not git('status', '--porcelain')
candidate = {'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'), 'dirty': False}
changed = git('diff', '--name-only', 'c92ed890056068ca07769c0a410cd0cd90101085', 'HEAD').splitlines()
sources = [{'path': p, 'sha256': digest(root / p), 'gitBlob': git('rev-parse', 'HEAD:' + p)}
           for p in changed if (root / p).is_file()]
report = {'driven_by': 'agent', 'actor': 'codex/session-collaboration-b-relay', 'candidate': candidate,
          'sources': sources, 'steps': [], 'startedAt': datetime.now(timezone.utc).isoformat(),
          'dependencyMode': 'existing dependency junctions; no installation', 'fullAcceptance': 'deferred_by_user'}
env = {**os.environ, 'TEMP': 'D:/tmp', 'TMP': 'D:/tmp', 'TMPDIR': 'D:/tmp',
       'COMMS_OUTPUT_DIR': str(out / 'comms'), 'ELECTRON_OVERRIDE_DIST_PATH': 'D:/tmp/electron-40.8.4/dist',
       'CLAWX_E2E_EXECUTABLE_PATH': 'D:/tmp/electron-40.8.4/dist/electron.exe'}

def save():
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def run(name, args, *, timeout=180):
    assert git('rev-parse', 'HEAD') == candidate['commit'] and not git('status', '--porcelain')
    start = time.monotonic()
    command = ['C:/Program Files/nodejs/node.exe', '--max-old-space-size=640', *args]
    with (out / (name + '.stdout.txt')).open('wb') as stdout, (out / (name + '.stderr.txt')).open('wb') as stderr:
        result = subprocess.run(command, cwd=root, env=env, stdout=stdout, stderr=stderr, timeout=timeout)
    step = {'id': name, 'argv': command, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - start, 3)}
    for key in ['stdout', 'stderr']:
        path = out / (name + '.' + key + '.txt')
        step[key + 'Path'] = str(path)
        step[key + 'Sha256'] = digest(path)
    report['steps'].append(step)
    save()
    print(name, result.returncode, flush=True)
    if result.returncode:
        raise RuntimeError('Check failed: ' + name)

groups = {
    'composer': ['chat-input.test.tsx', 'chat-message.test.tsx', 'chat-send-input-mode.test.ts', 'chat-api-workspace-fingerprint.test.ts'],
    'collaboration': ['session-collaboration-control-semantics.test.ts', 'session-collaboration-delivery.test.ts',
        'session-collaboration-message-budget.test.ts', 'session-collaboration-message-envelope.test.ts',
        'session-collaboration-message-view.test.tsx', 'session-collaboration-panel.test.tsx',
        'session-collaboration-watch.test.ts', 'chat-store-history-retry.test.ts'],
    'query-integration': ['host-api-facade.test.ts', 'session-collaboration-identity.test.ts',
        'session-collaboration-query.test.ts', 'session-summary-bounded-read.test.ts'],
}
try:
    previous = json.loads((raw / 'final-checks/report.json').read_text(encoding='utf-8'))
    assert previous['candidate'] == candidate and previous['sources'] == sources
    import shutil
    for name in ['composer', 'collaboration']:
        step = next(s for s in previous['steps'] if s['id'] == name)
        assert step['exitCode'] == 0
        for key in ['stdout', 'stderr']:
            assert digest(Path(step[key + 'Path'])) == step[key + 'Sha256']
        for suffix in ['.json', '.stdout.txt', '.stderr.txt']:
            shutil.copy2(raw / 'final-checks' / (name + suffix), out / (name + suffix))
        report['steps'].append(step)
    report['retainedReport'] = {'path': str(raw / 'final-checks/report.json'), 'sha256': digest(raw / 'final-checks/report.json')}
    for name, files in groups.items():
        if name in ['composer', 'collaboration']: continue
        run(name, ['node_modules/vitest/vitest.mjs', 'run', *['tests/unit/' + f for f in files],
            '--maxWorkers=1', '--no-file-parallelism', '--reporter=default', '--reporter=json',
            '--outputFile.json=' + str(out / (name + '.json'))])
        value = json.loads((out / (name + '.json')).read_text(encoding='utf-8'))
        assert value['success'] and value['numPassedTests'] == value['numTotalTests']
        assert value['numFailedTests'] == value['numPendingTests'] == value['numTodoTests'] == 0
    run('permit', ['node_modules/vitest/vitest.mjs', 'run', '--config', str(raw / 'runtime-permit.config.mts'),
        '--reporter=default', '--reporter=json', '--outputFile.json=' + str(out / 'permit.json')])
    run('contract', ['scripts/contract-check.mjs'])
    run('i18n', ['scripts/i18n-lint.mjs'])
    run('comms-replay', ['scripts/comms/replay.mjs'])
    run('comms-compare', ['scripts/comms/compare.mjs'])
    spec = 'harness/specs/tasks/session-collaboration-b-mainline.md'
    run('harness-validate', ['harness/src/cli.mjs', 'validate', '--spec', spec])
    run('harness-dry-run', ['harness/src/cli.mjs', 'run', '--spec', spec, '--dry-run'])
    run('electron-collect', ['node_modules/@playwright/test/cli.js', 'test',
        'tests/e2e/session-collaboration-controls.spec.ts', 'tests/e2e/session-collaboration-delivery-recovery.spec.ts', '--list'])
    assert all(digest(root / f['path']) == f['sha256'] for f in sources)
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    report['endedAt'] = datetime.now(timezone.utc).isoformat()
    save()
