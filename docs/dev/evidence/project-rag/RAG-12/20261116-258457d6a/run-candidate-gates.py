import argparse
import datetime
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX')
BASE = Path(__file__).parent
ACTOR = 'codex/project-rag-g2-relay-01a1df5c'
NODE = 'C:/Program Files/nodejs/node.exe'
parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['unit', 'types', 'build', 'electron', 'checks', 'review', 'lint'], required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--formal', action='store_true')
parser.add_argument('--root', type=Path, default=ROOT)
parser.add_argument('--only-ops', action='store_true')
parser.add_argument('--review-model', default='ccs-workbuddy/deepseek-v4.1-flash')
args = parser.parse_args()
ROOT = args.root
OUT = BASE / args.out
OUT.mkdir(parents=True, exist_ok=False)
env = dict(os.environ, TEMP='D:/tmp', TMP='D:/tmp', PYTHONUTF8='1', CLAWX_E2E_RUN_ROOT=str(OUT / 'fixtures'),
    PROJECT_RAG_E2E_ASSETS_DIR='D:/tmp/project-rag-rag05-e2e-assets', CLAWX_E2E_APP_LOGS='1', OPENCLAW_VITEST_FS_MODULE_CACHE='0', COMMS_OUTPUT_DIR=str(OUT/'comms'))
env['PATH'] = 'D:/tmp/project-rag-relay-01a1d438/wmic-bin;' + env.get('PATH', '')
env['NODE_PATH'] = 'D:/tmp/project-rag-longterm-20261109-deps/clawx/.pnpm/@playwright+test@1.59.0/node_modules;D:/tmp/project-rag-longterm-20261109-deps/clawx/.pnpm/node_modules'
def git(*argv):
    return subprocess.check_output(['git', *argv], cwd=ROOT).decode('utf-8').strip()

def snapshot():
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    new = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    files = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(set(changed + new)) if name and (ROOT/name).is_file()}
    return dict(head=git('rev-parse', 'HEAD'), tree=git('rev-parse', 'HEAD^{tree}'), branch=git('branch', '--show-current'),
        dirty=git('status', '--porcelain'), worktreeInputs=files)

before = snapshot()
if args.formal and before['dirty']:
    raise RuntimeError('Formal gates require a clean candidate')
receipt = dict(schema='ProjectRagCandidateGate/v1', actor=ACTOR, driven_by='agent', realHumanEvidence=False,
    phase=args.phase, candidate=before, startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), commands=[], status='running')
