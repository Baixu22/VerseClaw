"""Verify the project configuration operator's candidate-bound evidence."""
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent
for line in (root/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1);assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
read=lambda name:json.loads((root/name).read_text('utf8'))
r,g,u,j,review=map(read,('report.json','gates.json','unit-tests.json','journey.json','independent-review.json'))
c=r['candidate']['commit'];assert all(d['candidate']==c for d in (g,u,j))
assert review['sourceCandidate']['head']==c and review['findings']==[]
assert not g['product']['dirty'] and not g['support']['dirty']
assert all(s['exit']==0 for s in g['product']['steps']+g['support']['steps'])
assert u['passed']==148 and u['failed']==0
assert j['stats']['expected']==1 and j['stats']['unexpected']==j['stats']['skipped']==0
v=j['journey'];assert v['candidate']==c and v['dirty']=='' and v['status']=='passed' and v['modelsInvoked']==0
assert v['degraded']['phase']=='degraded' and v['rollback']['phase']=='rolled-back'
assert v['rollback']['configured']==v['rollback']['effective'] and v['rollback']['configured']['contextTokens']==4096
assert v['rollback']['runtimeGeneration'] and len(v['frames'])==4
assert read('credential-scan.json')['hits']==[]
print(json.dumps({'candidate':c,'unit':148,'electron':1,'locales':4,'functional':'passed'}))
