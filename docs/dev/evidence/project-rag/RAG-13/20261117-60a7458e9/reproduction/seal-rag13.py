import argparse, datetime, hashlib, json, os, re, shutil, subprocess
from pathlib import Path

ROOT = Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX')
CHECKOUT = Path('D:/tmp/project-rag-g2-relay-01a1dca0/source-projection')
BASE = Path(__file__).parent
PREVIOUS = Path('D:/tmp/project-rag-g2-relay-01a1e43b')
ACTOR = 'codex-g2-rag-relay-20261117'
parser = argparse.ArgumentParser()
parser.add_argument('--candidate', required=True)
parser.add_argument('--review-run', type=Path, required=True)
args = parser.parse_args()
CANDIDATE = args.candidate
SHORT = CANDIDATE[:9]
PREFIX = f'docs/dev/evidence/project-rag/RAG-13/20261117-{SHORT}'
DEST = ROOT / PREFIX

def git(*argv, root=ROOT):
    return subprocess.check_output(['git', *argv], cwd=root).decode('utf-8').strip()

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def tagged(**data):
    return dict(actor=ACTOR, driven_by='agent', realHumanEvidence=False, **data)

def write(name, data):
    p = DEST / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def copy(source, name):
    p = DEST / name
    p.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, p)

assert git('rev-parse', 'HEAD') == git('rev-parse', 'HEAD', root=CHECKOUT) == CANDIDATE
assert not git('status', '--porcelain') and not git('status', '--porcelain', root=CHECKOUT)
assert not DEST.exists()
visual = read(BASE / 'formal-visual-check.json')
assert visual['status'] == 'pass' and visual['candidate'] == CANDIDATE
for row in visual['images']:
    assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest() == row['sha256']
phases = ['unit', 'types', 'build', 'electron', 'control-e2e', 'checks', 'lint', 'runtime-lint', 'format', 'ci']
receipts = {}
for phase in phases:
    receipt = read(BASE / f'formal-{phase}-{SHORT}/receipt.json')
    assert receipt['candidate']['head'] == CANDIDATE and not receipt['candidate']['dirty']
    assert receipt['status'] == 'pass' and receipt['sourceUnchanged']
    assert all(command['exitCode'] == 0 for command in receipt['commands'])
    receipts[phase] = receipt
results = {name: read(BASE / f'formal-unit-{SHORT}/{name}.json')
           for name in ['root-unit', 'runtime-unit', 'extension-unit']}
for result in results.values():
    assert result['success'] and result['numTotalTests'] == result['numPassedTests'] > 0
    assert result['numFailedTests'] == result['numPendingTests'] == 0
journeys = list((BASE / f'formal-electron-{SHORT}/electron').rglob('memory-domains-receipt.json'))
assert len(journeys) == 1
journey = read(journeys[0])
steps = ['independentOwnerReads', 'invalidUtf8DeniedBeforePrompt', 'gatewayOwnerIdentityFenced',
         'memorySourceSetAndStudio', 'missingMemoryPinDenied', 'correctionInvalidatedPin',
         'deleteInvalidatedPin', 'roleDeleteInvalidatedPin', 'rejectedMemoryDomainPreserved',
         'memoryCitationUi', 'unpinnedHostMemoryDenied', 'conflictingCorpusDenied']
assert journey['status'] == 'pass' and all(journey['steps'][s] for s in steps)
for phase, expected in [('electron', 1), ('control-e2e', 4)]:
    stats = receipts[phase]['stats']
    assert stats['expected'] == expected and not any(stats[k] for k in ['unexpected', 'skipped', 'flaky'])
ci = read(BASE / f'formal-ci-{SHORT}/report.json')
assert ci['success'] and len(ci['results']) == ci['totalStages'] == 12
assert all(row['exitCode'] == 0 for row in ci['results'])
review = read(args.review_run / 'review.json')
review_receipt = read(args.review_run / 'receipt.json')
assert review_receipt['status'] == 'pass' and review_receipt['sourceUnchanged']
assert review['findings'] == [] and review['overall_correctness'] == 'patch is correct'
assert review['overall_confidence'] > 0 and review['overall_explanation'].strip() not in ['', 'placeholder']
source_files = git('diff', '--name-only', 'c6460d144', CANDIDATE).splitlines()
hashes = {n: hashlib.sha256(subprocess.check_output(['git', 'show', f'{CANDIDATE}:{n}'], cwd=ROOT)).hexdigest()
          for n in source_files}
