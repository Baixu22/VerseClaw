from pathlib import Path
import argparse,hashlib,json,subprocess
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);args=p.parse_args()
base=Path(__file__).parent
for line in (base/'SHA256SUMS').read_text().splitlines():
 expected,name=line.split('  ',1);assert hashlib.sha256((base/name).read_bytes()).hexdigest()==expected,name
r=json.loads((base/'report.json').read_text(encoding='utf-8'))
for f in r['sourceFiles']:
 b=subprocess.check_output(['git','show',r['candidate']['commit']+':'+f['path']],cwd=args.repo)
 assert hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
assert all(t['failed']==0 and all(c['status']=='passed' for c in t['cases']) for t in r['tests'])
print(json.dumps({'sources':len(r['sourceFiles']),'tests':sum(t['passed'] for t in r['tests']),'verified':True}))
