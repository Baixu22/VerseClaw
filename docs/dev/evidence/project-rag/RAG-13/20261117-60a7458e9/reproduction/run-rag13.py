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
ACTOR = 'codex-g2-rag-relay-20261117'
NODE = 'C:/Program Files/nodejs/node.exe'
parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['unit', 'types', 'build', 'electron', 'checks', 'review', 'lint', 'runtime-lint', 'format', 'ci', 'control-e2e'], required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--formal', action='store_true')
parser.add_argument('--root', type=Path, default=ROOT)
parser.add_argument('--only-ops', action='store_true')
parser.add_argument('--review-helper', type=Path)
parser.add_argument('--review-notes', type=Path, default=BASE/'rag13-review-notes.md')
parser.add_argument('--review-dataset', type=Path, default=BASE/'rag13-review-dataset.json')
parser.add_argument('--review-model', default='ccs-workbuddy/deepseek-v4.1-flash')
args = parser.parse_args()
ROOT = args.root
OUT = BASE / args.out
OUT.mkdir(parents=True, exist_ok=False)
env = dict(os.environ, TEMP='D:/tmp', TMP='D:/tmp', PYTHONUTF8='1', CLAWX_E2E_RUN_ROOT=str(OUT / 'fixtures'),
    PROJECT_RAG_E2E_ASSETS_DIR='D:/tmp/project-rag-rag05-e2e-assets', CLAWX_E2E_APP_LOGS='1', OPENCLAW_VITEST_FS_MODULE_CACHE='0', COMMS_OUTPUT_DIR=str(OUT/'comms'))