code_files = [n for n in source_files if n.endswith(('.ts', '.tsx', '.mjs', '.cjs'))]
assert all(review_receipt['candidate']['worktreeInputs'].get(n) == hashes[n] for n in code_files)
chain = read(BASE / 'final-review-inputs.json')
full_receipt = read(BASE / 'corpus-review/receipt.json')
assert read(BASE / 'corpus-review/review.json')['findings'] == []
assert all(chain['sourceHashes'][n] == full_receipt['candidate']['worktreeInputs'][n] for n in chain['unchangedFiles'])
spec = (ROOT / 'harness/specs/tasks/project-rag-memory-source-adapters.md').read_text(encoding='utf-8')
def spec_list(field):
    match = re.search(r'(?m)^' + field + r':\n((?:  - .*\n)+)', spec)
    assert match, field
    return [json.loads(line.strip()[2:]) for line in match.group(1).splitlines()]
required = spec_list('requiredTests')
assert set(spec_list('plannedTests') + spec_list('plannedE2E')).issubset(required)
coverage = []
for filename in required:
    if filename.startswith('tests/e2e/'):
        assert any(filename in c['argv'] for c in receipts['electron']['commands'])
        coverage.append(dict(file=filename, passed=1, failed=0, pending=0))
    else:
        matches = [t for result in results.values() for t in result['testResults']
                   if t['name'].replace('\\', '/').endswith(filename)]
        assert len(matches) == 1 and matches[0]['assertionResults'], filename
        assert all(t['status'] == 'passed' for t in matches[0]['assertionResults']), filename
        coverage.append(dict(file=filename, passed=len(matches[0]['assertionResults']), failed=0, pending=0))
DEST.mkdir(parents=True)
write('visual-verification.json', visual)
for phase in phases:
    folder = BASE / f'formal-{phase}-{SHORT}'
    for p in folder.rglob('*'):
        if p.is_file() and 'fixtures' not in p.relative_to(folder).parts and p.suffix in ['.json', '.log', '.png', '.txt']:
            copy(p, f'gates/{phase}/{p.relative_to(folder).as_posix()}')
for name in ['review.json', 'review.txt', 'receipt.json', 'proxy.raw-final.txt', 'proxy.jsonl']:
    if (args.review_run / name).exists(): copy(args.review_run / name, f'independent-review/{name}')
for name in ['adjudication.json', 'dev-review-02/review.json', 'adjudication-red-01/root-unit.json',
             'adjudication-extension-red-01/result.json', 'dev-review-03/receipt.json']:
    copy(PREVIOUS / name, 'history/' + name)
for run in ['resume-control', 'resume-control-warm']:
    for name in ['receipt.json', 'strict-audit.stdout.log', 'deep-test.stdout.log']:
        copy(BASE / run / name, f'history/{run}/{name}')
for run, names in [('formal-ci-35921979c', ['receipt.json', 'report.json', 'harness-ci.stdout.log']),
                   ('committed-control', ['receipt.json', 'strict-audit.stdout.log'])]:
    for name in names:
        copy(BASE / run / name, f'history/{run}/{name}')
copy(BASE / 'owner-ui-red.json', 'history/owner-ui-red.json')
copy(BASE / 'owner-ui-green/receipt.json', 'history/owner-ui-green/receipt.json')
copy(BASE / 'owner-ui-green/root-unit.json', 'history/owner-ui-green/root-unit.json')
copy(BASE / 'owner-ui-review/receipt.json', 'history/owner-ui-review/receipt.json')
for name in ['receipt.json', 'review.json']:
    copy(BASE / 'owner-ui-review-budget64' / name, 'history/owner-ui-review-budget64/' + name)
for name in ['corpus-red.json', 'corpus-adjudication.json']:
    copy(BASE / name, 'history/' + name)
copy(BASE / 'owner-partial-red.json', 'history/owner-partial-red.json')
for name in ['receipt.json', 'review.json']:
    copy(BASE / 'corpus-review' / name, 'independent-review/full-review/' + name)
copy(BASE / 'review-chain-readback.json', 'independent-review/chain-readback.json')
for run in ['corpus-electron', 'corpus-electron-ordered']:
    for name in ['receipt.json', 'electron.json']:
        copy(BASE / run / name, 'history/' + run + '/' + name)
for name in ['owner-ui-red.json', 'corpus-red.json', 'owner-partial-red.json']:
    original = BASE / name
    data = read(original)
    data.update(actor=ACTOR, driven_by='agent', realHumanEvidence=False,
                evidenceKind='development-counterexample', originalFileSha256=hashlib.sha256(original.read_bytes()).hexdigest())
    write('history/' + name, data)
for name in ['run-rag13.py', 'run-formal-rag13.py', 'seal-rag13.py']:
    copy(BASE / name, 'reproduction/' + name)
