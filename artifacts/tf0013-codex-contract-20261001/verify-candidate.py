"""Serial frozen-candidate checks. Every gate records source cleanliness and its real exit."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

out = Path(__file__).resolve().parent
source_root = out.parents[1]
candidate = json.loads((out / 'candidate.json').read_text())
root = Path(candidate['candidate'])
runtime = root / 'openclaw_runtime'
logs = out / 'candidate-checks' / candidate['commit'][:12]
logs.mkdir(parents=True, exist_ok=True)
driver = root / 'artifacts/tf0013-native-candidate'
driver.mkdir(parents=True, exist_ok=True)
for name in ['run.mjs', 'stdio-proxy.mjs']:
    shutil.copyfile(source_root / 'artifacts/tf0013-native-wire-20260930' / name, driver / name)
spec = 'harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md'
base = candidate['base']
gates = [
    ('runtime-build', runtime, ['node', 'scripts/build-all.mjs']),
    ('native-wire', root, ['node', str(driver / 'run.mjs')]),
    ('native-sdk', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.agents.config.ts', 'harness/selection.compass.test.ts']),
    ('diagnostic-contract', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.extension-codex.config.ts', 'extensions/codex/src/app-server/diagnostic-contract.test.ts']),
    ('reply-compass', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.auto-reply-top-level.config.ts', 'reply.compass.test.ts']),
    ('embedded', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.agents.config.ts', 'rc03-entry-transitions.acceptance.test.ts', 'embedded-agent-runner/extensions.knowledge.test.ts', 'embedded-agent-runner/extensions.working-memory.test.ts', 'embedded-agent-runner/extensions.tool-registry.test.ts']),
    ('budget-combination', runtime, ['node', 'scripts/run-vitest.mjs', 'run', '--reporter=verbose', '--config', 'test/vitest/vitest.unit.config.ts', 'src/context-engine/context-candidate.test.ts', 'src/context-engine/context-orchestrator.test.ts', 'src/context-engine/context-orchestrator.compass.test.ts', 'src/context-engine/assembler.test.ts', 'src/context-engine/turn-injection-budget.test.ts', 'src/context-engine/rc03-seal-wiring.test.ts']),
    ('entry-scan', root, ['node', 'node_modules/vitest/vitest.mjs', 'run', 'tests/unit/context-orchestrator-entry-scan.test.ts']),
    ('runtime-types', runtime, ['node', 'scripts/run-tsgo.mjs', '-p', 'tsconfig.core.json']),
    ('plugin-types', runtime, ['node', 'scripts/run-tsgo.mjs', '-p', 'extensions/codex/tsconfig.json']),
    ('root-types', root, ['node', 'scripts/typecheck-agent-dev.mjs']),
    ('comms-replay', root, ['node', 'scripts/comms/replay.mjs']),
    ('comms-compare', root, ['node', 'scripts/comms/compare.mjs']),
    ('harness-context', root, ['node', 'harness/src/cli.mjs', 'context', '--spec', spec]),
    ('harness-validate', root, ['node', 'harness/src/cli.mjs', 'validate', '--spec', spec, '--since', base]),
    ('harness-dry-run', root, ['node', 'harness/src/cli.mjs', 'run', '--spec', spec, '--since', base, '--dry-run']),
    ('harness-ci', root, ['pnpm.cmd', 'run', 'harness:ci']),
    ('diff-check', root, ['git', 'diff', '--check', base, 'HEAD']),
]
report_path = out / 'candidate-verification.json'
report = json.loads(report_path.read_text()) if report_path.exists() else {'actor':'codex/root','driven_by':'agent','commit':candidate['commit'],'tree':candidate['tree'],'runs':[]}
assert report['commit'] == candidate['commit']
selected = set(sys.argv[1:])
failed = False
for name, cwd, command in gates:
    if selected and name not in selected:
        continue
    before = subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip()
    assert not before, f'Candidate dirty before {name}: {before}'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == candidate['commit']
    attempt = 1 + sum(row['gate'] == name for row in report['runs'])
    log_path = logs / f'{name}-{attempt}.log'
    print(f'Starting {name} (attempt {attempt})', flush=True)
    start = time.monotonic()
    with log_path.open('w', encoding='utf8', newline='\n') as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, env=os.environ.copy())
    after = subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip()
    report['runs'].append({'gate':name,'attempt':attempt,'command':command,'cwd':str(cwd),'exitCode':result.returncode,'seconds':round(time.monotonic()-start,3),'dirtyBefore':False,'dirtyAfter':bool(after),'dirtyPathsAfter':after,'log':str(log_path.relative_to(out)).replace('\\','/')})
    report_path.write_text(json.dumps(report, indent=2) + '\n', newline='\n')
    print(f'{name}: exit {result.returncode}; dirtyAfter={bool(after)}; {report["runs"][-1]["seconds"]}s', flush=True)
    failed |= result.returncode != 0 or bool(after)
    if after or (name == 'runtime-build' and result.returncode != 0):
        break
if (driver / 'native-report.json').exists():
    shutil.copytree(driver, out / 'candidate-native', dirs_exist_ok=True)
raise SystemExit(int(failed))
