"""Run recorded development gates; preserve package baseline failures separately."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

out = Path(__file__).resolve().parent
root = out.parents[1]
runtime = root / 'openclaw_runtime'
spec = 'harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md'
sources = ['src/agents/harness/context-engine-lifecycle.ts', 'src/agents/harness/selection.compass.test.ts', 'extensions/codex/src/app-server/run-attempt.ts']
gates = [
    ('build', runtime, ['node', 'scripts/build-all.mjs', 'gatewayWatch']),
    ('native-wire', root, ['node', str(out / 'run.mjs')]),
    ('native-sdk', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.agents.config.ts', 'harness/selection.compass.test.ts']),
    ('runtime-types', runtime, ['node', 'scripts/run-tsgo.mjs', '-p', 'tsconfig.core.json', '--incremental', '--tsBuildInfoFile', '.artifacts/tsgo-cache/core.tsbuildinfo']),
    ('root-types', root, ['node', 'scripts/typecheck-agent-dev.mjs']),
    ('lint', runtime, ['node', 'scripts/run-oxlint.mjs', *sources]),
    ('format', runtime, ['node', 'node_modules/oxfmt/bin/oxfmt', '--check', '--threads=1', *sources]),
    ('comms-replay', root, ['node', 'scripts/comms/replay.mjs']),
    ('comms-compare', root, ['node', 'scripts/comms/compare.mjs']),
    ('harness-validate', root, ['node', 'harness/src/cli.mjs', 'validate', '--spec', spec]),
    ('harness-dry-run', root, ['node', 'harness/src/cli.mjs', 'run', '--spec', spec, '--dry-run']),
    ('diff-check', root, ['git', 'diff', '--check', '--', *['openclaw_runtime/' + name for name in sources], spec, 'docs/dev/tf0013-native-wire-20261001.md']),
]
report_path = out / 'verification.json'
report = json.loads(report_path.read_text()) if report_path.exists() else {'actor': 'codex/root', 'driven_by': 'agent', 'scope': 'development-only', 'gates': []}
selected = set(sys.argv[1:])
failed = False
for name, cwd, command in gates:
    if selected and name not in selected:
        continue
    env = os.environ.copy()
    if name.startswith('harness-'):
        ignore = out / 'harness-ignore'
        ignore.write_text('%SystemDrive%/\n')
        env.update(GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='core.excludesFile', GIT_CONFIG_VALUE_0=str(ignore))
    print('Starting ' + name, flush=True)
    start = time.monotonic()
    with (out / (name + '.log')).open('w', encoding='utf8') as log:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    row = {'gate': name, 'command': command, 'cwd': str(cwd), 'exitCode': result.returncode, 'seconds': round(time.monotonic() - start, 3), 'log': name + '.log'}
    if name.startswith('harness-'):
        row['excludedPreExistingUntrackedDirectory'] = '%SystemDrive%/'
    report['gates'] = [old for old in report['gates'] if old['gate'] != name] + [row]
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f"{name}: exit {result.returncode} ({row['seconds']}s)", flush=True)
    failed |= result.returncode != 0
raise SystemExit(int(failed))
