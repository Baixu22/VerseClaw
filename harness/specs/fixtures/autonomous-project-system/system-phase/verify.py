from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent
for line in (p/'SHA256SUMS').read_text().splitlines():
 d,n=line.split('  ',1);assert hashlib.sha256((p/n).read_bytes()).hexdigest()==d,n
read=lambda n:json.loads((p/n).read_text('utf8'))
r,g,u,j,v=map(read,('report.json','gates.json','units.json','journeys.json','independent-review.json'))
assert r['candidate']==g['candidate']==j['candidate']==v['sourceCandidate']['head']
assert not g['dirty'] and all(s['exit']==0 for s in g['steps'])
assert u['numPassedTests']==128 and u['numFailedTests']==u['numPendingTests']==0
assert j['stats']['expected']==3 and j['stats']['unexpected']==j['stats']['skipped']==0
assert len(j['readbacks'])==3 and all(d['status']=='passed' for d in j['readbacks'].values())
assert v['verdict']=='GO' and v['findings']==[]
print(json.dumps({'candidate':r['candidate'],'unit':128,'electron':3,'phase':'passed'}))
