from pathlib import Path
import argparse, hashlib, json, subprocess
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);args=p.parse_args()
base=Path(__file__).parent
for row in (base/'SHA256SUMS').read_text(encoding='utf-8').splitlines():
 expected,name=row.split('  ',1);assert hashlib.sha256((base/name).read_bytes()).hexdigest()==expected,name
r=json.loads((base/'report.json').read_text(encoding='utf-8'))
for f in r['sourceFiles']:
 b=subprocess.check_output(['git','show',r['candidate']['commit']+':'+f['path']],cwd=args.repo)
 assert hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
assert sum(t['passed'] for t in r['tests'])==122
assert all(t['failed']==0 and all(c['status']=='passed' for c in t['cases']) for t in r['tests'])
assert all(c['exitCode']==0 for c in r['checks'])
assert r['electron']['passed']==1 and r['electron']['failed']==0
assert r['review']['accepted']==0 and r['review']['actionableRemaining']==0
a=json.loads((base/'review-adjudication.json').read_text(encoding='utf-8'))
assert a['candidate']==r['review']['candidate'] and a['actionableRemaining']==0
assert len(a['decisions'])==r['review']['findings'] and all(d['decision']=='rejected' for d in a['decisions'])
assert r['inheritedTypes']['transferProof']['after']==r['candidate']['commit']
assert r['inheritedTypes']['transferProof']['emittedRuntimeUnchanged']
assert all(s['exitCode']==0 for s in r['inheritedTypes']['successfulSteps'])
assert r['electron']['cleanup']['survivors']==0 and r['electron']['sourceMutationGuard']['ok']
print(json.dumps({'sources':len(r['sourceFiles']),'unitTests':122,'electronTests':1,'verified':True}))
