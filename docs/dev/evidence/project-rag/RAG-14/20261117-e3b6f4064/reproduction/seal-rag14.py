import argparse, datetime, hashlib, json, os, re, shutil, subprocess
from pathlib import Path

ROOT = Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX')
BASE = Path(__file__).parent
parser = argparse.ArgumentParser()
parser.add_argument('--candidate', required=True)
parser.add_argument('--review', type=Path, required=True)
args = parser.parse_args()
candidate = args.candidate
short = candidate[:9]
actor = 'codex-g2-rag14-20261117'
prefix = f'docs/dev/evidence/project-rag/RAG-14/20261117-{short}'
dest = ROOT / prefix
def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def git(*argv): return subprocess.check_output(['git', *argv], cwd=ROOT).decode().strip()
def write(name, value):
    p = dest/name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes((json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode())
def copy(source, name):
    p=dest/name
    p.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, p)
def tag(**kw): return dict(actor=actor, driven_by='agent', realHumanEvidence=False, **kw)
assert git('rev-parse','HEAD') == candidate and not git('status','--porcelain')
assert not dest.exists()
phases=['unit','types','build','electron','control-e2e','checks','lint','runtime-lint','format','ci']
receipts={phase:read(BASE/f'formal-{phase}-{short}/receipt.json') for phase in phases}
for receipt in receipts.values():
    assert receipt['status']=='pass' and receipt['sourceUnchanged']
    assert receipt['candidate']['head']==candidate and not receipt['candidate']['dirty']
    assert all(c['exitCode']==0 for c in receipt['commands'])
tests={name:read(BASE/f'formal-unit-{short}/{name}.json') for name in ['root-unit','runtime-unit','extension-unit']}
for test in tests.values():
    assert test['success'] and test['numTotalTests']==test['numPassedTests']>0
    assert test['numFailedTests']==test['numPendingTests']==0
assert receipts['electron']['stats']=={**receipts['electron']['stats'], 'expected':2, 'skipped':0, 'unexpected':0, 'flaky':0}
assert receipts['control-e2e']['stats']=={**receipts['control-e2e']['stats'], 'expected':4, 'skipped':0, 'unexpected':0, 'flaky':0}
journeys={}
for name in ['memory-domains-receipt.json','experience-receipt.json']:
    files=list((BASE/f'formal-electron-{short}/electron').rglob(name))
    assert len(files)==1
    value=read(files[0]);assert value['status']=='pass' and all(value['steps'].values())
    journeys[name]=value
experience=journeys['experience-receipt.json']
assert all(experience['steps'][name] for name in ['unconfirmedAbsent','confirmedPin','pinnedRead','observedAdoption','citationPreview','attributionUi','uiAcknowledgment','correctionInvalidatesPin','rollbackDisablesLane'])
assert experience['attribution']['contextExposures']==experience['attribution']['adoptions']==1
assert experience['attribution']['taskGrades']==0
for phase in ['electron','control-e2e']:
    folder=BASE/f'formal-{phase}-{short}'/'electron'
    cleanup=read(folder/'electron-process-cleanup.json')
    assert cleanup['status']=='passed' and not cleanup['remaining'] and not cleanup['survivors'] and not cleanup['pendingLaunches']
    guard=read(folder/'source-mutation-guard.json')
    assert guard['ok'] and not guard['sourceChanged']
    assert not guard['before']['status'] and not guard['after']['status']
ci=read(BASE/f'formal-ci-{short}/report.json')
assert ci['success'] and len(ci['results'])==ci['totalStages']==12
review=read(args.review/'review.json');rr=read(args.review/'receipt.json')
assert review['findings']==[] and review['overall_correctness']=='patch is correct'
assert review['overall_confidence']>0 and review['overall_explanation'].strip() not in ['', 'placeholder']
assert rr['status']=='pass' and rr['sourceUnchanged']
sourceFiles=git('diff','--name-only','7e48c13a8',candidate).splitlines()
hashes={n:hashlib.sha256(subprocess.check_output(['git','show',candidate+':'+n],cwd=ROOT)).hexdigest() for n in sourceFiles}
for n,h in hashes.items():
    if n.endswith(('.ts','.tsx','.mjs','.cjs')): assert rr['candidate']['worktreeInputs'][n]==h,n
text=(ROOT/'harness/specs/tasks/project-rag-sekb-experience-lane.md').read_text(encoding='utf-8')
def spec_list(field):
    m=re.search(r'(?m)^'+field+r':\n((?:  - .*\n)+)',text);assert m
    return [json.loads(line.strip()[2:]) for line in m.group(1).splitlines()]
required=spec_list('requiredTests');assert set(spec_list('plannedTests')+spec_list('plannedE2E')).issubset(required)
coverage=[]
for file in required:
    if file.startswith('tests/e2e/'):
        assert any(file in c['argv'] for c in receipts['electron']['commands'])
        coverage.append(dict(file=file,passed=2,failed=0,pending=0));continue
    rows=[row for test in tests.values() for row in test['testResults'] if row['name'].replace('\\','/').endswith(file)]
    assert len(rows)==1 and rows[0]['assertionResults'],file
    assert all(a['status']=='passed' for a in rows[0]['assertionResults']),file
    coverage.append(dict(file=file,passed=len(rows[0]['assertionResults']),failed=0,pending=0))