def save():
    (OUT/'receipt.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
save()

def run(name, argv, cwd=ROOT):
    started = time.perf_counter()
    print(f'Starting {name}', flush=True)
    with (OUT/(name+'.stdout.log')).open('wb') as stdout, (OUT/(name+'.stderr.log')).open('wb') as stderr:
        result = subprocess.run([str(value) for value in argv], cwd=cwd, env=env, stdout=stdout, stderr=stderr)
    command = dict(name=name, argv=[str(value) for value in argv], cwd=str(cwd), exitCode=result.returncode,
        elapsedMs=round((time.perf_counter()-started)*1000), stdout=name+'.stdout.log', stderr=name+'.stderr.log')
    receipt['commands'].append(command)
    save()
    print(f'Finished {name}: exit {result.returncode}', flush=True)
    return result.returncode == 0

ok = True
if args.phase == 'unit':
    files = ['tests/unit/typecheck-gate.test.ts', 'tests/unit/project-rag-config-parity.test.ts', 'tests/unit/resource-sqlite-wal.test.ts', 'tests/unit/knowledge-source-set-answer.test.ts', 'tests/unit/knowledge-evidence-qa.test.ts', 'tests/unit/project-rag-index-recovery.test.ts',
        'tests/unit/project-rag-plan-owner.test.ts', 'tests/unit/knowledge-api.test.ts', 'tests/unit/host-api-facade.test.ts',
        'tests/unit/knowledge-chat.test.tsx', 'tests/unit/project-rag-embedding-lifecycle.test.ts', 'tests/unit/project-rag-vector-service.test.ts',
        'tests/unit/component-authority-manifest.test.ts', 'tests/unit/component-disposition-catalog.test.ts']
    ok = run('root-unit', [NODE, ROOT/'node_modules/vitest/vitest.mjs', 'run', *files, '--maxWorkers=1', '--cache=false', '--reporter=json', '--outputFile='+str(OUT/'root-unit.json')])
    if ok:
        ok = run('runtime-unit', [NODE, 'scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.unit-src.config.ts',
            'src/knowledge/retrieval/projection-store.test.ts', '--maxWorkers=1', '--cache=false', '--reporter=json', '--outputFile='+str(OUT/'runtime-unit.json')], ROOT/'openclaw_runtime')
    for name in ['root-unit', 'runtime-unit']:
        if not (OUT/(name+'.json')).exists():
            ok = False
            continue
        result = json.loads((OUT/(name+'.json')).read_text(encoding='utf-8-sig'))
        result.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False, candidate=before['head'])
        (OUT/(name+'.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        ok = ok and result.get('success') is True and result.get('numTotalTests', 0) > 0 and result.get('numPendingTests') == 0 and result.get('numFailedTests') == 0
elif args.phase == 'lint':
    lint_inputs = before['worktreeInputs'] or {name: '' for name in git('diff', '--name-only', '8bff5be359d987c3308bc8886f0b4296be1d01f2', 'HEAD').splitlines()}
    paths = [name for name in lint_inputs if name.endswith(('.ts', '.tsx')) and not name.startswith('openclaw_runtime/')]
    ok = run('lint', [NODE, 'node_modules/eslint/bin/eslint.js', *paths])
elif args.phase == 'types':
    ok = run('bridge', [NODE, 'scripts/generate-ext-bridge.mjs'])
    for project in ['node', 'web', 'test']:
        if not ok: break
        ok = run('typecheck-'+project, [NODE, ROOT/'node_modules/@typescript/native-preview/bin/tsgo', '--noEmit', '-p', 'tsconfig.'+project+'.json', '--composite', 'false'])
    receipt['coverage'] = dict(cache='disabled', projects=['node', 'web', 'test'], commandsEquivalentTo=['typecheck:node', 'typecheck:web', 'typecheck:test'])
elif args.phase == 'build':
    ok = run('runtime-build', [NODE, 'scripts/build-openclaw-runtime.mjs'])
    if ok: ok = run('desktop-build', [NODE, '--max-old-space-size=6144', 'node_modules/vite/bin/vite.js', 'build'])
elif args.phase == 'electron':
    (OUT/'fixtures').mkdir(exist_ok=True)
    files = ['tests/e2e/project-rag-settings-operations.spec.ts']
    if not args.only_ops: files.append('tests/e2e/project-rag-provider-settings.spec.ts')
    if not args.formal: env['CLAWX_E2E_KEEP_TEMP'] = '1'
    ok = run('electron', [NODE, ROOT/'node_modules/@playwright/test/cli.js', 'test', *files,
        '--workers=1', '--retries=0', '--reporter=json', '--output', str(OUT/'electron')])
    try:
        result = json.loads((OUT/'electron.stdout.log').read_text(encoding='utf-8-sig'))
        result.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False, candidate=before['head'])
        (OUT/'electron.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        receipt['stats'] = result['stats']
        ok = ok and result['stats']['expected'] == len(files) and not any(result['stats'][key] for key in ['unexpected', 'skipped', 'flaky'])
    except (ValueError, KeyError): ok = False
elif args.phase == 'checks':
    commands = [
        ('contract', [NODE, 'scripts/contract-check.mjs']), ('i18n', [NODE, 'scripts/i18n-lint.mjs']),
        ('catalogs', [NODE, '--import', './openclaw_runtime/node_modules/tsx/dist/loader.mjs', 'scripts/generate-catalogs.mjs', '--check']),
        ('comms-replay', [NODE, 'scripts/comms/replay.mjs']), ('comms-compare', [NODE, 'scripts/comms/compare.mjs']),
        ('harness-validate', [NODE, 'harness/src/cli.mjs', 'validate', '--spec', 'harness/specs/tasks/project-rag-config-and-operations.md']),
        ('harness-dry-run', [NODE, 'harness/src/cli.mjs', 'run', '--spec', 'harness/specs/tasks/project-rag-config-and-operations.md', '--dry-run']),
    ]
    for name, argv in commands:
        if not run(name, argv): ok = False
elif args.phase == 'review':
    ok = run('autoreview', ['python', ROOT/'openclaw_runtime/.agents/skills/autoreview/scripts/autoreview', '--mode', 'local',
        '--engine', 'codex', '--model', args.review_model, '--thinking', 'high', '--no-web-search',
        '--prompt-file', BASE/'rag12-review-notes.md', '--dataset', BASE/'rag12-review-dataset.json', '--stream-engine-output',
        '--json-output', OUT/'review.json', '--output', OUT/'review.txt'])

after = snapshot()
receipt.update(after=after, sourceUnchanged=before == after, completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    status='pass' if ok and before == after else 'fail')
save()
print(json.dumps(dict(status=receipt['status'], sourceUnchanged=receipt['sourceUnchanged'], path=str(OUT/'receipt.json'))), flush=True)
raise SystemExit(0 if receipt['status'] == 'pass' else 1)
