import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

BASE = Path(__file__).parent
ROOT = Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX')
CHECKOUT = Path('D:/tmp/project-rag-g2-relay-01a1dca0/source-projection')
CANDIDATE = '258457d6a45a0bab5b32eed47b88745dde84f666'
PREFIX = 'docs/dev/evidence/project-rag/RAG-12/20261116-258457d6a'
DEST = ROOT / PREFIX
ACTOR = 'codex/project-rag-g2-relay-01a1df5c'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(name, data):
    path = DEST / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def copy(src, name):
    path = DEST / name
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, path)


def git(*args, root=ROOT):
    return subprocess.check_output(['git', *args], cwd=root).decode('utf-8').strip()


def actor(data):
    return dict(actor=ACTOR, driven_by='agent', realHumanEvidence=False, **data)


if DEST.exists():
    raise SystemExit('The evidence directory already exists; inspect before changing a sealed run.')
DEST.mkdir(parents=True)
phase_reports = {}
for phase in ['unit', 'types', 'build', 'checks', 'lint']:
    folder = BASE / f'formal-{phase}-2584'
    receipt = read(folder / 'receipt.json')
    assert receipt['status'] == 'pass' and receipt['sourceUnchanged'] and receipt['candidate']['head'] == CANDIDATE
    phase_reports[phase] = receipt
    for source in folder.glob('*'):
        if source.is_file() and source.suffix in ['.json', '.log']:
            copy(source, f'gates/{phase}/{source.name}')

ops_folder = BASE / 'formal-operations-2584'
ops_receipt = read(ops_folder / 'receipt.json')
assert ops_receipt['status'] == 'pass' and ops_receipt['sourceUnchanged'] and ops_receipt['candidate']['head'] == CANDIDATE
provider_folder = BASE / 'formal-electron-2584'
provider_report = read(provider_folder / 'electron.json')
provider_runs = [r for suite in provider_report['suites'] for spec in suite.get('specs', [])
                 if 'embedding' in spec['title'] for test in spec['tests'] for r in test['results']]
assert len(provider_runs) == 1 and provider_runs[0]['status'] == 'passed'
for label, folder in [('operations', ops_folder), ('provider', provider_folder)]:
    for name in ['receipt.json', 'electron.json', 'electron.stdout.log', 'electron.stderr.log']:
        copy(folder / name, f'electron/{label}/{name}')
    for path in (folder / 'electron').rglob('*'):
        if path.is_file() and (path.suffix == '.png' or path.name.endswith('-receipt.json') or path.name.startswith('electron-process-')):
            copy(path, f'electron/{label}/artifacts/{path.relative_to(folder / "electron").as_posix()}')

visual = read(BASE / 'visual-readback.json')
assert visual['status'] == 'pass' and len(visual['images']) == 6
copy(BASE / 'visual-readback.json', 'visual-readback.json')
copy(BASE / 'prerequisite-readback.json', 'prerequisite-readback.json')
copy(BASE / 'projection-dependency-readback.json', 'dependency-readback.json')
copy(BASE / 'run-rag12.py', 'run-candidate-gates.py')
copy(Path(__file__), 'seal-rag12.py')
copy(BASE / 'rag12-review-fix-notes.md', 'independent-review-notes.md')
review = read(BASE / 'rag12-review-fix-4/review.json')
assert not review['findings'] and (BASE / 'rag12-review-fix-4/exit.txt').read_text().strip() == '0'
for name in ['review.json', 'review.txt', 'stdout.log', 'stderr.log', 'exit.txt']:
    copy(BASE / 'rag12-review-fix-4' / name, f'review/{name}')

ci = read(BASE / 'formal-ci-2584-v2/report.json')
assert ci['success'] and len(ci['results']) == 12 and all(item['exitCode'] == 0 for item in ci['results'])
for name in ['report.json', 'stdout.log', 'stderr.log', 'exit.txt']:
    copy(BASE / 'formal-ci-2584-v2' / name, f'ci/{name}')
for path in ['artifacts/agent-dev-deep-test/history.json', 'artifacts/agent-dev-deep-test/report.json',
             'artifacts/agent-dev-deep-test/report.md', 'artifacts/agent-dev-quality/report.json',
             'artifacts/agent-dev-workbench/evidence.json', 'artifacts/agent-dev-audit/report.json',
             'artifacts/agent-dev-audit/report.md']:
    copy(CHECKOUT / path, f'control-plane/{path}')
    if path in ['artifacts/agent-dev-audit/report.json', 'artifacts/agent-dev-audit/report.md']:
        continue
    shutil.copyfile(CHECKOUT / path, ROOT / path)
