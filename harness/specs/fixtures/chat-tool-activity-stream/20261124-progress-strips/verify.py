import hashlib,json,subprocess,sys
from pathlib import Path

root=Path(__file__).resolve().parent
repo=root.parents[4]
def read(name):return json.loads((root/name).read_text(encoding='utf-8'))
def git(*args):return subprocess.check_output(['git',*args],cwd=repo).decode('utf-8').strip()
report=read('report.json');candidate=read('candidate.json')
assert report['status']=='passed' and report['driven_by']=='agent' and candidate['commit']==report['candidate']
unit=read('unit-tests.json')
assert unit['tests']==unit['passed']==len(unit['cases'])==117 and all(case['status']=='passed' for case in unit['cases'])
electron=read('electron-checks.json')
assert electron['distinctJourneys']==len(electron['cases'])==12 and all(case['status']=='expected' for case in electron['cases'])
assert electron['runs']['electron-r5']['expected']==11 and electron['runs']['electron-r5']['unexpected']==1
assert electron['runs']['electron-r7']['expected']==2 and electron['runs']['electron-r7']['unexpected']==0
assert all(check['exitCode']==0 for check in read('checks.json').values())
assert read('typecheck.json')['success'] and not read('typecheck.json')['cache']['enabled']
for label in ['electron-r5','electron-r7']:
 cleanup=read('cleanup/'+label+'.json')
 assert cleanup['status']=='passed' and not cleanup['remaining'] and not cleanup['survivors'] and not cleanup['pendingLaunches']
geometry=read('geometry.json')
assert len(geometry['measurements'])==16 and all(row['width']==row['viewportWidth'] and row['left']<2 and row['right']<2 and not row['overflow'] for row in geometry['measurements'])
installed=read('main-build-installed.json')
assert installed['candidateCommit']==candidate['commit'] and installed['verifiedFiles']==len(read('main-build-files.json'))==1412
assert hashlib.sha256((root/'main-build-files.json').read_bytes()).hexdigest()==installed['fileManifestSha256']
assert read('credential-scan.json')['status']=='passed' and not read('credential-scan.json')['findings']
for source in candidate['sources']:assert git('rev-parse',candidate['commit']+':'+source['path'])==source['gitBlob'],source['path']
assert not git('diff',installed['buildSourceCommit'],candidate['commit'],'--','src','shared','electron','package.json','vite.config.ts')
hashes={name:digest for digest,name in (line.split('  ',1) for line in (root/'SHA256SUMS').read_text().splitlines())}
files={path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file() and path.name!='SHA256SUMS' and '__pycache__' not in path.parts}
assert files==set(hashes)
for name,digest in hashes.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
 if '--git' in sys.argv:
  blob=subprocess.check_output(['git','show','HEAD:'+(root/name).relative_to(repo).as_posix()],cwd=repo)
  assert hashlib.sha256(blob).hexdigest()==digest,name
print(json.dumps({'passed':True,'candidate':candidate['commit'],'unitTests':117,'electronJourneys':12,'evidenceFiles':len(files),'gitBytesChecked':'--git' in sys.argv}))
