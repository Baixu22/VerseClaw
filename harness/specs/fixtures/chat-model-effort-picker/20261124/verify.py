import argparse,hashlib,json,subprocess
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--from-git',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parent;repo=Path(args.repo).resolve();prefix=root.relative_to(repo).as_posix()
sha=lambda data:hashlib.sha256(data).hexdigest()
read=lambda name:(root/name).read_bytes()
load=lambda name:json.loads(read(name).decode('utf-8-sig'))
def git(*items):return subprocess.check_output(['git',*items],cwd=repo)
entries=[line.split('  ',1) for line in read('SHA256SUMS').decode().splitlines()]
for expected,name in entries:
    assert sha(read(name))==expected,name
    if args.from_git:assert sha(git('show','HEAD:'+prefix+'/'+name))==expected,name+' Git bytes'
expected_names={name for _,name in entries}|{'SHA256SUMS'}
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}==expected_names
candidate=load('candidate.json')
for item in candidate['sources']:
    assert sha(git('show',candidate['commit']+':'+item['path']))==item['sha256'],item['path']
    assert sha((repo/item['path']).read_bytes())==item['sha256'],item['path']+' working source'
checks=load('checks.json')
for label,check in checks.items():
    assert check['exitCode']==0 and check['sourceUnchanged'],label
    for stream in ['stdout','stderr']:assert sha(read('raw/'+label+'.'+stream+'.log'))==check[stream]['sha256'],label+' '+stream
unit=load('raw/unit-r14.json');assert unit['numPassedTests']==unit['numTotalTests']==128
native=load('raw/electron-r14.stdout.log');assert native['stats']['expected']==6 and native['stats']['unexpected']==0 and native['stats']['skipped']==0
geometry=load('geometry.json');assert len(geometry['measurements'])==16
for item in geometry['measurements']:
    card=item['cardGeometry'];assert card['height']<=160 and card['tooltipTop']>=card['modelBottom']
    assert item['focusStyle']['outline']=='none' and item['focusStyle']['shadow']!='none'
vision=load('carbon/actual-image-read.json');assert vision['status']==3 and vision['dimensions']==[1232,1070]
assert sha(read('carbon/review-board.png'))==vision['sourceSha256']
assert sha(read('carbon/actual-image-preview.jpg'))==vision['returnedSha256']
receipt=load('carbon/receipt.json');assert receipt['status']=='SUCCESS' and receipt['usage']['total_tokens']==29359
build=load('main-build-installed.json');files=load('main-build-files.json');assert build['verifiedFiles']==len(files)
for item in files:assert sha((repo/item['path']).read_bytes())==item['sha256'],item['path']+' build'
cleanup=load('electron-process-cleanup.json');assert cleanup['status']=='passed' and not cleanup['survivors']
print(json.dumps({'status':'passed','manifestFiles':len(entries),'sourceFiles':len(candidate['sources']),'buildFiles':len(files),'unit':128,'electron':6,'variants':16,'gitBytesChecked':args.from_git}))