env['npm_execpath'] = 'C:/Users/27933/AppData/Local/pnpm/.tools/pnpm/11.2.2/node_modules/pnpm/bin/pnpm.mjs'
env['PROJECT_RAG_ACTOR'] = ACTOR
env['GOMAXPROCS'] = '4'
env['GOMEMLIMIT'] = '3GiB'
env['OPENCLAW_BUILD_ALL_NO_PNPM'] = '1'
env['pnpm_config_verify_deps_before_run'] = 'false'
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
    files = ['tests/unit/knowledge-page.test.tsx', 'tests/unit/project-rag-memory-domains.test.ts', 'tests/unit/chat-knowledge-scope.test.ts', 'tests/unit/knowledge-api.test.ts', 'tests/unit/knowledge-source-set-answer.test.ts', 'tests/unit/knowledge-evidence-qa.test.ts', 'tests/unit/host-api-facade.test.ts', 'tests/unit/gateway-permissions-api.test.ts']
    ok = run('root-unit', [NODE, ROOT/'node_modules/vitest/vitest.mjs', 'run', *files, '--maxWorkers=1', '--cache=false', '--reporter=json', '--outputFile='+str(OUT/'root-unit.json')])
    if ok:
        ok = run('runtime-unit', [NODE, 'scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.unit-src.config.ts',
            'src/knowledge/retrieval/projection-store.test.ts', 'src/context-engine/project-rag-owner-adapters.test.ts', '--maxWorkers=1', '--cache=false', '--reporter=json', '--outputFile='+str(OUT/'runtime-unit.json')], ROOT/'openclaw_runtime')
    if ok:
        ok = run('extension-unit', [NODE, 'scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.extension-memory.config.ts', 'extensions/memory-wiki/src/query.native-memory.test.ts', 'extensions/memory-core/src/memory/qmd-manager.raw-read.test.ts', '--maxWorkers=1', '--cache=false', '--reporter=json', '--outputFile='+str(OUT/'extension-unit.json')], ROOT/'openclaw_runtime')
    for name in ['root-unit', 'runtime-unit', 'extension-unit']:
        if not (OUT/(name+'.json')).exists():
            ok = False
            continue
        result = json.loads((OUT/(name+'.json')).read_text(encoding='utf-8-sig'))
        result.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False, candidate=before['head'])
        (OUT/(name+'.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        ok = ok and result.get('success') is True and result.get('numTotalTests', 0) > 0 and result.get('numPendingTests') == 0 and result.get('numFailedTests') == 0
elif args.phase == 'lint':
    lint_inputs = before['worktreeInputs'] or {name: '' for name in git('diff', '--name-only', 'c6460d144', 'HEAD').splitlines()}
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
elif args.phase in ['electron', 'control-e2e']:
    (OUT/'fixtures').mkdir(exist_ok=True)
    files = ['tests/e2e/project-rag-source-domains.spec.ts'] if args.phase == 'electron' else ['tests/e2e/agent-dev-quality.spec.ts']
    expected_tests = 1 if args.phase == 'electron' else 4
    workers = '--workers=1' if args.phase == 'electron' else '--workers=2'
    if not args.formal: env['CLAWX_E2E_KEEP_TEMP'] = '1'
    ok = run('electron', [NODE, ROOT/'node_modules/@playwright/test/cli.js', 'test', *files,
        workers, '--retries=0', '--reporter=json', '--output', str(OUT/'electron')])
    try:
        result = json.loads((OUT/'electron.stdout.log').read_text(encoding='utf-8-sig'))
        result.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False, candidate=before['head'])
        (OUT/'electron.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        receipt['stats'] = result['stats']
        ok = ok and result['stats']['expected'] == expected_tests and not any(result['stats'][key] for key in ['unexpected', 'skipped', 'flaky'])
    except (ValueError, KeyError): ok = False
elif args.phase == 'checks':
    commands = [
        ('contract', [NODE, 'scripts/contract-check.mjs']), ('i18n', [NODE, 'scripts/i18n-lint.mjs']),
        ('catalogs', [NODE, '--import', './openclaw_runtime/node_modules/tsx/dist/loader.mjs', 'scripts/generate-catalogs.mjs', '--check']),
        ('comms-replay', [NODE, 'scripts/comms/replay.mjs']), ('comms-compare', [NODE, 'scripts/comms/compare.mjs']),
        ('harness-validate', [NODE, 'harness/src/cli.mjs', 'validate', '--spec', 'harness/specs/tasks/project-rag-memory-source-adapters.md']),
        ('harness-dry-run', [NODE, 'harness/src/cli.mjs', 'run', '--spec', 'harness/specs/tasks/project-rag-memory-source-adapters.md', '--dry-run']),
    ]
    for name, argv in commands:
        if not run(name, argv): ok = False
elif args.phase in ['runtime-lint', 'format']:
    changed = before['worktreeInputs'] or {name: '' for name in git('diff', '--name-only', 'c6460d144', 'HEAD').splitlines()}
    paths = [name.removeprefix('openclaw_runtime/') for name in changed if name.startswith('openclaw_runtime/') and name.endswith('.ts')]
    if args.phase == 'runtime-lint':
        env['OPENCLAW_LOCAL_CHECK'] = '0'
        env['OPENCLAW_OXLINT_SKIP_PREPARE'] = '1'
        ok = run('runtime-lint', [NODE, 'scripts/run-oxlint.mjs', '--type-aware', '--tsconfig', 'tsconfig.json', *paths], ROOT/'openclaw_runtime')
        receipt['declarationPreparation'] = 'Reused installed generated SDK declarations; current node/web/test type gates and runtime build recorded separately.'
    else:
        ok = run('runtime-format', [NODE, 'node_modules/oxfmt/dist/cli.js', '--check', '--threads=1', *paths], ROOT/'openclaw_runtime')
elif args.phase == 'ci':
    env['CLAWX_HARNESS_CI_REPORT'] = str(OUT/'report.json')
    env['OPENCLAW_VITEST_MAX_WORKERS'] = '1'
    ok = run('harness-ci', [NODE, 'scripts/harness-ci.mjs'])
    report = json.loads((OUT/'report.json').read_text(encoding='utf-8-sig'))
    report.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False, candidate=before['head'])
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    ok = ok and report['success'] and len(report['results']) == report['totalStages'] == 12 and all(row['exitCode']==0 for row in report['results'])
    # Capture and return only generated tracked reports written by this CI run.
    restored=[]
    if not before['dirty']:
        for name in git('diff', '--name-only', 'HEAD').splitlines():
            if not name.startswith('artifacts/'): continue
            target=ROOT/name; generated=target.read_bytes(); saved=OUT/'generated-artifacts'/name
            saved.parent.mkdir(parents=True,exist_ok=True); saved.write_bytes(generated)
            original=subprocess.check_output(['git','show',f"{before['head']}:{name}"],cwd=ROOT)
            target.write_bytes(original)
            restored.append(dict(path=name,generatedSha256=hashlib.sha256(generated).hexdigest(),candidateSha256=hashlib.sha256(original).hexdigest()))
    receipt['generatedReportReadback']=restored
elif args.phase == 'review':
    env['RAG_REVIEW_PROXY_LOG'] = str(OUT/'proxy.jsonl')
    ok = run('autoreview', ['python', args.review_helper or ROOT/'openclaw_runtime/.agents/skills/autoreview/scripts/autoreview', '--mode', 'local',
        '--engine', 'codex', '--model', args.review_model, '--thinking', 'high', '--no-web-search',
        '--prompt-file', args.review_notes, '--dataset', args.review_dataset, '--stream-engine-output',
        '--json-output', OUT/'review.json', '--output', OUT/'review.txt'])

if args.phase == 'review' and (OUT/'review.json').exists():
    review = json.loads((OUT/'review.json').read_text(encoding='utf-8-sig'))
    receipt['reviewQuality'] = 'substantive' if review.get('overall_explanation', '').strip() not in ['', 'placeholder'] and review.get('overall_confidence', 0)>0 else 'invalid-placeholder'
    ok = ok and receipt['reviewQuality']=='substantive'

after = snapshot()
receipt.update(after=after, sourceUnchanged=before == after, completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    status='pass' if ok and before == after else 'fail')
save()
print(json.dumps(dict(status=receipt['status'], sourceUnchanged=receipt['sourceUnchanged'], path=str(OUT/'receipt.json'))), flush=True)
raise SystemExit(0 if receipt['status'] == 'pass' else 1)
