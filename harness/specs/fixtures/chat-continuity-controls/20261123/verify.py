import hashlib,json,subprocess
from pathlib import Path

root=Path(__file__).resolve().parent
repo=root.parents[4]
def read(name): return json.loads((root/name).read_text(encoding='utf-8'))
report,candidate=read('report.json'),read('candidate.json')
assert report['status']=='ui-passed' and report['driven_by']=='agent'
assert report['candidate']==candidate['commit'] and not candidate['dirty']
units=read('unit-tests.json')
assert units['passed']==units['tests']==len(units['cases'])==138
assert all(case['status']=='passed' for case in units['cases'])
electron=read('electron-checks.json')
assert electron['passed']==len(electron['cases'])==14
assert all(case['status']=='expected' for case in electron['cases'])
assert electron['originalBatchStats']['expected']==14 and electron['originalBatchStats']['unexpected']==2
assert electron['sourceGuard']['ok'] and electron['cleanup']['status']=='passed'
assert not electron['cleanup']['survivors'] and not electron['cleanup']['remaining']
extra=read('runtime-extra-checks.json')
assert extra['status']=='blocked-before-model-call' and extra['providerRequestCounts']==[0,0]
assert len(extra['receipts'])==2 and all(r['status']=='error' and 'EPERM' in r['error'] and 'AGENTS.md' in r['error'] for r in extra['receipts'])
assert extra['sourceGuard']['ok'] and extra['cleanup']['status']=='passed'
assert not extra['cleanup']['survivors'] and not extra['cleanup']['remaining']
assert all(command['exitCode']==0 for command in read('checks.json')['commands'])
assert read('typecheck.json')['success'] and read('typecheck.json')['testTypes']['errorCount']==0
carbon=read('carbon.json')
assert carbon['receipt']['status']=='SUCCESS' and len(carbon['imagesRead'])==4
assert carbon['receipt']['usage']['total_tokens']==31418 and carbon['receipt']['carbonRequests']==2
assert read('main-build-installed.json')['candidateCommit']==candidate['commit']
assert sum(t['filesVerified'] for t in read('main-build-installed.json')['trees'])==1412
for entry in candidate['sources']:
 actual=subprocess.check_output(['git','rev-parse',f"{candidate['commit']}:{entry['path']}"],cwd=repo,text=True).strip()
 assert actual==entry['gitBlob'],entry['path']
assert not subprocess.check_output(['git','diff',report['buildSourceCommit'],candidate['commit'],'--','src','shared','electron','vite.config.ts'],cwd=repo)
hashes={name:digest for digest,name in (line.split('  ',1) for line in (root/'SHA256SUMS').read_text().splitlines())}
files={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name!='SHA256SUMS' and '__pycache__' not in p.parts}
assert files==set(hashes)
for name,digest in hashes.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
print(json.dumps({'passed':True,'candidate':candidate['commit'],'unitTests':138,'uiJourneys':14,'runtimeExtra':'2 EPERM before model calls','files':len(files)}))