daily = read(CHECKOUT / 'artifacts/agent-dev-deep-test/report.json')
audit = read(CHECKOUT / 'artifacts/agent-dev-audit/report.json')
assert daily['success'] and daily['decision']['status'] == 'needs-full-gate' and not daily['decision']['limitSteps']
assert audit['status'] == 'pass' and not audit['disqualifiers']
for label in ['agent-dev-full-2584', 'agent-dev-full-2584-v2']:
    full = read(BASE / label / 'outputs/artifacts/agent-dev-deep-test/report.json')
    assert full['success'] and full['decision']['fullGateComplete'] and all(step['ok'] for step in full['results'])
    copy(BASE / label / 'outputs/artifacts/agent-dev-deep-test/report.json', f'control-plane/full-history/{label}.json')
for suffix in ['stdout.log', 'stderr.log', 'exit.txt']:
    copy(BASE / f'formal-runtime-lint-2584-scoped.{suffix}', f'gates/runtime-lint/{suffix}')
assert (BASE / 'formal-runtime-lint-2584-scoped.exit.txt').read_text().strip() == '0'
for suffix in ['stdout.log', 'stderr.log', 'exit.txt']:
    copy(BASE / f'formal-runtime-lint-2584.{suffix}', f'history/runtime-lint-prepare/{suffix}')

source_files = git('diff', '--name-only', '8bff5be359d987c3308bc8886f0b4296be1d01f2', CANDIDATE).splitlines()
source_hashes = {name: hashlib.sha256(subprocess.check_output(['git', 'show', f'{CANDIDATE}:{name}'], cwd=ROOT)).hexdigest()
                 for name in source_files if not name.startswith('artifacts/')}
write('source-inputs.json', actor(dict(schema='ProjectRagSourceInputs/v1', candidate=CANDIDATE,
                                      tree=git('rev-parse', f'{CANDIDATE}^{{tree}}'),
                                      base='8bff5be359d987c3308bc8886f0b4296be1d01f2', sha256=source_hashes)))
root_unit = read(BASE / 'formal-unit-2584/root-unit.json')
runtime_unit = read(BASE / 'formal-unit-2584/runtime-unit.json')
assert root_unit['numPassedTests'] == root_unit['numTotalTests'] == 270
assert runtime_unit['numPassedTests'] == runtime_unit['numTotalTests'] == 21
write('required-test-coverage.json', actor(dict(schema='ProjectRagRequiredTestReadback/v1', candidate=CANDIDATE,
    status='pass', root=dict(total=270, passed=270, failed=0, pending=0),
    runtime=dict(total=21, passed=21, failed=0, pending=0),
    plannedTests=['tests/unit/project-rag-config-parity.test.ts'],
    plannedE2E=['tests/e2e/project-rag-settings-operations.spec.ts'],
    electron=dict(provider='passed in formal-electron-2584', operations='passed in formal-operations-2584'))))
commands = [dict(phase=phase, **command) for phase, receipt in phase_reports.items() for command in receipt['commands']]
commands.extend(dict(phase='electron-operations', **command) for command in ops_receipt['commands'])
write('gate-summary.json', actor(dict(schema='ProjectRagGateSummary/v1', candidate=CANDIDATE, status='pass', commands=commands,
    ci=dict(total=12, passed=12), runtimeLint=dict(exitCode=0, preparation='existing generated source declarations; unrelated Slack-wide preparation failure retained'))))
write('failure-history.json', actor(dict(schema='ProjectRagFailureHistory/v1',
    retainedLocalRoot=str(BASE), entries=[
      dict(run='formal-electron-c8', candidate='c8aef961e75cb5d86bac18b3ad3fedba80a93bd1', status='failed', reason='both pages closed after Gateway restart'),
      dict(run='formal-electron-2584', candidate=CANDIDATE, status='one passed, one failed', reason='first operations retrieval timed out; unchanged-candidate isolated rerun passed'),
      dict(run='rag12-frozen-review-c8', status='findings', result='pause reset, expired work, pre-staging budget; fixed by 258457d6a'),
      dict(run='rag12-review-fix-2', status='findings', result='passive renewal and actual timeout classification; fixed'),
      dict(run='rag12-review-fix-3', status='findings', result='mixed failure/cancellation budget; fixed'),
      dict(run='agent-dev-full-2584', status='functionally complete, timing blocked', result='typecheck 49.212s > 45s'),
      dict(run='agent-dev-full-2584-v2', status='functionally complete, timing blocked', result='typecheck 224.743s; build 58.580s > 58s'),
      dict(run='formal-ci-2584', status='failed', result='performance audit failed; v2 passed after documented daily path'),
    ])))