for name in ['autoreview-output-budget-compat.py', 'review-output-proxy.py', 'final-review-notes.md', 'final-review-inputs.json', 'review-budget-change.json']:
    copy(BASE / name, 'reproduction/' + name)
write('source-inputs.json', tagged(schema='ProjectRagSourceInputs/v1', candidate=CANDIDATE,
      tree=git('rev-parse', 'HEAD^{tree}'), base='c6460d144', sha256=hashes))
write('review-binding.json', tagged(schema='ProjectRagReviewBinding/v1', candidate=CANDIDATE,
      reviewRun=str(args.review_run), reviewedCodeFiles=code_files, codeHashesMatch=True,
      fullReview='independent-review/full-review/review.json', unchangedInputs=chain['unchangedFiles'],
      deltaReviewedFiles=[row['file'] for row in chain['changes']]))
write('required-test-coverage.json', tagged(schema='ProjectRagRequiredTestReadback/v1', candidate=CANDIDATE,
      counts={name: result['numTotalTests'] for name, result in results.items()}, coverage=coverage,
      electron=dict(journeys=1, steps=journey['steps']), controlPlaneFullE2E=dict(passed=4, failed=0, skipped=0)))
write('report.json', tagged(schema='ProjectRagMemorySourcesAcceptance/v1', programKey='RAG-13', node='TF-0890',
      candidate=CANDIDATE, tree=git('rev-parse', 'HEAD^{tree}'), status='pass',
      completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
      tests={name: result['numTotalTests'] for name, result in results.items()}, electronJourneys=1,
      ciStages=12, independentReviewFindings=0, acceptance=[
          dict(criterion=1, status='pass', evidence=['gates/unit/root-unit.json', 'gates/electron/electron']),
          dict(criterion=2, status='pass', evidence=['gates/unit/root-unit.json', 'gates/electron/electron']),
          dict(criterion=3, status='pass', evidence=['source-inputs.json', 'gates/electron/electron']),
          dict(criterion=4, status='pass', evidence=['gates/unit/root-unit.json', 'gates/electron/electron']),
          dict(criterion=5, status='pass', evidence=['required-test-coverage.json', 'gates/ci/report.json', 'independent-review/review.json'])],
      providerEvidence='Agent-driven local scripted provider with real Electron/Host/Gateway/owner/DCS routes',
      next='RAG-14 / TF-0891'))
(DEST / 'README.md').write_text(f'''# RAG-13 原生与角色记忆验收\n\n候选 `{CANDIDATE}` 通过 {sum(r['numTotalTests'] for r in results.values())} 项单元回归、原生与角色记忆 Electron 旅程、4 项完整控制台旅程和 12 阶段 Harness CI。独立复核没有可操作发现。\n\n原生文件与角色卡分别保留 owner、namespace、版本和原文 pin。12 项旅程检查覆盖独立读取、非法 UTF-8、身份约束、SourceSet/Studio、缺 pin、纠正、删除及拒绝诊断。关闭单个 owner 的回滚与生命周期负例见单元结果。\n\n源码摘要、门禁、复核绑定和 requiredTests 逐项读回保存在同目录。开发阶段的失败和性能超限记录保存在 history；日常缓存检查与完整类型、构建、Electron 门禁分别记录。全部产物由 agent 驱动。\n''', encoding='utf-8')
(DEST / '.gitattributes').write_text('* -text\n*.log -whitespace\n', encoding='utf-8')
secrets = {v for k, v in os.environ.items() if re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$', k, re.I) and len(v) >= 12}
try:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
        for i in range(winreg.QueryInfoKey(key)[1]):
            k, v, _ = winreg.EnumValue(key, i)
            if isinstance(v, str) and re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$', k, re.I) and len(v) >= 12: secrets.add(v)
except (ImportError, FileNotFoundError): pass
paths = [p for p in DEST.rglob('*') if p.is_file()]
hits = [p.relative_to(DEST).as_posix() for p in paths if any(s.encode() in p.read_bytes() for s in secrets)]
write('credential-scan.json', tagged(schema='ProjectRagCredentialScan/v1', scannedFiles=len(paths), hits=len(hits), files=hits))
assert not hits
paths = sorted(p for p in DEST.rglob('*') if p.is_file())
(DEST / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(DEST).as_posix()}\n' for p in paths), encoding='utf-8')
inventory = ROOT / 'scripts/repository-artifacts.json'
policy = read(inventory)
policy['retainedFiles'] = sorted(set(policy['retainedFiles'] + [f'{PREFIX}/{p.relative_to(DEST).as_posix()}' for p in DEST.rglob('*') if p.is_file()]))
inventory.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(dict(status='sealed', candidate=CANDIDATE, files=len(paths) + 1, path=str(DEST))))