visual=read(BASE/'formal-visual-check.json');assert visual['candidate']==candidate and visual['status']=='pass'
for row in visual['images']:assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['sha256']
dest.mkdir(parents=True)
for phase in phases:
    folder=BASE/f'formal-{phase}-{short}'
    for p in folder.rglob('*'):
        parts=p.relative_to(folder).parts
        if p.is_file() and not any(x in parts for x in ['fixtures','attachments']) and p.suffix in ['.json','.png','.log']:
            copy(p,f'gates/{phase}/{p.relative_to(folder).as_posix()}')
for name in ['review.json','review.txt','receipt.json']:
    copy(args.review/name,'independent-review/'+name)
for folder in [*BASE.glob('dev-*'), *BASE.glob('review-fix-*')]:
    if folder.is_dir() and (folder/'receipt.json').exists():
        receipt=read(folder/'receipt.json')
        if receipt['status']=='fail':
            copy(folder/'receipt.json','history/'+folder.name+'/receipt.json')
            for name in ['review.json','root-unit.json','runtime-unit.json','electron.json']:
                if (folder/name).exists():copy(folder/name,'history/'+folder.name+'/'+name)
for name in ['freeze-candidate.py','review-inputs-v3.json','review-notes-v3.md','run-rag14.py','run-formal-rag14.py','seal-rag14.py','autoreview-output-budget-compat.py','review-output-proxy.py']:
    copy(BASE/name,'reproduction/'+name)
for name in ['review-inputs.json','review-inputs-v1.json','review-inputs-v2.json','review-inputs-v3.json','review-notes-v2.md','review-notes-v3.md']:
    if (BASE/name).exists():copy(BASE/name,'independent-review/'+name)
write('visual-verification.json',visual)
write('source-inputs.json',tag(candidate=candidate,base='7e48c13a8',sha256=hashes))
write('required-test-coverage.json',tag(candidate=candidate,counts={n:d['numTotalTests'] for n,d in tests.items()},coverage=coverage))
write('report.json',tag(schema='ProjectRagExperienceAcceptance/v1',node='TF-0891',programKey='RAG-14',candidate=candidate,
    tree=git('rev-parse','HEAD^{tree}'),status='pass',tests={n:d['numTotalTests'] for n,d in tests.items()},electronJourneys=2,
    experienceSteps=experience['steps'],attribution=experience['attribution'],ciStages=12,independentReviewFindings=0,
    providerEvidence='Agent-driven scripted provider with real Electron/Gateway/DCS/tool/SQLite paths',
    completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),next='RAG-15 / TF-0892'))
(dest/'README.md').write_bytes(f'''# RAG-14 已确认经验与采用归因验收

候选 `{candidate}` 通过 {sum(d['numTotalTests'] for d in tests.values())} 项单元、两条 Electron 来源旅程、完整控制台 4 项 E2E、类型与构建以及 12 阶段 Harness CI。独立复核无可操作发现。

经验候选固定 owner、canonical ID、内容版本与原文；只有已确认且正文相关的经验进入检索。真实脚本驱动旅程完成文件操作和采用，分别记录 UI 展示、DCS 上下文曝光、引用、采用和运行结果，独立任务评分保持 0。固定引用预览、纠正失效与关闭通道回滚均通过。

源码摘要、逐项测试覆盖、当前候选收据、截图与历史失败保存在此目录。所有执行由 agent 驱动。
'''.encode())
(dest/'.gitattributes').write_bytes(b'* -text\n*.log -whitespace\n')
secrets={v for k,v in os.environ.items() if re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$',k,re.I) and len(v)>=12}
try:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER,'Environment') as key:
        for i in range(winreg.QueryInfoKey(key)[1]):
            k,v,_=winreg.EnumValue(key,i)
            if isinstance(v,str) and re.search(r'(API_KEY|TOKEN|SECRET|PASSWORD)$',k,re.I) and len(v)>=12:secrets.add(v)
except (ImportError,FileNotFoundError):pass
files=[p for p in dest.rglob('*') if p.is_file()]
hits=[p.relative_to(dest).as_posix() for p in files if any(s.encode() in p.read_bytes() for s in secrets)]
write('credential-scan.json',tag(scannedFiles=len(files),hits=hits,status='fail' if hits else 'pass'));assert not hits
files=sorted(p for p in dest.rglob('*') if p.is_file())
(dest/'SHA256SUMS').write_bytes(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(dest).as_posix()}\n' for p in files).encode())
p=ROOT/'scripts/repository-artifacts.json';policy=read(p)
policy['retainedFiles']=sorted(set(policy['retainedFiles']+[f'{prefix}/{p.relative_to(dest).as_posix()}' for p in dest.rglob('*') if p.is_file()]))
p.write_bytes((json.dumps(policy,ensure_ascii=False,indent=2)+'\n').encode())
print(json.dumps(dict(status='sealed',candidate=candidate,path=str(dest),files=len(files)+1)))