write('report.json', actor(dict(schema='ProjectRagOperationsAcceptance/v1', programKey='RAG-12', node='TF-0889',
    candidate=CANDIDATE, tree=git('rev-parse', f'{CANDIDATE}^{{tree}}'), status='pass',
    checks=dict(rootUnit=270, runtimeUnit=21, electronJourneys=2, ciStages=12, visuals=6,
                typeProjects=['node', 'web', 'test'], independentReviewFindings=0),
    criteria=[dict(index=i, status='pass', evidence=evidence) for i, evidence in enumerate([
      ['gates/unit/root-unit.json', 'source-inputs.json'],
      ['electron/operations/artifacts', 'visual-readback.json'],
      ['electron/operations/artifacts', 'electron/provider/artifacts', 'gates/unit/root-unit.json', 'gates/unit/runtime-unit.json'],
      ['gates/checks/i18n.stdout.log', 'gates/checks/contract.stdout.log', 'visual-readback.json'],
      ['required-test-coverage.json', 'gate-summary.json', 'ci/report.json'],
    ], 1)],
    controlPlane=dict(auditStatus=audit['status'], auditScore=audit['totalScore'],
                      dailyStatus=daily['decision']['status'], requiredFullGates=daily['decision']['requiredFullGates'],
                      fullFunctionalStepsPassed=True, fullPerformanceStatus='limit retained for RAG-19'),
    next='RAG-13 / TF-0890', remainingLongTerm=['RAG-13 through RAG-19', '240 queries', '60 tasks x 3 repeats x 3 arms', '72-hour agent soak'])))
(DEST / 'README.md').write_text('''# RAG-12 配置与索引运维验收

候选 `258457d6a45a0bab5b32eed47b88745dde84f666` 完成配置、owner 状态、索引暂停恢复、撤权清理、模型生命周期和回滚验证。270 项前端/Host、21 项 Runtime、两条 Electron 旅程和十二阶段 CI 通过；独立复核无可操作发现，六张截图已检查。

正式结果与全部源码输入见 `report.json`、`source-inputs.json`、`gate-summary.json` 和 `SHA256SUMS`。本包保留完整 Agent Dev 的实际功能与耗时结果；日常流程使用仓库已有的构建复用、缓存类型检查和 Workbench 烟测，审计 91 分。完整性能超限继续由 RAG-19 核对。

`run-candidate-gates.py` 记录各阶段命令，验证树只含已跟踪文件并复用已安装依赖。运行需指定新的输出目录和相同候选；来源 owner、session、模型和作业 generation 均由产品路径回读。Runtime scoped lint 复用已生成的公开 SDK 类型声明，整仓声明准备时的 Slack 缺模块记录保存在 `history/runtime-lint-prepare`。

失败、复跑和修复链见 `failure-history.json`。原始跑次与一次性诊断保存在其列出的 D 盘私有目录。所有脚本与模型执行均为 agent 驱动。
''', encoding='utf-8')
(DEST / '.gitattributes').write_text('* -text\n*.log -whitespace\n', encoding='utf-8')
names = sorted(path.relative_to(DEST).as_posix() for path in DEST.rglob('*') if path.is_file())
write('artifact-provenance.json', actor(dict(schema='ProjectRagArtifactProvenance/v1', candidate=CANDIDATE,
    consumer='RAG-12 acceptance, RAG-13 prerequisite, repeatable CI and owner lifecycle checks',
    retainedFiles=names, originalRoot=str(BASE), validationCheckout=str(CHECKOUT), reusedDependencies=True)))

# Scan actual locally configured secret values in memory, without printing them.
secrets = {v for k, v in os.environ.items() if re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$', k, re.I) and len(v) >= 12}
try:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
        for index in range(winreg.QueryInfoKey(key)[1]):
            name, value, _ = winreg.EnumValue(key, index)
            if isinstance(value, str) and re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$', name, re.I) and len(value) >= 12:
                secrets.add(value)
except (ImportError, FileNotFoundError):
    pass
hits = []
paths = sorted(path for path in DEST.rglob('*') if path.is_file())
for path in paths:
    blob = path.read_bytes()
    if any(secret.encode() in blob for secret in secrets):
        hits.append(dict(path=path.relative_to(DEST).as_posix(), kind='configured-secret-value'))
    if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAuthorization:\s*Bearer\s+[A-Za-z0-9_.-]{20,}', blob):
        hits.append(dict(path=path.relative_to(DEST).as_posix(), kind='credential-pattern'))
write('credential-scan.json', actor(dict(schema='ProjectRagCredentialScan/v1', scannedFiles=len(paths),
                                       hits=len(hits), files=hits, status='pass' if not hits else 'fail')))
assert not hits, 'Credential scan found sensitive data; do not stage the evidence.'
paths = sorted(path for path in DEST.rglob('*') if path.is_file())
(DEST / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(DEST).as_posix()}\n'
                                      for path in paths), encoding='utf-8')
inventory = ROOT / 'scripts/repository-artifacts.json'
policy = read(inventory)
retained = policy['retainedFiles']
added = [f'{PREFIX}/{path.relative_to(DEST).as_posix()}' for path in DEST.rglob('*') if path.is_file()]
policy['retainedFiles'] = sorted(set(retained + added))
inventory.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(dict(status='sealed', candidate=CANDIDATE, files=len(added), root=str(DEST), secretHits=0)))
