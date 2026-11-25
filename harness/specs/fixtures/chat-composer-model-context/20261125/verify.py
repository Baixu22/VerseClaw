import argparse,hashlib,json,sqlite3,subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--repo',required=True);parser.add_argument('--from-git',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parent;repo=Path(args.repo).resolve()
digest=lambda data:hashlib.sha256(data).hexdigest()
load=lambda p:json.loads((root/p).read_text(encoding='utf-8-sig'))
git=lambda *parts:subprocess.check_output(['git',*parts],cwd=repo)
manifest=[line.split('  ',1) for line in (root/'SHA256SUMS').read_text().splitlines()]
for expected,name in manifest:
    assert digest((root/name).read_bytes())==expected,name
    if args.from_git:assert digest(git('show','HEAD:'+str((root/name).relative_to(repo)).replace('\\','/')))==expected,name+' Git'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}=={name for _,name in manifest}|{'SHA256SUMS'}
candidate=load('candidate.json')
for name,expected in candidate['sources'].items():
    blob=git('show',candidate['candidate']+':'+name)
    assert digest(blob)==candidate['gitSources'][name],name
    current=(repo/name).read_bytes()
    assert digest(current)==expected or (b'\0' not in blob and current.replace(b'\r\n',b'\n')==blob.replace(b'\r\n',b'\n')),name+' current'
for check in load('checks.json'):
    assert check['exitCode']==0 and check['sourceUnchanged']
    for stream in ['stdout','stderr']:assert digest((root/check[stream]['retainedPath']).read_bytes())==check[stream]['sha256']
unit=load('checks/unit.json');assert unit['numPassedTests']==unit['numTotalTests']==147 and unit['numFailedTests']==0
matrix=load('browser-matrix.json')['measurements'];assert len(matrix)==16 and all(x['status']=='passed' for x in matrix)
assert {(x['language'],x['theme'],x['width']) for x in matrix}=={(l,t,w) for l in ['en','zh','ja','ru'] for t in ['light','dark'] for w in [1280,375]}
for row in matrix:
    assert row['model']['overlap'] and row['model']['clickThrough'] and row['search']['inert'] and row['context']['headerVisible']
    assert row['search']['border']=='0px' and row['search']['outline']=='none' and row['search']['shadow']=='none'
    assert row['context']['line']=='2px' and row['context']['unfilled']
chain=load('source-chain.json')
for stage in ['first','second']:
    data=chain[stage];folder=root/(stage+'-inputs')
    for item in data['sources']:assert digest((folder/item['archivedName']).read_bytes())==item['sha256']
    database=next(folder/item['archivedName'] for item in data['sources'] if item['archivedName'].endswith('.sqlite'))
    connection=sqlite3.connect('file:'+database.as_posix()+'?mode=ro&immutable=1',uri=True)
    try:assert any(json.loads(value)==data['persistedEntry'] for value, in connection.execute('SELECT value_json FROM cache_entries WHERE scope=?',('session_entries',)).fetchall())
    finally:connection.close()
    assert chain[stage+'Snapshot']['usedTokens']==data['usedTokens']
assert chain['firstSnapshot']['usedTokens']==3600 and chain['secondSnapshot']['usedTokens']==4100
assert chain['second']['report']['systemPrompt']['chars']>chain['first']['report']['systemPrompt']['chars']
observed=load('observed-validation.json');assert observed['usedTokens']==32275 and observed['originalDateShown']
cleanup=load('ego-owned-cleanup.json');assert cleanup['status']=='passed' and not cleanup['survivors']
build=load('main-build-files-ego-r2.json');assert load('main-build-installed-ego-r2.json')['verifiedFiles']==len(build)
for item in build:assert digest((repo/item['path']).read_bytes())==item['sha256'],item['path']+' build'
carbon=load('carbon/receipt.json');assert carbon['actualEditingPassed']
review=load('carbon-relay-r1/reviewed-application-r11.json');assert review['actualStagedModelWrite']
for item in review['finalSources']:assert digest((repo/item['file']).read_bytes())==item['sha256']
print(json.dumps({'status':'passed','candidate':candidate['candidate'],'unit':147,'browserVariants':16,'buildFiles':len(build),'manifestFiles':len(manifest),'gitBytesChecked':args.from_git}))
