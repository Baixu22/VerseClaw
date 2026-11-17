import argparse,hashlib,json,os,subprocess,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--stage',choices=['source','control'],required=True);p.add_argument('--review',type=Path);p.add_argument('--control',type=Path);a=p.parse_args()
r=Path('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX');d=Path('D:/tmp/project-rag-g2-relay-01a1dca0/source-projection');b=Path(__file__).parent
env=dict(os.environ,TEMP='D:/tmp',TMP='D:/tmp',TMPDIR='/d/tmp',PYTHONUTF8='1');actor='codex-g2-rag14-20261117'
def git(*args,cwd=r):return subprocess.check_output(['git',*args],cwd=cwd).decode().strip()
def read(p):return json.loads(p.read_text('utf-8-sig'))
def run(argv,cwd=r):subprocess.run(argv,cwd=cwd,env=env,check=True)
assert not git('diff','--cached','--name-only')
artifacts=['artifacts/agent-dev-deep-test/history.json','artifacts/agent-dev-deep-test/report.json','artifacts/agent-dev-deep-test/report.md','artifacts/agent-dev-quality/report.json','artifacts/agent-dev-workbench/evidence.json']
spec_name='harness/specs/tasks/project-rag-sekb-experience-lane.md'
if a.stage=='source':
 rr=read(a.review/'receipt.json');review=read(a.review/'review.json')
 assert rr['status']=='pass' and rr['sourceUnchanged']
 assert not review['findings'] and review['overall_correctness']=='patch is correct' and review['overall_confidence']>0
 files=list(rr['candidate']['worktreeInputs']);head=git('rev-parse','HEAD')
 assert head==rr['candidate']['head']
 for name,h in rr['candidate']['worktreeInputs'].items():
  assert hashlib.sha256((r/name).read_bytes()).hexdigest()==h,name
  assert (r/name).read_bytes()==(d/name).read_bytes(),name
 for name in ['review-final-unit','review-final-types','review-final-lint','review-final-build','review-final-electron','review-final-checks','review-fix-runtime-lint-v1','review-fix-format-v1']:
  gate=read(b/name/'receipt.json');assert gate['status']=='pass' and gate['sourceUnchanged'],name
 spec=r/spec_name;data=spec.read_bytes();eol=b'\r\n' if data.count(b'\r\n')>data.count(b'\n')/2 else b'\n'
 text=data.decode().replace('\r\n','\n').replace('implementationStatus: planned','implementationStatus: implemented')
 text=text.replace('touchedAreas:\n','touchedAreas:\n'+''.join('  - "'+n+'"\n' for n in artifacts))
 spec.write_bytes(text.replace('\n',eol.decode()).encode());shutil.copyfile(spec,d/spec_name)
 message='feat(rag): bind confirmed experience to owner reads and observed adoption'
 output='source-candidate.json'
else:
 source=read(b/'source-candidate.json')['candidate'];assert git('rev-parse','HEAD')==source and not git('status','--porcelain')
 assert git('rev-parse','HEAD',cwd=d)==source
 control=read(a.control/'receipt.json');assert control['status']=='pass' and control['sourceHead']==source
 changed=git('diff','--name-only','HEAD',cwd=d).splitlines();assert set(changed).issubset(set(artifacts)),changed
 assert not git('ls-files','--others','--exclude-standard',cwd=d)
 files=changed
 for name in files:shutil.copyfile(d/name,r/name)
 message='test(rag): refresh control-plane evidence for experience candidate'
 output='candidate.json'
run(['node','scripts/check-repository-artifacts.mjs','--write-ignore']) if a.stage=='control' else None
# Retention checks require the newly reviewed contract to be visible in the index.
if a.stage=='source':
 run(['git','add','--',*files])
 run(['node','scripts/check-repository-artifacts.mjs','--write-ignore'])
 shutil.copyfile(r/'.gitignore',d/'.gitignore')
 run(['git','add','--',*files])
for argv in [['node','harness/src/cli.mjs','validate','--spec',spec_name],['node','scripts/check-repository-artifacts.mjs'],['git','diff','--check']]:run(argv)
run(['C:/Program Files/Git/bin/bash.exe','openclaw_runtime/scripts/committer',message,*files])
candidate=git('rev-parse','HEAD');assert not git('status','--porcelain')
run(['git','fetch','--no-tags',str(r),candidate],d)
run(['git','add','--',*files],d)
assert not git('diff','--cached','--name-only',candidate,cwd=d)
run(['git','switch','--detach',candidate],d);assert not git('status','--porcelain',cwd=d)
(b/output).write_bytes((json.dumps(dict(actor=actor,driven_by='agent',realHumanEvidence=False,candidate=candidate,tree=git('rev-parse','HEAD^{tree}'),files=files,review=str(a.review),control=str(a.control)),indent=2)+'\n').encode())
print(candidate)
